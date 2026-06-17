// netlify/functions/hugo-generate.js
// Hugo — génère un article de blog SEO à partir d'un sujet (via Claude).
// Génération à l'écran ; la publication WordPress réelle se fait ailleurs (agent-leo/actions).
// Auth : { session, brief }.
const L = require('./_lib')

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }
  try {
    const { session, brief } = JSON.parse(event.body || '{}')
    let sd
    try { sd = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sd.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    if (!brief || brief.trim().length < 4) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Donnez un sujet d\'article.' }) }

    const users = await L.db('GET', 'users', null, `?id=eq.${sd.userId}&select=prenom,secteur,metier,ville`)
    const user = users?.[0] || {}
    const metier = user.metier || user.secteur || 'artisan du bâtiment'

    const prompt = `Tu es Hugo, rédacteur SEO pour ${user.prenom || 'un artisan'} (métier : ${metier}${user.ville ? ', à ' + user.ville : ''}).
Rédige un article de blog optimisé SEO en français sur : "${brief}".
Réponds STRICTEMENT en JSON valide, sans texte autour :
{"title":"...","metaDescription":"...","html":"<h2>...</h2><p>...</p>"}
Contraintes : 450-650 mots dans "html", structuré avec des <h2>/<h3>, ton clair et utile pour des clients potentiels, optimisé pour le référencement local, n'invente aucun chiffre précis.`
    const raw = await L.callClaude(prompt, { max_tokens: 2000 })
    let article
    try { article = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Hugo a eu un souci, réessaie.' }) } }
    if (!article.title || !article.html) return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Article incomplet, réessaie.' }) }

    await L.logTask(sd.userId, 'hugo', 'article_generated', 'success', { title: article.title })
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ title: article.title, metaDescription: article.metaDescription || '', html: article.html }) }
  } catch (err) {
    console.error('hugo-generate error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
