const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'

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
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok && res.status !== 404) {
    const err = await res.text()
    throw new Error(`DB error ${res.status}: ${err}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { email } = JSON.parse(event.body || '{}')
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Email invalide' }) }
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Get or create user
    let users = await db('GET', 'users', null, `?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,prenom,plan`)
    let user = users?.[0]

    if (!user) {
      const newUsers = await db('POST', 'users', { email: normalizedEmail })
      user = newUsers?.[0]
      if (!user) throw new Error('Impossible de créer le compte')
    }

    // Invalidate old tokens
    await db('PATCH', 'magic_links', { used: true }, `?email=eq.${encodeURIComponent(normalizedEmail)}&used=eq.false`)

    // Create token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    await db('POST', 'magic_links', { email: normalizedEmail, token, expires_at: expiresAt, used: false })

    const magicUrl = `${SITE_URL}/.netlify/functions/auth-verify-magic-link?token=${token}`
    const isNew = !user.prenom

    // Send email
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'PageLab <contact@pagelab.fr>',
        to: normalizedEmail,
        subject: isNew ? '🚀 Activez votre compte PageLab' : '🔗 Votre lien de connexion PageLab',
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:40px 24px;background:#07070f;font-family:Arial,sans-serif;color:#eeeef8}.logo{font-size:22px;font-weight:800;color:#fff;margin-bottom:32px}.logo span{color:#7c3aed}.card{background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px}h1{font-size:20px;font-weight:800;color:#fff;margin:0 0 12px}p{font-size:15px;color:#9898b8;line-height:1.7;margin:0 0 12px}.cta{display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:50px;font-size:15px;font-weight:600;text-decoration:none;margin:14px 0}.footer{font-size:12px;color:#55556a;text-align:center;margin-top:24px}</style></head><body><div class="logo">Page<span>Lab</span></div><div class="card"><h1>${isNew ? 'Bienvenue sur PageLab !' : 'Votre lien de connexion'}</h1><p>${isNew ? 'Cliquez ci-dessous pour activer votre compte et configurer votre équipe IA.' : 'Voici votre lien de connexion, valable 15 minutes.'}</p><a href="${magicUrl}" class="cta">${isNew ? 'Activer mon compte →' : 'Se connecter →'}</a><p style="font-size:13px;color:#55556a">Si vous n'avez pas demandé ce lien, ignorez cet email.</p></div><div class="footer">© 2025 PageLab</div></body></html>`
      })
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error('Resend error:', errText)
      throw new Error('Erreur envoi email: ' + errText)
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) }
  } catch (err) {
    console.error('send-magic-link error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
