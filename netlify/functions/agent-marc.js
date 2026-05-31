// ═══════════════════════════════════════════════════════
// AGENT MARC — Relances Stripe impayées
// ═══════════════════════════════════════════════════════
import { supabase, getIntegration, logTask, updateAgentRun } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) {
  return req.headers.get('x-cron-secret') === process.env.CRON_SECRET
}

function nextDay(hour = 9) {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hour, 0, 0, 0); return d.toISOString()
}
function nextMonday(hour = 8) {
  const d = new Date(); const days = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString()
}
function nextFirstOfMonth(hour = 8) {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 1); d.setHours(hour, 0, 0, 0); return d.toISOString()
}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, agentConfig } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const stripeInt = await getIntegration(userId, 'stripe')

    if (!stripeInt?.api_key) {
      await logTask(userId, 'marc', 'skip', { reason: 'no stripe' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    // Fetch open invoices
    const res = await fetch('https://api.stripe.com/v1/invoices?status=open&limit=50', {
      headers: { 'Authorization': `Bearer ${stripeInt.api_key}` }
    })
    if (!res.ok) throw new Error(`Stripe: ${res.status}`)
    const { data: invoices } = await res.json()

    const now = Date.now() / 1000
    const overdue = (invoices || []).filter(inv =>
      inv.amount_remaining > 0 && (now - inv.created) / 86400 >= 7
    )

    if (!overdue.length) {
      await updateAgentRun(userId, 'marc', nextDay())
      await logTask(userId, 'marc', 'no_overdue', { checked: invoices?.length }, 'success')
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
    }

    let sent = 0
    const results = []

    for (const inv of overdue.slice(0, 5)) {
      if (!inv.customer_email) continue
      const days = Math.floor((now - inv.created) / 86400)
      const amount = (inv.amount_remaining / 100).toFixed(2)
      const currency = inv.currency.toUpperCase()

      const body = await callClaude(`
Rédige un email de relance professionnel et humain pour une facture impayée.
Client: ${inv.customer_name || inv.customer_email}
Montant: ${amount} ${currency} — Facture: ${inv.number || inv.id} — Retard: ${days} jours
Expéditeur: ${user.prenom || 'L\'équipe'} (${user.secteur || 'services'})
Règles: max 120 mots, ton cordial non agressif, appel à l'action simple.
Retourne UNIQUEMENT le corps HTML avec balises <p>.
      `, '', 400)

      await sendEmail({
        to: inv.customer_email,
        subject: `Rappel — Facture ${inv.number || inv.id} (${amount} ${currency})`,
        html: emailBase(`<h1>Rappel de paiement</h1>${body}`,
          inv.hosted_invoice_url ? 'Voir et payer la facture →' : null,
          inv.hosted_invoice_url || null),
        from: `${user.prenom || 'PageLab'} <contact@pagelab.fr>`
      })

      sent++
      results.push({ email: inv.customer_email, amount, days })
    }

    await updateAgentRun(userId, 'marc', nextDay())
    await logTask(userId, 'marc', 'reminders_sent', { sent, results }, 'success', Date.now() - start)

    if (sent > 0) {
      await sendEmail({
        to: user.email,
        subject: `Marc — ${sent} relance(s) envoyée(s) aujourd'hui 📬`,
        html: emailBase(`
          <h1>Rapport Marc 📬</h1>
          <p><b>${sent} relance(s)</b> envoyée(s) sur ${overdue.length} facture(s) en retard.</p>
          <ul>${results.map(r => `<li>✓ ${r.email} — ${r.amount} € — J+${r.days}</li>`).join('')}</ul>
        `)
      })
    }

    return new Response(JSON.stringify({ sent }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'marc', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/marc' }
