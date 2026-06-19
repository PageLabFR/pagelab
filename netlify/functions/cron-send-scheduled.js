// netlify/functions/cron-send-scheduled.js
// Envoie les actions validées avec délai de sécurité, une fois les 24h écoulées.
// À planifier dans netlify.toml (ex: toutes les heures). Protégé par le cron-secret.
const L = require('./_lib')
const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'
const CRON_SECRET = process.env.CRON_SECRET

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    // Actions programmées dont la validation date de +24h
    const due = await L.db('GET', 'pending_actions', null,
      `?status=eq.scheduled&decided_at=lt.${cutoff}&select=id,user_id&limit=100`) || []

    let sent = 0
    for (const a of due) {
      try {
        const r = await L.fetchRetry(`${SITE_URL}/.netlify/functions/actions-approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': CRON_SECRET },
          body: JSON.stringify({ userId: a.user_id, actionId: a.id })
        })
        if (r.ok) sent++
      } catch (e) { console.error('send scheduled', a.id, e.message) }
    }
    return { statusCode: 200, body: JSON.stringify({ processed: due.length, sent }) }
  } catch (err) {
    console.error('cron-send-scheduled error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
