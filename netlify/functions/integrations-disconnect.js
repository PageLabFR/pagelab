// netlify/functions/integrations-disconnect.js
// Supprime la connexion d'un outil pour l'utilisateur courant.
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const VALID_TOOLS = ['wordpress', 'shopify', 'woocommerce', 'stripe', 'brevo', 'buffer', 'notion', 'google_my_business']

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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { session, tool } = JSON.parse(event.body || '{}')
    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const slug = String(tool || '').toLowerCase()
    if (!VALID_TOOLS.includes(slug)) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Outil inconnu' }) }

    await db('DELETE', 'integrations', null, `?user_id=eq.${sessionData.userId}&tool_name=eq.${slug}`)
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) }
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
