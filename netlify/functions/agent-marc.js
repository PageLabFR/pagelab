// netlify/functions/agent-marc.js
// Marc — relances d'impayés. Prépare seulement : crée des actions en attente.
// L'envoi réel se fait dans actions-approve, après validation. Appelé par le cron.
//
// CONFORMITÉ : l'indemnité forfaitaire de 40 € pour frais de recouvrement
// ne s'applique qu'ENTRE PROFESSIONNELS (B2B). Jamais pour un particulier.
// Le statut pro/particulier est lu dans les métadonnées Stripe du client
// (metadata.type = "pro" | "particulier"). Par défaut : particulier (= pas de 40€),
// le choix le plus prudent juridiquement.

const L = require('./_lib')
const MAX_PER_RUN = 10

// Détermine si le client est un professionnel (pour les 40€)
function isPro(inv, userDefault) {
  const t = (inv._customerType || '').toLowerCase()
  if (t === 'pro' || t === 'professionnel' || t === 'b2b' || t === 'entreprise') return true
  if (t === 'particulier' || t === 'b2c' || t === 'particular') return false
  // Heuristique : un nom d'entreprise (forme juridique) => pro.
  const name = (inv.clientName || '')
  if (/\b(SARL|SAS|SASU|EURL|SA|SCI|EI|EIRL|Ets|Établissements|Cie|& Fils|BTP|Bâtiment)\b/i.test(name)) return true
  // Réglage par défaut de l'artisan : 'pro' => pro, sinon particulier (prudent).
  if (userDefault === 'pro') return true
  return false
}

async function draftRelance(user, inv) {
  const pro = isPro(inv, user?.settings?.clientType)
  const mention40 = pro
    ? `Comme le permet la loi entre professionnels, une indemnité forfaitaire de 40 € pour frais de recouvrement pourra s'appliquer en cas de retard persistant (art. L441-10 et D441-5 du Code de commerce).`
    : `` // JAMAIS de 40€ pour un particulier

  const prompt = `Tu es Marc, assistant de relance d'impayés pour ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || user?.metier || 'bâtiment'}).
Rédige un email de relance COURT, poli et ferme, en français, pour :
- Client : ${inv.clientName}
- Type de client : ${pro ? 'professionnel (B2B)' : 'particulier (B2C)'}
- N° facture : ${inv.invoiceNumber}
- Montant dû : ${inv.amount} ${inv.currency}
- Échéance dépassée depuis le : ${inv.dueDate}
Règles : courtois et professionnel, 4 à 6 phrases max, aucune menace. ${pro ? `Tu PEUX mentionner ceci tel quel : "${mention40}"` : `N'évoque AUCUNE indemnité ni pénalité de 40 € (le client est un particulier, c'est interdit).`}
Termine par une formule de politesse signée "${user?.prenom || 'PageLab'}".
Réponds UNIQUEMENT par le corps de l'email, sans objet ni préambule.`
  let body = await L.callClaude(prompt, { max_tokens: 500 })
  if (inv.hostedUrl) body += `\n\nRégler en ligne : ${inv.hostedUrl}`
  return body
}

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const stripeKey = await L.getIntegrationKey(userId, 'stripe')
    if (!stripeKey) {
      await L.logTask(userId, 'marc', 'skip', 'skipped', { reason: 'no stripe' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    // On élargit la requête pour récupérer le client (afin de lire son type pro/particulier)
    const sres = await L.fetchRetry('https://api.stripe.com/v1/invoices?status=open&limit=100&expand[]=data.customer', {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    })
    if (!sres.ok) throw new Error(`Stripe: ${await sres.text()}`)
    const sdata = await sres.json()
    const nowSec = Math.floor(Date.now() / 1000)
    const overdue = (sdata.data || []).filter(i => i.due_date && i.due_date < nowSec).slice(0, MAX_PER_RUN)

    let created = 0
    for (const inv of overdue) {
      // Type pro/particulier : depuis les métadonnées du client Stripe si dispo
      const cust = (inv.customer && typeof inv.customer === 'object') ? inv.customer : null
      const customerType = cust?.metadata?.type || inv.metadata?.type || ''

      const meta = {
        invoiceId: inv.id,
        invoiceNumber: inv.number || inv.id,
        clientName: inv.customer_name || cust?.name || inv.customer_email || 'Client',
        to: inv.customer_email || cust?.email,
        amount: ((inv.amount_due || 0) / 100).toFixed(2),
        currency: (inv.currency || 'eur').toUpperCase(),
        dueDate: new Date((inv.due_date || nowSec) * 1000).toLocaleDateString('fr-FR'),
        hostedUrl: inv.hosted_invoice_url || null,
        _customerType: customerType
      }
      if (!meta.to) continue
      let body
      try { body = await draftRelance(user, meta) } catch (e) { console.error('draft', e.message); continue }

      const ok = await L.queueAction(userId, 'marc', 'send_relance_email',
        `Relance facture ${meta.invoiceNumber} · ${meta.amount} ${meta.currency} · ${meta.to}`,
        { ...meta, subject: `Relance — facture ${meta.invoiceNumber}`, body, isPro: isPro(meta, user?.settings?.clientType) },
        inv.id /* dedupeKey */)
      if (ok) created++
    }

    await L.reschedule(userId, 'marc', L.tomorrow9h())
    await L.logTask(userId, 'marc', 'relances_prepared', 'success',
      { overdue: overdue.length, drafted: created }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, overdue: overdue.length, drafted: created }) }
  } catch (err) {
    console.error('Marc error:', err.message)
    await L.logTask(userId, 'marc', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
