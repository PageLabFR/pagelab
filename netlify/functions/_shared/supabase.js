import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function getUser(userId) {
  const { data, error } = await supabase
    .from('users').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

export async function getUserByEmail(email) {
  const { data } = await supabase
    .from('users').select('*').eq('email', email.toLowerCase().trim()).single()
  return data
}

export async function getIntegration(userId, toolName) {
  const { data } = await supabase
    .from('integrations').select('*')
    .eq('user_id', userId).eq('tool_name', toolName).eq('is_connected', true).single()
  return data || null
}

export async function logTask(userId, agentSlug, actionType, result, status = 'success', durationMs = 0) {
  await supabase.from('tasks_history').insert({
    user_id: userId, agent_slug: agentSlug,
    action_type: actionType, result, status, duration_ms: durationMs
  })
}

export async function updateAgentRun(userId, agentSlug, nextRunAt) {
  await supabase.from('agents_config').update({
    last_run_at: new Date().toISOString(), next_run_at: nextRunAt
  }).eq('user_id', userId).eq('agent_slug', agentSlug)
}

export async function getHistory(userId, limit = 20) {
  const { data } = await supabase.from('tasks_history').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
  return data || []
}

export async function getAgentConfig(userId, agentSlug) {
  const { data } = await supabase.from('agents_config').select('*')
    .eq('user_id', userId).eq('agent_slug', agentSlug).single()
  return data || null
}

export async function updateAgentConfig(userId, agentSlug, updates) {
  await supabase.from('agents_config').upsert({
    user_id: userId, agent_slug: agentSlug, ...updates
  }, { onConflict: 'user_id,agent_slug' })
}

export async function getUserAgents(userId) {
  const { data } = await supabase.from('agents_config').select('*')
    .eq('user_id', userId).order('agent_slug')
  return data || []
}

// Plan limits
export const PLAN_LIMITS = {
  trial: 10,   // full access during trial
  solo: 3,
  pro: 10,
  agence: 10,
  cancelled: 0
}

export function canUseAgent(user, agentSlug) {
  if (agentSlug === 'baptiste') return true // always available
  const limit = PLAN_LIMITS[user.plan] ?? 0
  return limit > 0
}

export async function getActiveAgentCount(userId) {
  const { count } = await supabase.from('agents_config')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('is_active', true)
    .neq('agent_slug', 'baptiste')
  return count || 0
}
