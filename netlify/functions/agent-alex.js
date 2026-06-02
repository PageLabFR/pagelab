// netlify/functions/agent-alex.js
// Alex — Réseaux sociaux. Génère des posts et les met EN ATTENTE.
// Programmation réelle via Buffer après validation.

const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const bufferKey = await L.getIntegrationKey(userId, 'buffer')
    if (!bufferKey) {
      await L.logTask(userId, 'alex', 'skip', 'skipped', { reason: 'no buffer' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const brief = agentConfig?.brief ? `\nThème imposé par le client : "${agentConfig.brief}". Tous les posts doivent porter sur ce thème.` : ''
    const prompt = `Tu es Alex, social media manager pour ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || 'général'}).
Propose 3 posts LinkedIn courts et engageants en français.${brief}
Réponds STRICTEMENT en JSON :
{"posts":["texte post 1","texte post 2","texte post 3"]}
Chaque post : 2-4 phrases, ton authentique, pas de hashtags excessifs (max 3), aucun chiffre inventé.`
    const raw = await L.callClaude(prompt, { max_tokens: 1000 })
    let parsed
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) } catch { throw new Error('JSON posts non parsable') }
    const posts = Array.isArray(parsed.posts) ? parsed.posts.filter(Boolean) : []
    if (!posts.length) throw new Error('Aucun post généré')

    let created = 0
    for (let i = 0; i < posts.length; i++) {
      const text = posts[i]
      const ok = await L.queueAction(userId, 'alex', 'schedule_buffer_post',
        `Publier sur LinkedIn : « ${text.slice(0, 60)}… »`,
        { text },
        `post-${new Date().toISOString().slice(0, 10)}-${i}`)
      if (ok) created++
    }

    await L.reschedule(userId, 'alex', L.tomorrow9h())
    await L.logTask(userId, 'alex', 'posts_drafted', 'success', { count: created }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, drafted: created }) }
  } catch (err) {
    console.error('Alex error:', err.message)
    await L.logTask(userId, 'alex', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
