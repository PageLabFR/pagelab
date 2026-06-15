// netlify/functions/dashboard-data.js
// Agrège les vraies données de l'artisan pour le dashboard :
// profil, actions en attente (pour le badge + le modal), et un résumé par agent.
// Auth : ?s=<session base64url> (même format que actions-list).

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
}

async function db(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok && res.status !== 404) throw new Error(`DB ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }

  try {
    // --- Auth : décode la session base64url { userId, exp } ---
    const session = event.queryStringParameters?.s
    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (!sessionData || sessionData.exp < Date.now()) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    }
    const { userId } = sessionData

    // --- Profil ---
    const users = await db('GET', 'users', null, `?id=eq.${userId}&limit=1&select=prenom,metier,ville,plan`)
    const user = (users && users[0]) || {}

    // --- Actions en attente (badge + modal) ---
    const actions = await db('GET', 'pending_actions', null,
      `?user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=50&select=id,agent_slug,action_type,summary,payload,created_at`) || []

    // --- Intégrations connectées (pour savoir quels agents ont des données) ---
    const integrations = await db('GET', 'integrations', null,
      `?user_id=eq.${userId}&is_connected=eq.true&select=tool_name`) || []
    const connected = integrations.map(i => i.tool_name)

    // --- Historique récent par agent (depuis tasks_history si présent) ---
    let history = []
    try {
      history = await db('GET', 'tasks_history', null,
        `?user_id=eq.${userId}&order=created_at.desc&limit=30&select=agent_slug,summary,created_at,status`) || []
    } catch (e) { history = [] }

    // --- Regroupe l'historique par agent ---
    const byAgent = {}
    for (const h of history) {
      const slug = h.agent_slug || 'baptiste'
      if (!byAgent[slug]) byAgent[slug] = []
      byAgent[slug].push({ summary: h.summary, date: h.created_at, status: h.status })
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        profile: { prenom: user.prenom || null, metier: user.metier || null, ville: user.ville || null, plan: user.plan || 'trial' },
        pendingCount: actions.length,
        actions,
        connected,
        history: byAgent
      })
    }
  } catch (err) {
    console.error('dashboard-data error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
