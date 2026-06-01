// netlify/functions/sam-alerts.js
// Renvoie les alertes Sam non résolues + un statut global pour le dashboard.

const L = require('./_lib')

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  try {
    const session = event.queryStringParameters?.s
    let s; try { s = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (s.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const alerts = await L.db('GET', 'sam_alerts', null,
      `?user_id=eq.${s.userId}&resolved=eq.false&order=created_at.desc&limit=20&select=id,severity,code,message,agent_slug,created_at`)

    const list = alerts || []
    const status = list.some(a => a.severity === 'critical') ? 'critical'
      : list.some(a => a.severity === 'warning') ? 'warning' : 'ok'

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status, alerts: list }) }
  } catch (err) {
    console.error('sam-alerts error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
