// netlify/functions/leo-generate.js
// Léo — génère un devis structuré et conforme BTP à partir d'un brief texte.
// - Lignes avec quantité, prix unitaire, et TVA PROPOSÉE par ligne (20 / 10 / 5,5 %)
//   que l'artisan pourra ajuster avant validation.
// - Mentions légales BTP pré-remplies (décennale, conditions, validité, rétractation)
//   à partir des préférences de l'artisan (users.settings), ou placeholder "[à compléter]".
// Génération à l'écran ; n'envoie/ne publie rien.
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

    const users = await L.db('GET', 'users', null, `?id=eq.${sd.userId}&select=prenom,metier,secteur,ville,settings`)
    const user = users?.[0] || {}
    const metier = user.metier || user.secteur || 'bâtiment'
    const st = user.settings || {}

    const prompt = `Tu es Léo, assistant devis pour ${user.prenom || 'un artisan'} (métier : ${metier}).
À partir de cette description de chantier : "${brief}"
Génère un devis RÉALISTE pour le bâtiment en France. Réponds STRICTEMENT en JSON valide, sans texte autour :
{"titre":"...","lignes":[{"designation":"...","quantite":1,"unite":"u/m²/h/forfait/ml","prixUnitaire":0.0,"tva":10}]}
Règles :
- 4 à 8 lignes réalistes (main d'oeuvre + fournitures), prix cohérents avec le marché français.
- Pour CHAQUE ligne, propose le taux de TVA le plus probable : 20 (neutre/neuf), 10 (rénovation logement de +2 ans), 5.5 (amélioration énergétique : isolation, chauffage performant, etc.). Mets le taux dans "tva".
- Pas de total (il sera calculé). N'invente pas de marque précise.`
    const raw = await L.callClaude(prompt, { max_tokens: 1400 })
    let devis
    try { devis = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, '').trim()) }
    catch { return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Léo a eu un souci, réessaie en précisant le chantier.' }) } }

    const TVA_OK = [20, 10, 5.5, 0]
    const lignes = (devis.lignes || []).map(l => {
      const q = Number(l.quantite) || 1
      const pu = Number(l.prixUnitaire) || 0
      let tva = Number(l.tva)
      if (!TVA_OK.includes(tva)) tva = 10
      return { designation: l.designation || '—', quantite: q, unite: l.unite || 'u', prixUnitaire: pu, tva, totalHT: q * pu }
    })
    const totalHT = lignes.reduce((s, l) => s + l.totalHT, 0)
    const tvaParTaux = {}
    for (const l of lignes) { tvaParTaux[l.tva] = (tvaParTaux[l.tva] || 0) + l.totalHT * (l.tva / 100) }
    const totalTVA = Object.values(tvaParTaux).reduce((s, v) => s + v, 0)
    const totalTTC = totalHT + totalTVA

    const microTVA = st.tvaRegime === 'franchise' || st.microEntreprise === true
    const mentions = {
      siret: st.siret || '[votre SIRET]',
      assuranceDecennale: st.assureurDecennale
        ? ('Assurance décennale : ' + st.assureurDecennale + (st.numContratDecennale ? ' (contrat n° ' + st.numContratDecennale + ')' : '') + (st.zoneDecennale ? ' — couverture : ' + st.zoneDecennale : ''))
        : 'Assurance décennale : [assureur, n° de contrat et zone à compléter dans vos réglages]',
      validite: "Devis valable 30 jours à compter de sa date d'émission.",
      paiement: st.conditionsPaiement || 'Conditions de paiement : acompte de 30 % à la commande, solde à la fin des travaux.',
      retractation: 'Pour un client particulier démarché hors établissement : droit de rétractation de 14 jours (art. L221-18 du Code de la consommation).',
      tva: microTVA ? 'TVA non applicable, art. 293 B du CGI.' : null
    }

    await L.logTask(sd.userId, 'leo', 'devis_generated', 'success', { titre: devis.titre, totalHT: totalHT.toFixed(2) })

    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        titre: devis.titre || 'Devis',
        lignes,
        totalHT: totalHT.toFixed(2),
        totalTVA: totalTVA.toFixed(2),
        totalTTC: totalTTC.toFixed(2),
        tvaParTaux: Object.fromEntries(Object.entries(tvaParTaux).map(([k, v]) => [k, v.toFixed(2)])),
        microTVA,
        mentions
      })
    }
  } catch (err) {
    console.error('leo-generate error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
