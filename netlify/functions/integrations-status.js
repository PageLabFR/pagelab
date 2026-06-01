// netlify/functions/integrations-status.js
// Renvoie la liste des outils connectés pour l'utilisateur courant.
// Ne renvoie JAMAIS la valeur des clés — uniquement les noms d'outils.

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
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }

  try {
    const session = event.queryStringParameters?.s
    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const { userId } = sessionData

    // On ne sélectionne QUE tool_name + is_connected. Jamais api_key.
    const rows = await db('GET', 'integrations', null,
      `?user_id=eq.${userId}&is_connected=eq.true&select=tool_name`)

    const connected = (rows || []).map(r => r.tool_name)

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ connected }) }
  } catch (err) {
    console.error('integrations-status error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
