// netlify/functions/actions-reject.js
// Refuse une action en attente. Deux modes d'auth comme actions-approve.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const body = JSON.parse(event.body || '{}')
    const internal = event.headers['x-internal-secret'] === process.env.CRON_SECRET

    let userId, actionId
    if (internal) {
      userId = body.userId; actionId = body.actionId
    } else {
      let sessionData
      try { sessionData = JSON.parse(Buffer.from(body.session, 'base64url').toString()) }
      catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
      if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
      userId = sessionData.userId; actionId = body.actionId
    }
    if (!userId || !actionId) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Paramètres manquants' }) }

    const rows = await db('GET', 'pending_actions', null,
      `?id=eq.${actionId}&user_id=eq.${userId}&status=eq.pending&select=id`)
    if (!rows?.[0]) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Action introuvable ou déjà traitée' }) }

    await db('PATCH', 'pending_actions',
      { status: 'rejected', decided_at: new Date().toISOString() },
      `?id=eq.${actionId}`)

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, status: 'rejected' }) }
  } catch (err) {
    console.error('actions-reject error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
