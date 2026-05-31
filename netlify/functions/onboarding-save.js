import { supabase, logTask, PLAN_LIMITS } from './_shared/supabase.js'
import { sendEmail, emailBase } from './_shared/resend.js'

const TOOL_AGENTS = {
  wordpress: ['leo'],
  shopify: ['nina'],
  woocommerce: ['nina'],
  stripe: ['marc', 'lucas'],
  brevo: ['sophie', 'julie'],
  buffer: ['alex'],
  google_my_business: ['hugo'],
}

function scheduleFor(slug) {
  const d = new Date()
  switch (slug) {
    case 'leo': case 'emma': {
      const days = (8 - d.getDay()) % 7 || 7
      d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0); return d.toISOString()
    }
    case 'sophie': case 'lucas': {
      d.setMonth(d.getMonth() + 1, 1); d.setHours(8, 0, 0, 0); return d.toISOString()
    }
    case 'nina': return null
    default: {
      d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString()
    }
  }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const { session, prenom, secteur, painPoints, tools, apiKeys } = await req.json()

    // Decode session
    let sessionData
    try {
      sessionData = JSON.parse(Buffer.from(session, 'base64url').toString())
    } catch {
      return new Response(JSON.stringify({ error: 'Session invalide' }), { status: 401 })
    }
    if (sessionData.exp < Date.now()) {
      return new Response(JSON.stringify({ error: 'Session expirée' }), { status: 401 })
    }

    const { userId, email, plan } = sessionData
    const agentLimit = PLAN_LIMITS[plan] ?? 10 // trial = 10 (full access)

    // Update user
    await supabase.from('users').update({ prenom, secteur }).eq('id', userId)

    // Save onboarding
    await supabase.from('onboarding').upsert({
      user_id: userId, step_completed: 5,
      answers: { prenom, secteur, painPoints, tools },
      completed_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

    // Save API keys
    for (const [tool, key] of Object.entries(apiKeys || {})) {
      if (!key) continue
      await supabase.from('integrations').upsert({
        user_id: userId, tool_name: tool, api_key: key, is_connected: true
      }, { onConflict: 'user_id,tool_name' })
    }

    // Determine agents to activate
    const agentSet = new Set(['alex']) // always activate social
    for (const tool of (tools || [])) {
      for (const agent of (TOOL_AGENTS[tool.toLowerCase()] || [])) {
        agentSet.add(agent)
      }
    }
    // Always add core agents if under limit
    for (const a of ['marc', 'leo']) agentSet.add(a)

    // Respect plan limit (baptiste doesn't count)
    const toActivate = Array.from(agentSet).slice(0, agentLimit)

    // Activate agents + baptiste always
    for (const slug of ['baptiste', ...toActivate]) {
      await supabase.from('agents_config').upsert({
        user_id: userId, agent_slug: slug, is_active: true,
        config: { secteur, prenom, ville: '' },
        next_run_at: scheduleFor(slug)
      }, { onConflict: 'user_id,agent_slug' })
    }

    await logTask(userId, 'baptiste', 'onboarding_completed', {
      agents: toActivate, tools: Object.keys(apiKeys || {}).filter(k => apiKeys[k])
    }, 'success')

    // Welcome email
    const list = toActivate.map(a =>
      `<li>✓ <b>${a.charAt(0).toUpperCase() + a.slice(1)}</b> activé</li>`
    ).join('')

    await sendEmail({
      to: email,
      subject: `🎉 Votre équipe PageLab est prête, ${prenom} !`,
      html: emailBase(`
        <div class="badge">✦ Bienvenue dans l'équipe</div>
        <h1>Votre équipe est prête, ${prenom} ! 🎉</h1>
        <p>Baptiste a configuré vos agents. Voici ce qui démarre :</p>
        <ul style="margin:12px 0">${list}</ul>
        <p>Chaque lundi matin, Baptiste vous enverra un rapport de tout ce qui a été accompli.</p>
        <p style="font-size:13px;color:#55556a">Parlez à Baptiste à tout moment pour modifier vos agents ou poser une question.</p>
      `, 'Accéder à mon espace →', `${process.env.SITE_URL}/baptiste.html?s=${session}`)
    })

    return new Response(JSON.stringify({ success: true, agentsActivated: toActivate }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('onboarding-save error:', err)
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500 })
  }
}

export const config = { path: '/api/onboarding/save' }
