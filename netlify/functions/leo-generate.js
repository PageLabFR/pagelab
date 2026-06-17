// netlify/functions/leo-generate.js
// Génère un devis structuré à partir d'un brief texte de l'artisan (via Claude).
// Renvoie un JSON { titre, lignes[], total } affichable directement.
// N'envoie/ne publie rien : pure génération à l'écran.
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
    if (!brief || brief.trim().length < 5) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Décris le chantier (ex : rénovation salle de bain 6m², dépose + carrelage + plomberie)' }) }

    const users = await L.db('GET', 'users', null, `?id=eq.${sd.userId}&select=prenom,metier,ville`)
    const user = users?.[0] || {}

    const prompt = `Tu es Léo, assistant devis pour ${user.prenom || 'un artisan'} (métier : ${user.metier || 'bâtiment'}).
À partir de cette description de chantier : "${brief}"
Génère un devis RÉALISTE pour le bâtiment en France. Réponds STRICTEMENT en JSON valide, sans texte autour :
{"titre":"...","client":"À compléter","lignes":[{"designation":"...","quantite":1,"unite":"u/m²/h/forfait","prixUnitaire":0.0}],"notes":"mention TVA / validité 30j"}
Règles : 4 à 8 lignes réalistes (main d'œuvre + fournitures), prix cohérents avec le marché français, pas de total (il sera calculé). N'invente pas de marque précise.`
    const raw = await L.callClaude(prompt, { max_tokens: 1200 })
    let devis
    try { devis = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Léo a eu un souci, réessaie en précisant le chantier.' }) } }

    const lignes = (devis.lignes || []).map(l => ({
      designation: l.designation || '—',
      quantite: Number(l.quantite) || 1,
      unite: l.unite || 'u',
      prixUnitaire: Number(l.prixUnitaire) || 0,
      total: ((Number(l.quantite) || 1) * (Number(l.prixUnitaire) || 0))
    }))
    const totalHT = lignes.reduce((s, l) => s + l.total, 0)

    // Log informatif (pas d'action irréversible)
    await L.logTask(sd.userId, 'leo', 'devis_generated', 'success', { titre: devis.titre, totalHT: totalHT.toFixed(2) })

    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        titre: devis.titre || 'Devis',
        client: devis.client || 'À compléter',
        lignes,
        totalHT: totalHT.toFixed(2),
        notes: devis.notes || 'TVA non applicable, art. 293 B du CGI. Devis valable 30 jours.'
      })
    }
  } catch (err) {
    console.error('leo-generate error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
