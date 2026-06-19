// netlify/functions/actions-cancel.js
// Annule une action programmée (statut scheduled) pendant le délai de sécurité de 24h.
// Repasse l'action en 'pending' (elle revient dans "À valider"), ou en 'cancelled'.
// Auth : { session, actionId, mode }  mode = "back" (repending) | "cancel" (annule)
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
    const { session, actionId, mode } = JSON.parse(event.body || '{}')
    let s
    try { s = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (s.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    if (!actionId) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'actionId manquant' }) }

    const newStatus = (mode === 'cancel') ? 'cancelled' : 'pending'
    await L.db('PATCH', 'pending_actions',
      { status: newStatus, decided_at: null },
      `?id=eq.${actionId}&user_id=eq.${s.userId}&status=eq.scheduled`)

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, status: newStatus }) }
  } catch (err) {
    console.error('actions-cancel error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
