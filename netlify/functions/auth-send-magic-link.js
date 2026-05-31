const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({ from: 'PageLab <contact@pagelab.fr>', to, subject, html })
  })
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`)
  return res.json()
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { email } = JSON.parse(event.body || '{}')
    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) }
    }

    const normalizedEmail = email.toLowerCase().trim()

    let { data: user } = await supabase
      .from('users').select('id, prenom, plan').eq('email', normalizedEmail).single()

    if (!user) {
      const { data: newUser, error } = await supabase
        .from('users').insert({ email: normalizedEmail }).select().single()
      if (error) throw error
      user = newUser
    }

    await supabase.from('magic_links')
      .update({ used: true }).eq('email', normalizedEmail).eq('used', false)

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    await supabase.from('magic_links').insert({
      email: normalizedEmail, token, expires_at: expiresAt
    })

    const siteUrl = process.env.SITE_URL || 'https://pagelab.fr'
    const magicUrl = `${siteUrl}/.netlify/functions/auth-verify-magic-link?token=${token}`
    const isNew = !user.prenom

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:0;background:#07070f;font-family:Arial,sans-serif;color:#eeeef8}.wrap{max-width:560px;margin:0 auto;padding:40px 24px}.logo{font-size:22px;font-weight:800;color:#fff;margin-bottom:32px}.logo span{color:#7c3aed}.card{background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px}h1{font-size:22px;font-weight:800;color:#fff;margin:0 0 14px}p{font-size:15px;color:#9898b8;line-height:1.75;margin:0 0 14px}.cta{display:inline-block;padding:13px 28px;background:#7c3aed;color:#fff !important;border-radius:50px;font-size:15px;font-weight:600;text-decoration:none;margin:16px 0 24px}.footer{font-size:12px;color:#55556a;text-align:center;margin-top:24px}</style></head><body><div class="wrap"><div class="logo">Page<span>Lab</span></div><div class="card"><h1>${isNew ? 'Bienvenue sur PageLab !' : 'Votre lien de connexion'}</h1><p>${isNew ? 'Cliquez ci-dessous pour activer votre compte et configurer votre équipe IA avec Baptiste.' : 'Voici votre lien de connexion, valable 15 minutes.'}</p><a href="${magicUrl}" class="cta">${isNew ? 'Activer mon compte →' : 'Se connecter →'}</a><p style="font-size:13px;color:#55556a">Si vous n'avez pas demandé ce lien, ignorez cet email.</p></div><div class="footer">© 2025 PageLab — contact@pagelab.fr</div></div></body></html>`

    await sendEmail({ to: normalizedEmail, subject: isNew ? '🚀 Activez votre compte PageLab' : '🔗 Votre lien de connexion PageLab', html })

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (err) {
    console.error('send-magic-link error:', err.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur: ' + err.message }) }
  }
}
