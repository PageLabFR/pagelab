// netlify/functions/auth-verify-code.js
// Vérifie le code à 6 chiffres, crée/récupère l'utilisateur, renvoie un token de session.
const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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
  if (!res.ok && res.status !== 404) throw new Error(`DB ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' }

  try {
    const { email, code, remember } = JSON.parse(event.body || '{}')
    const cleanEmail = String(email || '').trim().toLowerCase()
    const cleanCode = String(code || '').trim()

    if (!cleanEmail || !/^\d{6}$/.test(cleanCode)) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Code invalide' }) }
    }

    // Cherche un code valide non utilisé et non expiré
    const now = new Date().toISOString()
    const links = await db('GET', 'magic_links', null,
      `?email=eq.${encodeURIComponent(cleanEmail)}&token=eq.${cleanCode}&used=eq.false&expires_at=gt.${now}&order=created_at.desc&limit=1`)

    if (!links || links.length === 0) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Code incorrect ou expiré' }) }
    }

    // Marque le code comme utilisé
    await db('PATCH', 'magic_links', { used: true }, `?id=eq.${links[0].id}`)

    // Récupère ou crée l'utilisateur
    let users = await db('GET', 'users', null, `?email=eq.${encodeURIComponent(cleanEmail)}&limit=1`)
    let user
    let isNew = false
    if (users && users.length > 0) {
      user = users[0]
    } else {
      isNew = true
      const created = await db('POST', 'users', {
        email: cleanEmail,
        plan: 'trial',
        created_at: now
      })
      user = created[0]
    }

    // Génère une session au format base64url { userId, exp } — compatible avec
    // actions-list.js / actions-approve.js (qui décodent ce format).
    const sessionDays = remember ? 90 : 7
    const exp = Date.now() + sessionDays * 24 * 60 * 60 * 1000
    const sessionPayload = { userId: user.id, exp }
    const session = Buffer.from(JSON.stringify(sessionPayload)).toString('base64url')

    // On stocke aussi côté users (utile pour invalider / audit)
    await db('PATCH', 'users', {
      session_token: session,
      session_expires: new Date(exp).toISOString()
    }, `?id=eq.${user.id}`)

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        session,          // <- la session encodée (à passer en ?s= aux autres fonctions)
        userId: user.id,
        isNew,
        onboarded: !!(user.metier && user.prenom)
      })
    }
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
