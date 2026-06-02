// netlify/functions/agent-sophie.js
// Sophie — Newsletter. Rédige une newsletter et la met EN ATTENTE.
// Envoi réel via Brevo après validation.

const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const brevoKey = await L.getIntegrationKey(userId, 'brevo')
    if (!brevoKey) {
      await L.logTask(userId, 'sophie', 'skip', 'skipped', { reason: 'no brevo' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const brief = agentConfig?.brief ? `\nThème imposé par le client : "${agentConfig.brief}". Centre la newsletter sur ce sujet.` : ''
    const prompt = `Tu es Sophie, en charge de la newsletter de ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || 'général'}).
Rédige la newsletter de ${monthLabel}.${brief} Réponds STRICTEMENT en JSON :
{"subject":"...","html":"<h1>...</h1><p>...</p>"}
Ton chaleureux et professionnel, 200-300 mots, sans chiffres inventés, en français.`
    const raw = await L.callClaude(prompt, { max_tokens: 1500 })
    let nl
    try { nl = JSON.parse(raw.replace(/```json|```/g, '').trim()) } catch { throw new Error('JSON newsletter non parsable') }
    if (!nl.subject || !nl.html) throw new Error('Newsletter incomplète')

    await L.queueAction(userId, 'sophie', 'send_newsletter_brevo',
      `Envoyer la newsletter : « ${nl.subject} »`,
      { subject: nl.subject, html: nl.html },
      `newsletter-${monthLabel}`)

    await L.reschedule(userId, 'sophie', L.firstOfNextMonth8h())
    await L.logTask(userId, 'sophie', 'newsletter_drafted', 'success', { subject: nl.subject }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, subject: nl.subject }) }
  } catch (err) {
    console.error('Sophie error:', err.message)
    await L.logTask(userId, 'sophie', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
