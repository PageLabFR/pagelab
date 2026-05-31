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

const PLAN_LIMITS = { trial: 10, solo: 3, pro: 10, agence: 10, cancelled: 0 }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { session, messages } = JSON.parse(event.body || '{}')

    let sessionData
    try {
      sessionData = JSON.parse(Buffer.from(session, 'base64url').toString())
    } catch {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) }
    }
    if (sessionData.exp < Date.now()) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    }

    const { userId } = sessionData

    const [
      { data: user },
      { data: agents },
      { data: integrations },
      { data: history }
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).single(),
      supabase.from('agents_config').select('*').eq('user_id', userId),
      supabase.from('integrations').select('tool_name, is_connected').eq('user_id', userId),
      supabase.from('tasks_history').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(8)
    ])

    const plan = user?.plan || 'trial'
    const agentLimit = PLAN_LIMITS[plan]

    const agentsSummary = (agents || []).map(a => {
      const next = a.next_run_at ? new Date(a.next_run_at).toLocaleDateString('fr-FR') : 'à la demande'
      const last = a.last_run_at ? new Date(a.last_run_at).toLocaleDateString('fr-FR') : 'jamais'
      return `- ${a.agent_slug}: ${a.is_active ? 'ACTIF' : 'PAUSE'} | prochain: ${next} | dernier: ${last}`
    }).join('\n') || 'Aucun agent configuré'

    const historySummary = (history || []).slice(0, 6).map(t =>
      `- ${new Date(t.created_at).toLocaleDateString('fr-FR')} | ${t.agent_slug} | ${t.action_type} | ${t.status}`
    ).join('\n') || 'Aucune tâche récente'

    const systemPrompt = `Tu es Baptiste, coordinateur IA de PageLab pour ${user?.prenom || 'le client'} (secteur: ${user?.secteur || 'non précisé'}, plan: ${plan}, limite: ${agentLimit} agents).

AGENTS ACTUELS:
${agentsSummary}

INTÉGRATIONS: ${(integrations || []).map(i => `${i.tool_name}: ${i.is_connected ? 'connecté' : 'non connecté'}`).join(', ') || 'aucune'}

HISTORIQUE RÉCENT:
${historySummary}

RÈGLES:
- Réponds en français, naturellement, max 150 mots
- Tu peux ajouter une ACTION JSON sur la dernière ligne pour modifier les agents
- Formats: {"action":"pause","agent":"slug"} | {"action":"activate","agent":"slug"} | {"action":"pause_all"} | {"action":"activate_all"}
- N'invente jamais de données
- Si plan solo (limite 3 agents), rappelle la limite si nécessaire`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages || []
      })
    })

    if (!claudeRes.ok) throw new Error(`Claude: ${await claudeRes.text()}`)
    const claudeData = await claudeRes.json()
    let response = claudeData.content[0].text.trim()

    // Parse action
    let action = null
    let agentsUpdated = false
    const actionMatch = response.match(/(\{[^{}]*"action"[^{}]*\})\s*$/)
    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        response = response.replace(actionMatch[1], '').trim()

        if (action.action === 'pause') {
          await supabase.from('agents_config').update({ is_active: false }).eq('user_id', userId).eq('agent_slug', action.agent)
          agentsUpdated = true
        } else if (action.action === 'activate') {
          await supabase.from('agents_config').update({ is_active: true }).eq('user_id', userId).eq('agent_slug', action.agent)
          agentsUpdated = true
        } else if (action.action === 'pause_all') {
          await supabase.from('agents_config').update({ is_active: false }).eq('user_id', userId).neq('agent_slug', 'baptiste')
          agentsUpdated = true
        } else if (action.action === 'activate_all') {
          await supabase.from('agents_config').update({ is_active: true }).eq('user_id', userId).neq('agent_slug', 'baptiste')
          agentsUpdated = true
        }
      } catch (e) { console.error('Action parse error:', e) }
    }

    await supabase.from('tasks_history').insert({
      user_id: userId, agent_slug: 'baptiste', action_type: 'chat',
      result: { msg: (messages || []).slice(-1)[0]?.content?.slice(0, 80), action },
      status: 'success'
    })

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ response, action, agentsUpdated }) }
  } catch (err) {
    console.error('baptiste-chat error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Erreur serveur: ' + err.message }) }
  }
}
