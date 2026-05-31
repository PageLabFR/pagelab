import { supabase, logTask } from './_shared/supabase.js'

export default async () => {
  console.log('🕐 Cron universel — ' + new Date().toISOString())
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
      console.log('✅ Aucun agent à exécuter')
      return new Response(JSON.stringify({ ran: 0 }), { status: 200 })
    }

    console.log(`📋 ${due.length} agent(s) à exécuter`)

    for (const item of due) {
      const user = item.users
      if (!user?.is_active) continue

      // Check trial expiry
      if (user.plan === 'trial' && new Date(user.trial_ends_at) < new Date()) {
        console.log(`⏭ Trial expiré pour ${user.email}`)
        continue
      }

      // Check plan === cancelled
      if (user.plan === 'cancelled') continue

      try {
        const res = await fetch(`${process.env.SITE_URL}/.netlify/functions/agent-${item.agent_slug}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': process.env.CRON_SECRET
          },
          body: JSON.stringify({
            userId: user.id,
            agentConfig: item.config || {}
          })
        })
        const data = await res.json()
        results.push({ agent: item.agent_slug, user: user.email, ok: res.ok })
        console.log(`${res.ok ? '✅' : '❌'} ${item.agent_slug} — ${user.email}`)
      } catch (err) {
        console.error(`❌ ${item.agent_slug}:`, err.message)
        await logTask(user.id, item.agent_slug, 'cron_error', { error: err.message }, 'error')
        results.push({ agent: item.agent_slug, user: user.email, ok: false })
      }
    }

    return new Response(JSON.stringify({ ran: results.length, results }), { status: 200 })
  } catch (err) {
    console.error('Cron error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { schedule: '0 8 * * *' }
