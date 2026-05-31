const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

exports.handler = async (event) => {
  if (event.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' }
  }
  const { userId, agentConfig } = JSON.parse(event.body || '{}')
  console.log('Agent nina running for user:', userId)
  
  try {
    // Log the task
    await supabase.from('tasks_history').insert({
      user_id: userId,
      agent_slug: 'nina',
      action_type: 'agent_run',
      result: { message: 'Agent nina executé avec succès', config: agentConfig },
      status: 'success'
    })

    // Update next_run_at
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    await supabase.from('agents_config')
      .update({ last_run_at: new Date().toISOString(), next_run_at: d.toISOString() })
      .eq('user_id', userId).eq('agent_slug', 'nina')

    return { statusCode: 200, body: JSON.stringify({ success: true, agent: 'nina' }) }
  } catch (err) {
    console.error('Agent nina error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
