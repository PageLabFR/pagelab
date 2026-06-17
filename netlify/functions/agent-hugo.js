// netlify/functions/agent-hugo.js  (V2 — Hugo = visibilité/SEO, autonome)
// Chaque semaine : choisit un sujet utile pour le métier de l'artisan, rédige un
// article SEO complet et le pose dans "À valider". L'artisan relit/édite/publie.
const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]
    const metier = user?.metier || user?.secteur || 'artisan du bâtiment'
    const ville = user?.ville ? ` à ${user.ville}` : ''

    // Si le client a donné un thème précis (via brief), on l'utilise ; sinon Hugo choisit seul.
    const sujetConsigne = agentConfig?.brief
      ? `Sujet imposé : "${agentConfig.brief}".`
      : `Choisis toi-même UN sujet d'article utile et recherché sur Google par les clients potentiels d'un ${metier}${ville} (ex : guide pratique, "comment choisir...", "combien coûte...", erreurs à éviter). Varie par rapport aux classiques.`

    const prompt = `Tu es Hugo, rédacteur SEO pour un ${metier}${ville}.
${sujetConsigne}
Rédige un article de blog optimisé SEO en français. Réponds STRICTEMENT en JSON valide, sans texte autour :
{"title":"...","metaDescription":"...","html":"<h2>...</h2><p>...</p>"}
Contraintes : 450-650 mots dans "html", structuré (<h2>/<h3>), utile pour des clients, optimisé référencement local, aucun chiffre inventé.`
    const raw = await L.callClaude(prompt, { max_tokens: 2000 })
    let article
    try { article = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { throw new Error('Réponse IA non parsable') }
    if (!article.title || !article.html) throw new Error('Article incomplet')

    await L.queueAction(
      userId, 'hugo', 'publish_wordpress_post',
      `Article proposé : « ${article.title} »`,
      { title: article.title, metaDescription: article.metaDescription || '', html: article.html, slug: null },
      `article:${article.title}`,
      agentConfig?.autonomy || 'validate'
    )

    await L.reschedule(userId, 'hugo', L.nextMonday8h())
    await L.logTask(userId, 'hugo', 'article_drafted', 'success', { title: article.title }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, title: article.title }) }
  } catch (err) {
    console.error('Hugo error:', err.message)
    await L.logTask(userId, 'hugo', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
