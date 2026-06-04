// netlify/functions/agent-alex.js
// Alex — Réseaux sociaux. Génère des posts adaptés et les met EN ATTENTE.
// Publication réelle via Zernio (API unifiée multi-réseaux) APRÈS validation.
// La génération ne dépend PAS de la connexion : on prépare toujours, on publie après OK.

const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const brief = agentConfig?.brief
      ? `\nTheme impose par le client : "${agentConfig.brief}". Tous les posts doivent porter sur ce theme.` : ''
    const prompt = `Tu es Alex, social media manager pour ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || 'general'}).
Propose 3 posts courts et engageants en francais, adaptes aux reseaux sociaux (LinkedIn, Instagram, Facebook).${brief}
Reponds STRICTEMENT en JSON :
{"posts":["texte post 1","texte post 2","texte post 3"]}
Chaque post : 3-6 phrases, accroche forte en debut, ton authentique et chaleureux, 2-3 hashtags pertinents max a la fin, un appel a l'action leger. Aucun chiffre invente.`
    const raw = await L.callClaude(prompt, { max_tokens: 1200 })
    let parsed
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) } catch { throw new Error('JSON posts non parsable') }
    const posts = Array.isArray(parsed.posts) ? parsed.posts.filter(Boolean) : []
    if (!posts.length) throw new Error('Aucun post genere')

    const autonomy = agentConfig?.autonomy === 'auto' ? 'auto' : 'validate'

    let created = 0
    for (let i = 0; i < posts.length; i++) {
      const text = posts[i]
      const ok = await L.queueAction(userId, 'alex', 'publish_social_zernio',
        `Publier sur tes reseaux : << ${text.slice(0, 60)}... >>`,
        { text },
        `post-${new Date().toISOString().slice(0, 10)}-${i}`,
        autonomy)
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
