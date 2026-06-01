const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

// Chiffrement AES-256-GCM, même format que integrations-save (iv:tag:ciphertext hex)
function encrypt(plain) {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) throw new Error('ENCRYPTION_KEY manquante/invalide')
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const PLAN_LIMITS = { trial: 10, solo: 3, pro: 10, agence: 10, cancelled: 0 }
const TOOL_AGENTS = {
  wordpress: ['leo'], shopify: ['nina'], woocommerce: ['nina'],
  stripe: ['marc', 'lucas'], brevo: ['sophie', 'julie'],
  buffer: ['alex'], google_my_business: ['hugo']
}

async function db(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function scheduleFor(slug) {
  const d = new Date()
  if (slug === 'leo' || slug === 'emma') {
    const days = (8 - d.getDay()) % 7 || 7
    d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0); return d.toISOString()
  }
  if (slug === 'sophie' || slug === 'lucas') {
    d.setMonth(d.getMonth() + 1, 1); d.setHours(8, 0, 0, 0); return d.toISOString()
  }
  if (slug === 'nina') return null
  d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString()
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { session, prenom, secteur, painPoints, tools, apiKeys } = JSON.parse(event.body || '{}')

    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const { userId, email, plan } = sessionData
    const agentLimit = PLAN_LIMITS[plan] ?? 10

    await db('PATCH', 'users', { prenom, secteur }, `?id=eq.${userId}`)

    await db('POST', 'onboarding', {
      user_id: userId, step_completed: 5,
      answers: { prenom, secteur, painPoints, tools },
      completed_at: new Date().toISOString()
    })

    for (const [tool, key] of Object.entries(apiKeys || {})) {
      if (!key) continue
      await db('POST', 'integrations', { user_id: userId, tool_name: tool, api_key: encrypt(key), is_connected: true })
    }

    const agentSet = new Set(['alex', 'marc', 'leo'])
    for (const tool of (tools || [])) {
      for (const agent of (TOOL_AGENTS[tool.toLowerCase()] || [])) agentSet.add(agent)
    }
    const toActivate = Array.from(agentSet).slice(0, agentLimit)

    for (const slug of ['baptiste', ...toActivate]) {
      await db('POST', 'agents_config', {
        user_id: userId, agent_slug: slug, is_active: true,
        config: { secteur, prenom }, next_run_at: scheduleFor(slug)
      })
    }

    await db('POST', 'tasks_history', {
      user_id: userId, agent_slug: 'baptiste',
      action_type: 'onboarding_completed',
      result: { agents: toActivate }, status: 'success'
    })

    // Welcome email
    const list = toActivate.map(a => `<li>✓ <b>${a.charAt(0).toUpperCase()+a.slice(1)}</b> activé</li>`).join('')
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'Baptiste <contact@pagelab.fr>',
        to: email,
        subject: `🎉 Votre équipe PageLab est prête, ${prenom} !`,
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:40px 24px;background:#07070f;font-family:Arial,sans-serif;color:#eeeef8}.logo{font-size:22px;font-weight:800;color:#fff;margin-bottom:32px}.logo span{color:#7c3aed}.card{background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px}h1{font-size:20px;font-weight:800;color:#fff;margin:0 0 12px}p,li{font-size:15px;color:#9898b8;line-height:1.7;margin:0 0 8px}ul{padding-left:0;list-style:none}.cta{display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:50px;font-size:15px;font-weight:600;text-decoration:none;margin:14px 0}</style></head><body><div class="logo">Page<span>Lab</span></div><div class="card"><h1>Votre équipe est prête, ${prenom} ! 🎉</h1><p>Baptiste a configuré vos agents :</p><ul>${list}</ul><a href="${SITE_URL}/baptiste.html?s=${session}" class="cta">Accéder à mon espace →</a></div></body></html>`
      })
    })

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, agentsActivated: toActivate }) }
  } catch (err) {
    console.error('onboarding-save error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
