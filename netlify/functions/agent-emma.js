// netlify/functions/agent-emma.js
// Emma — Veille. Produit une synthèse de veille pour le secteur (informatif,
// pas d'action irréversible -> pas de validation). Loggée + email récap.

const L = require('./_lib')
const RESEND_KEY = process.env.RESEND_API_KEY

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const competitors = Array.isArray(agentConfig?.competitors) ? agentConfig.competitors : []
    const prompt = `Tu es Emma, en charge de la veille pour ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || 'général'}).
${competitors.length ? `Concurrents suivis : ${competitors.join(', ')}.` : ''}
Rédige une courte synthèse de veille (tendances, points d'attention, idées d'action) pour la semaine, en français, 150-200 mots, avec des puces "•". N'invente aucun fait précis ni chiffre : reste sur des angles et questions à explorer.`
    const synthesis = await L.callClaude(prompt, { max_tokens: 800 })

    await L.reschedule(userId, 'emma', L.nextMonday8h())
    await L.logTask(userId, 'emma', 'veille_report', 'success', { preview: synthesis.slice(0, 120) }, Date.now() - start)

    if (RESEND_KEY && user?.email) {
      await L.fetchRetry('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'Emma (PageLab) <contact@pagelab.fr>',
          to: user.email,
          subject: `Emma — votre veille de la semaine`,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.7">${synthesis.replace(/\n/g, '<br>')}</div>`
        })
      })
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) }
  } catch (err) {
    console.error('Emma error:', err.message)
    await L.logTask(userId, 'emma', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
