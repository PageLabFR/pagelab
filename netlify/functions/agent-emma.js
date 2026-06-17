// netlify/functions/agent-emma.js  (V2 — Emma = avis Google, autonome)
// Chaque jour : repère les clients qui viennent de payer (Stripe) et prépare une
// demande d'avis Google pour chacun. L'artisan valide avant envoi (queueAction 'validate').
// Déclenché par le cron (checkCron) ou par agent-run.
const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const stripeKey = await L.getIntegrationKey(userId, 'stripe')
    if (!stripeKey) {
      await L.reschedule(userId, 'emma', L.tomorrow9h())
      await L.logTask(userId, 'emma', 'review_requests', 'success', { reason: 'stripe_non_connecte', drafted: 0 }, Date.now() - start)
      return { statusCode: 200, body: JSON.stringify({ success: true, drafted: 0, reason: 'stripe_non_connecte' }) }
    }

    // Paiements des 7 derniers jours (chantiers récemment réglés)
    const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
    const res = await L.fetchRetry(`https://api.stripe.com/v1/charges?created[gte]=${since}&limit=100`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    })
    if (!res.ok) throw new Error('Stripe: ' + await res.text())
    const data = await res.json()

    const placeId = agentConfig?.googlePlaceId || ''
    const reviewLink = placeId
      ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
      : `https://www.google.com/search?q=${encodeURIComponent((user?.prenom || '') + ' avis google')}`

    let drafted = 0
    const seen = new Set()
    for (const c of (data.data || [])) {
      if (!c.paid || c.status !== 'succeeded') continue
      const email = c.billing_details?.email || c.receipt_email
      const name = c.billing_details?.name || 'votre client'
      if (!email || seen.has(email)) continue
      seen.add(email)

      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.6;color:#1a1a2e">
        <p>Bonjour ${name},</p>
        <p>Merci de votre confiance ! Si vous êtes satisfait du travail réalisé, un petit avis Google m'aiderait beaucoup. Ça prend 30 secondes :</p>
        <p style="text-align:center;margin:24px 0"><a href="${reviewLink}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;display:inline-block">⭐ Laisser un avis</a></p>
        <p style="font-size:13px;color:#888">Merci beaucoup,<br>${user?.prenom || 'Votre artisan'}</p>
      </div>`

      const created = await L.queueAction(
        userId, 'emma', 'send_review_email',
        `Demande d'avis à ${name}`,
        { to: email, subject: 'Votre avis compte pour moi 🙏', html, fromName: user?.prenom || 'Votre artisan' },
        `avis:${email}`,
        agentConfig?.autonomy || 'validate'
      )
      if (created) drafted++
    }

    await L.reschedule(userId, 'emma', L.tomorrow9h())
    await L.logTask(userId, 'emma', 'review_requests', 'success', { drafted }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, drafted }) }
  } catch (err) {
    console.error('Emma error:', err.message)
    await L.logTask(userId, 'emma', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
