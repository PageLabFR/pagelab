// netlify/functions/agent-leo.js
// Léo — SEO & Blog. Génère un article et le met EN ATTENTE. Publication
// WordPress réelle uniquement après validation (dans actions-approve).

const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const wpKey = await L.getIntegrationKey(userId, 'wordpress')
    if (!wpKey) {
      await L.logTask(userId, 'leo', 'skip', 'skipped', { reason: 'no wordpress' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const brief = agentConfig?.brief ? `\nSujet imposé par le client : "${agentConfig.brief}". Traite précisément ce sujet.` : ''
    const prompt = `Tu es Léo, rédacteur SEO pour ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || 'général'}).
Propose UN article de blog optimisé SEO en français, utile pour ses clients potentiels.${brief}
Réponds STRICTEMENT en JSON valide, sans texte autour :
{"title":"...","slug":"...","metaDescription":"...","html":"<h2>...</h2><p>...</p>"}
Contraintes : 500-700 mots dans "html", titres <h2>/<h3>, ton professionnel, pas d'invention de chiffres.`
    const raw = await L.callClaude(prompt, { max_tokens: 2000 })
    let article
    try { article = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { throw new Error('Réponse IA non parsable en JSON') }
    if (!article.title || !article.html) throw new Error('Article incomplet')

    await L.queueAction(userId, 'leo', 'publish_wordpress_post',
      `Publier l'article : « ${article.title} »`,
      { title: article.title, slug: article.slug || null, metaDescription: article.metaDescription || '', html: article.html },
      article.slug || article.title)

    await L.reschedule(userId, 'leo', L.nextMonday8h())
    await L.logTask(userId, 'leo', 'article_drafted', 'success', { title: article.title }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, title: article.title }) }
  } catch (err) {
    console.error('Leo error:', err.message)
    await L.logTask(userId, 'leo', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
