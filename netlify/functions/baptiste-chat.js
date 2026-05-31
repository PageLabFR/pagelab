import { supabase, getHistory, updateAgentConfig, logTask, PLAN_LIMITS } from './_shared/supabase.js'
import { callClaudeChat } from './_shared/claude.js'

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200 })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const { session, messages } = await req.json()

    let sessionData
    try {
      sessionData = JSON.parse(Buffer.from(session, 'base64url').toString())
    } catch {
      return new Response(JSON.stringify({ error: 'Session invalide' }), { status: 401 })
    }
    if (sessionData.exp < Date.now()) {
      return new Response(JSON.stringify({ error: 'Session expirée' }), { status: 401 })
    }

    const { userId } = sessionData

    // Load full context
    const [
      { data: user },
      { data: agents },
      { data: integrations },
      history
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).single(),
      supabase.from('agents_config').select('*').eq('user_id', userId),
      supabase.from('integrations').select('tool_name, is_connected').eq('user_id', userId),
      getHistory(userId, 8)
    ])

    const plan = user?.plan || 'trial'
    const agentLimit = PLAN_LIMITS[plan]

    const agentsSummary = (agents || []).map(a => {
      const next = a.next_run_at ? new Date(a.next_run_at).toLocaleDateString('fr-FR') : 'à la demande'
      const last = a.last_run_at ? new Date(a.last_run_at).toLocaleDateString('fr-FR') : 'jamais'
      return `- ${a.agent_slug}: ${a.is_active ? 'ACTIF' : 'PAUSE'} | prochain: ${next} | dernier: ${last}`
    }).join('\n') || 'Aucun agent configuré'

    const historySummary = history.slice(0, 6).map(t =>
      `- ${new Date(t.created_at).toLocaleDateString('fr-FR')} | ${t.agent_slug} | ${t.action_type} | ${t.status}`
    ).join('\n') || 'Aucune tâche récente'

    const integrationsSummary = (integrations || []).map(i =>
      `- ${i.tool_name}: ${i.is_connected ? 'connecté' : 'non connecté'}`
    ).join('\n') || 'Aucune intégration'

    const systemPrompt = `Tu es Baptiste, coordinateur IA de PageLab pour ${user?.prenom || 'le client'} (secteur: ${user?.secteur || 'non précisé'}, plan: ${plan}, limite agents: ${agentLimit}).

CONTEXTE RÉEL DU COMPTE :

AGENTS :
${agentsSummary}

INTÉGRATIONS :
${integrationsSummary}

HISTORIQUE RÉCENT :
${historySummary}

RÈGLES :
- Réponds en français, naturellement, comme un vrai collaborateur
- Tu PEUX modifier les agents en ajoutant une ACTION JSON à la fin de ta réponse (sur une ligne seule)
- Formats d'action :
  Pause agent: {"action":"pause","agent":"slug"}
  Activer agent: {"action":"activate","agent":"slug"}
  Pause tous: {"action":"pause_all"}
  Activer tous: {"action":"activate_all"}
  Modifier fréquence: {"action":"reschedule","agent":"slug","next_run_at":"ISO_DATE"}
  Modifier config: {"action":"update_config","agent":"slug","key":"keywords","value":["mot1","mot2"]}
- Limite plan ${plan}: max ${agentLimit} agents actifs (hors Baptiste)
- Si le client veut activer plus d'agents que son plan le permet, explique la limite et propose d'upgrader
- N'invente jamais de données — utilise uniquement ce qui est dans le contexte ci-dessus
- Sois concis (max 150 mots par réponse)`

    const response = await callClaudeChat(messages, systemPrompt, 600)

    // Parse and execute action if present
    let action = null
    let cleanResponse = response.trim()
    const actionMatch = response.match(/(\{[^{}]*"action"[^{}]*\})\s*$/)

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        cleanResponse = response.replace(actionMatch[1], '').trim()

        const now = new Date().toISOString()
        if (action.action === 'pause') {
          await updateAgentConfig(userId, action.agent, { is_active: false })
        } else if (action.action === 'activate') {
          await updateAgentConfig(userId, action.agent, { is_active: true, next_run_at: now })
        } else if (action.action === 'pause_all') {
          await supabase.from('agents_config')
            .update({ is_active: false })
            .eq('user_id', userId).neq('agent_slug', 'baptiste')
        } else if (action.action === 'activate_all') {
          await supabase.from('agents_config')
            .update({ is_active: true })
            .eq('user_id', userId).neq('agent_slug', 'baptiste')
        } else if (action.action === 'reschedule') {
          await updateAgentConfig(userId, action.agent, { next_run_at: action.next_run_at })
        } else if (action.action === 'update_config') {
          const { data: current } = await supabase.from('agents_config')
            .select('config').eq('user_id', userId).eq('agent_slug', action.agent).single()
          const newConfig = { ...(current?.config || {}), [action.key]: action.value }
          await updateAgentConfig(userId, action.agent, { config: newConfig })
        }
      } catch (e) {
        console.error('Action parse error:', e)
      }
    }

    await logTask(userId, 'baptiste', 'chat', {
      msg: messages[messages.length - 1]?.content?.slice(0, 80),
      action
    }, 'success')

    return new Response(JSON.stringify({ response: cleanResponse, action }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('baptiste-chat error:', err)
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500 })
  }
}

export const config = { path: '/api/baptiste/chat' }
