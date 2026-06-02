// netlify/functions/agent-run.js
// Déclenche un agent à la demande (depuis le chat ou un bouton).
// Auth : { session, agent, brief? }  — l'utilisateur lance ses propres agents.
// L'agent ne fait que PRÉPARER (file de validation). Aucun envoi ici.

const L = require('./_lib')

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// Agents déclenchables à la demande + libellé
const RUNNABLE = {
  marc:   'Relances impayés',
  leo:    'Article SEO',
  sophie: 'Newsletter',
  alex:   'Posts réseaux sociaux',
  julie:  'Prospection',
  nina:   'Fiches produits',
  emma:   'Veille',
  lucas:  'Récap comptable',
  hugo:   'Rapport'
}

const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { session, agent, brief } = JSON.parse(event.body || '{}')

    let s
    try { s = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (s.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const slug = String(agent || '').toLowerCase()
    if (!RUNNABLE[slug]) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Agent "${agent}" non déclenchable` }) }

    const { userId } = s

    // Récupère la config de l'agent et y injecte le brief de l'utilisateur (thème du post/article...)
    const cfgRows = await L.db('GET', 'agents_config', null,
      `?user_id=eq.${userId}&agent_slug=eq.${slug}&select=config,is_active`)
    const cfg = cfgRows?.[0]
    if (!cfg) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Agent non configuré' }) }

    const mergedConfig = { ...(cfg.config || {}) }
    if (brief && String(brief).trim()) mergedConfig.brief = String(brief).trim()

    // Appelle la fonction de l'agent (réutilise exactement le même code que le cron)
    const res = await L.fetchRetry(`${SITE_URL}/.netlify/functions/agent-${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
      body: JSON.stringify({ userId, agentConfig: mergedConfig })
    })
    const out = await res.json().catch(() => ({}))

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: res.ok, agent: slug, label: RUNNABLE[slug], result: out }) }
  } catch (err) {
    console.error('agent-run error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
