const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

exports.handler = async () => {
  console.log('Cron universel — ' + new Date().toISOString())
  const now = new Date().toISOString()
  const results = []

  try {
    const { data: due } = await supabase
      .from('agents_config')
      .select('*, users(id, email, prenom, secteur, plan, is_active, trial_ends_at)')
      .eq('is_active', true)
      .lte('next_run_at', now)
      .not('agent_slug', 'in', '("baptiste","nina")')

    if (!due || due.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ran: 0 }) }
    }

    const siteUrl = process.env.SITE_URL || 'https://pagelab.fr'

    for (const item of due) {
      const user = item.users
      if (!user?.is_active) continue
      if (user.plan === 'trial' && new Date(user.trial_ends_at) < new Date()) continue
      if (user.plan === 'cancelled') continue

      try {
        const res = await fetch(`${siteUrl}/.netlify/functions/agent-${item.agent_slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
          body: JSON.stringify({ userId: user.id, agentConfig: item.config || {} })
        })
        results.push({ agent: item.agent_slug, user: user.email, ok: res.ok })
      } catch (err) {
        console.error(`Agent ${item.agent_slug} error:`, err.message)
        await supabase.from('tasks_history').insert({
          user_id: user.id, agent_slug: item.agent_slug,
          action_type: 'cron_error', result: { error: err.message }, status: 'error'
        })
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ran: results.length, results }) }
  } catch (err) {
    console.error('Cron error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
