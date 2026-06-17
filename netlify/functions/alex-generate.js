// netlify/functions/alex-generate.js
// Alex — génère un post LinkedIn à partir d'un sujet (via Claude).
// Génération à l'écran (copier-coller) ; publication auto via Zernio = plus tard.
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
    if (!brief || brief.trim().length < 5) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Décrivez ce que vous voulez raconter.' }) }

    const users = await L.db('GET', 'users', null, `?id=eq.${sd.userId}&select=prenom,secteur,metier,ville`)
    const user = users?.[0] || {}
    const metier = user.metier || user.secteur || 'artisan du bâtiment'

    const prompt = `Tu es Alex, expert en communication LinkedIn pour ${user.prenom || 'un artisan'} (métier : ${metier}${user.ville ? ', à ' + user.ville : ''}).
À partir de cette idée : "${brief}"
Rédige UN post LinkedIn authentique, à la première personne, en français.
Règles : accroche forte sur la 1re ligne, ton humain et concret (pas corporate), 100-200 mots, des retours à la ligne pour aérer, 3 à 5 hashtags pertinents à la fin. Pas d'emojis à outrance (2-3 max). Réponds UNIQUEMENT par le texte du post, sans préambule ni guillemets.`
    const post = await L.callClaude(prompt, { max_tokens: 700 })

    await L.logTask(sd.userId, 'alex', 'linkedin_post_generated', 'success', { preview: post.slice(0, 80) })
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ post }) }
  } catch (err) {
    console.error('alex-generate error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
