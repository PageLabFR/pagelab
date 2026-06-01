// netlify/functions/agent-sam.js
// Sam — gardien. Tourne en planifié (voir netlify.toml). Détection 100%
// déterministe (pas de LLM qui se juge lui-même). Peut couper un agent.

const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const ERROR_THRESHOLD = 3      // erreurs/agent/24h -> coupe-circuit
const VOLUME_THRESHOLD = 50    // actions/24h -> anomalie de volume
const PENDING_THRESHOLD = 20   // validations en attente -> info

async function raise(userId, severity, code, message, agentSlug = null) {
  // Dédoublonnage : pas deux fois la même alerte non résolue le même jour
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: existing } = await supabase.from('sam_alerts')
    .select('id').eq('user_id', userId).eq('code', code).eq('resolved', false)
    .gte('created_at', since).limit(1)
  if (existing && existing.length) return
  await supabase.from('sam_alerts').insert({ user_id: userId, severity, code, message, agent_slug: agentSlug })
}

exports.handler = async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const report = []

  try {
    const { data: users } = await supabase.from('users').select('id, email').eq('is_active', true)
    if (!users?.length) return { statusCode: 200, body: JSON.stringify({ checked: 0 }) }

    for (const u of users) {
      const { data: tasks } = await supabase.from('tasks_history')
        .select('agent_slug, status, created_at').eq('user_id', u.id).gte('created_at', since)

      const list = tasks || []

      // 1) Erreurs par agent -> coupe-circuit
      const errByAgent = {}
      list.filter(t => t.status === 'error').forEach(t => { errByAgent[t.agent_slug] = (errByAgent[t.agent_slug] || 0) + 1 })
      for (const [agent, n] of Object.entries(errByAgent)) {
        if (n >= ERROR_THRESHOLD) {
          await supabase.from('agents_config').update({ is_active: false }).eq('user_id', u.id).eq('agent_slug', agent)
          await raise(u.id, 'critical', 'agent_errors',
            `Agent ${agent} mis en pause : ${n} erreurs en 24h.`, agent)
          report.push({ user: u.email, action: 'paused', agent })
        }
      }

      // 2) Anomalie de volume
      if (list.length > VOLUME_THRESHOLD) {
        await raise(u.id, 'warning', 'volume_spike',
          `Volume inhabituel : ${list.length} actions en 24h.`)
      }

      // 3) Validations en attente qui s'accumulent
      const { count } = await supabase.from('pending_actions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.id).eq('status', 'pending')
      if ((count || 0) > PENDING_THRESHOLD) {
        await raise(u.id, 'info', 'pending_pileup',
          `${count} actions attendent votre validation.`)
      }
    }

    return { statusCode: 200, body: JSON.stringify({ checked: users.length, report }) }
  } catch (err) {
    console.error('Sam error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
