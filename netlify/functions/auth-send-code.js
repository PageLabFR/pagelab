// netlify/functions/auth-send-code.js
// Envoie un code à 6 chiffres par email (réutilise la table magic_links + Resend).
const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY

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
    const { email } = JSON.parse(event.body || '{}')
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail || !/^[^@]+@[^@]+\.[^@]+$/.test(cleanEmail)) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Email invalide' }) }
    }

    // Génère un code à 6 chiffres
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 min

    // Stocke dans magic_links (token = code, réutilise la table existante)
    await db('POST', 'magic_links', {
      email: cleanEmail,
      token: code,
      expires_at: expires,
      used: false
    })

    // Envoi email via Resend
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'PageLab <contact@pagelab.fr>',
          to: [cleanEmail],
          subject: `Votre code PageLab : ${code}`,
          html: `<div style="font-family:Inter,Arial,sans-serif;max-width:420px;margin:0 auto;padding:30px;color:#1a1a2e">
            <p style="font-size:15px">Bonjour,</p>
            <p style="font-size:15px">Voici votre code de connexion PageLab :</p>
            <div style="font-size:38px;font-weight:800;letter-spacing:10px;text-align:center;color:#7c3aed;margin:24px 0">${code}</div>
            <p style="font-size:13px;color:#666">Ce code expire dans 15 minutes. Si vous n'avez rien demandé, ignorez cet email.</p>
            <p style="font-size:13px;color:#999;margin-top:24px">— L'équipe PageLab</p>
          </div>`
        })
      })
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
