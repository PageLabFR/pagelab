// netlify/functions/agent-lucas.js
// Lucas — Comptabilité. Lit les paiements Stripe du mois écoulé et produit un
// récap informatif (lecture seule -> aucune action irréversible -> pas de
// validation requise). Le récap est loggé et notifié par email.

const L = require('./_lib')
const RESEND_KEY = process.env.RESEND_API_KEY

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const stripeKey = await L.getIntegrationKey(userId, 'stripe')
    if (!stripeKey) {
      await L.logTask(userId, 'lucas', 'skip', 'skipped', { reason: 'no stripe' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
    const res = await L.fetchRetry(`https://api.stripe.com/v1/charges?created[gte]=${since}&limit=100`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    })
    if (!res.ok) throw new Error(`Stripe: ${await res.text()}`)
    const data = await res.json()
    const charges = (data.data || []).filter(c => c.paid && c.status === 'succeeded')
    const totalCents = charges.reduce((s, c) => s + (c.amount || 0), 0)
    const currency = (charges[0]?.currency || 'eur').toUpperCase()
    const total = (totalCents / 100).toFixed(2)

    const summary = { period: '30 derniers jours', count: charges.length, total, currency }

    await L.reschedule(userId, 'lucas', L.firstOfNextMonth8h())
    await L.logTask(userId, 'lucas', 'accounting_summary', 'success', summary, Date.now() - start)

    // Notification (email = action vers l'utilisateur lui-même, pas vers un tiers)
    if (RESEND_KEY && user?.email) {
      await L.fetchRetry('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'Lucas (PageLab) <contact@pagelab.fr>',
          to: user.email,
          subject: `Lucas — récap comptable (${summary.count} paiements)`,
          html: `<div style="font-family:Arial,sans-serif"><h2>Récap des 30 derniers jours</h2><p>${summary.count} paiement(s) réussi(s) pour un total de <b>${total} ${currency}</b>.</p><p style="color:#888;font-size:13px">Chiffres lus depuis Stripe. Vérifiez toujours avec votre comptable.</p></div>`
        })
      })
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, ...summary }) }
  } catch (err) {
    console.error('Lucas error:', err.message)
    await L.logTask(userId, 'lucas', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
