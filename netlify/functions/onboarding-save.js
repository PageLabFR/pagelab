const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const TOOL_AGENTS = {
  wordpress: ['leo'],
  shopify: ['nina'],
  woocommerce: ['nina'],
  stripe: ['marc', 'lucas'],
  brevo: ['sophie', 'julie'],
  buffer: ['alex'],
  google_my_business: ['hugo'],
}

const PLAN_LIMITS = { trial: 10, solo: 3, pro: 10, agence: 10, cancelled: 0 }

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

async function sendWelcomeEmail(email, prenom, agents, session) {
  const siteUrl = process.env.SITE_URL || 'https://pagelab.fr'
  const list = agents.map(a => `<li>✓ <b>${a.charAt(0).toUpperCase()+a.slice(1)}</b> activé</li>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:40px 24px;background:#07070f;font-family:Arial,sans-serif;color:#eeeef8}.logo{font-size:22px;font-weight:800;color:#fff;margin-bottom:32px}.logo span{color:#7c3aed}.card{background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px}h1{font-size:22px;font-weight:800;color:#fff;margin:0 0 14px}p{font-size:15px;color:#9898b8;line-height:1.75;margin:0 0 14px}ul{color:#9898b8;font-size:14px;line-height:1.8;padding-left:0;list-style:none}.cta{display:inline-block;padding:13px 28px;background:#7c3aed;color:#fff !important;border-radius:50px;font-size:15px;font-weight:600;text-decoration:none;margin:16px 0}</style></head><body><div class="logo">Page<span>Lab</span></div><div class="card"><h1>Votre équipe est prête, ${prenom} ! 🎉</h1><p>Baptiste a configuré vos agents :</p><ul>${list}</ul><p>Chaque lundi matin, Baptiste vous enverra un rapport de ce qui a été accompli.</p><a href="${siteUrl}/baptiste.html?s=${session}" class="cta">Accéder à mon espace →</a></div></body></html>`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: 'Baptiste <contact@pagelab.fr>', to: email, subject: `🎉 Votre équipe PageLab est prête, ${prenom} !`, html })
  })
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { session, prenom, secteur, painPoints, tools, apiKeys } = JSON.parse(event.body || '{}')

    let sessionData
    try {
      sessionData = JSON.parse(Buffer.from(session, 'base64url').toString())
    } catch {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) }
    }
    if (sessionData.exp < Date.now()) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    }

    const { userId, email, plan } = sessionData
    const agentLimit = PLAN_LIMITS[plan] ?? 10

    await supabase.from('users').update({ prenom, secteur }).eq('id', userId)
    await supabase.from('onboarding').upsert({
      user_id: userId, step_completed: 5,
      answers: { prenom, secteur, painPoints, tools },
      completed_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

    for (const [tool, key] of Object.entries(apiKeys || {})) {
      if (!key) continue
      await supabase.from('integrations').upsert({
        user_id: userId, tool_name: tool, api_key: key, is_connected: true
      }, { onConflict: 'user_id,tool_name' })
    }

    const agentSet = new Set(['alex', 'marc', 'leo'])
    for (const tool of (tools || [])) {
      for (const agent of (TOOL_AGENTS[tool.toLowerCase()] || [])) agentSet.add(agent)
    }
    const toActivate = Array.from(agentSet).slice(0, agentLimit)

    for (const slug of ['baptiste', ...toActivate]) {
      await supabase.from('agents_config').upsert({
        user_id: userId, agent_slug: slug, is_active: true,
        config: { secteur, prenom },
        next_run_at: scheduleFor(slug)
      }, { onConflict: 'user_id,agent_slug' })
    }

    await supabase.from('tasks_history').insert({
      user_id: userId, agent_slug: 'baptiste', action_type: 'onboarding_completed',
      result: { agents: toActivate }, status: 'success'
    })

    await sendWelcomeEmail(email, prenom, toActivate, session)

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, agentsActivated: toActivate }) }
  } catch (err) {
    console.error('onboarding-save error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Erreur serveur: ' + err.message }) }
  }
}
