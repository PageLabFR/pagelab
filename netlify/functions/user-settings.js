// netlify/functions/user-settings.js
// Lit / enregistre les préférences de l'artisan (ex : type de clients par défaut
// pour la règle des 40€ : 'pro' | 'particulier' | 'mixte').
// Stocké dans users.settings (JSON).
// GET  ?s=<session>            → { settings }
// POST { session, settings }   → enregistre (merge)
const L = require('./_lib')
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  try {
    if (event.httpMethod === 'GET') {
      const session = event.queryStringParameters?.s
      let s; try { s = JSON.parse(Buffer.from(session, 'base64url').toString()) }
      catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
      if (s.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
      const rows = await L.db('GET', 'users', null, `?id=eq.${s.userId}&select=settings`)
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ settings: rows?.[0]?.settings || {} }) }
    }

    const { session, settings } = JSON.parse(event.body || '{}')
    let s; try { s = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (s.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const rows = await L.db('GET', 'users', null, `?id=eq.${s.userId}&select=settings`)
    const merged = { ...((rows?.[0]?.settings) || {}), ...(settings || {}) }
    await L.db('PATCH', 'users', { settings: merged }, `?id=eq.${s.userId}`)
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, settings: merged }) }
  } catch (err) {
    console.error('user-settings error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
