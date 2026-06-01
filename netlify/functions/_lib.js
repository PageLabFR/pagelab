// netlify/functions/_lib.js
// Helpers partagés par tous les agents et fonctions PageLab.
// (Préfixe _ : Netlify ne le déploie pas comme endpoint, juste un require local.)

const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

// --- DB (PostgREST via service role : contourne RLS, comme prévu) ---
async function db(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok && res.status !== 404) throw new Error(`DB ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// --- Chiffrement AES-256-GCM ---  format stocké : iv:tag:ciphertext (hex)
function encrypt(plain) {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) throw new Error('ENCRYPTION_KEY manquante/invalide')
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`
}
function decrypt(payload) {
  if (!payload) return null
  if (!String(payload).includes(':')) return payload // tolère l'ancien clair éventuel
  const [ivHex, tagHex, dataHex] = String(payload).split(':')
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  d.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([d.update(Buffer.from(dataHex, 'hex')), d.final()]).toString('utf8')
}

// --- fetch avec retries (encaisse les 5xx / hoquets réseau) ---
async function fetchRetry(url, opts, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts)
      if (res.status >= 500 && i < tries - 1) { await new Promise(r => setTimeout(r, 400 * (i + 1))); continue }
      return res
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400 * (i + 1))) }
  }
  throw lastErr || new Error('fetch failed')
}

// --- Appel Claude (Haiku par défaut pour les tâches agents = coût maîtrisé) ---
async function callClaude(prompt, { model = 'claude-haiku-4-5', max_tokens = 600 } = {}) {
  const res = await fetchRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens, messages: [{ role: 'user', content: prompt }] })
  })
  if (!res.ok) throw new Error(`Claude: ${await res.text()}`)
  const data = await res.json()
  return (data.content?.[0]?.text || '').trim()
}

// --- Récupère une clé d'intégration déchiffrée (ou null) ---
async function getIntegrationKey(userId, toolName) {
  const rows = await db('GET', 'integrations', null,
    `?user_id=eq.${userId}&tool_name=eq.${toolName}&is_connected=eq.true&select=api_key`)
  const enc = rows?.[0]?.api_key
  return enc ? decrypt(enc) : null
}

// --- Crée une action en attente de validation (anti-doublon par dedupeKey) ---
async function queueAction(userId, agentSlug, actionType, summary, payload, dedupeKey = null) {
  if (dedupeKey) {
    const existing = await db('GET', 'pending_actions', null,
      `?user_id=eq.${userId}&agent_slug=eq.${agentSlug}&status=neq.rejected&order=created_at.desc&limit=100&select=payload,status`)
    const seen = new Set((existing || []).map(a => a.payload?.dedupeKey).filter(Boolean))
    if (seen.has(dedupeKey)) return false
    payload = { ...payload, dedupeKey }
  }
  await db('POST', 'pending_actions', {
    user_id: userId, agent_slug: agentSlug, action_type: actionType,
    summary, payload, status: 'pending'
  })
  return true
}

// --- Log d'historique ---
async function logTask(userId, agentSlug, actionType, status, result, durationMs = null) {
  const row = { user_id: userId, agent_slug: agentSlug, action_type: actionType, status, result }
  if (durationMs != null) row.duration_ms = durationMs
  await db('POST', 'tasks_history', row)
}

// --- Replanifie un agent ---
async function reschedule(userId, agentSlug, nextRunAt) {
  await db('PATCH', 'agents_config',
    { last_run_at: new Date().toISOString(), next_run_at: nextRunAt },
    `?user_id=eq.${userId}&agent_slug=eq.${agentSlug}`)
}
function tomorrow9h() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString() }
function nextMonday8h() { const d = new Date(); const days = (8 - d.getDay()) % 7 || 7; d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0); return d.toISOString() }
function firstOfNextMonth8h() { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); d.setHours(8, 0, 0, 0); return d.toISOString() }

// --- Garde commune des agents (cron secret) ---
function checkCron(event) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // jamais d'accès si le secret n'est pas configuré
  return event.headers['x-cron-secret'] === secret
}

module.exports = {
  db, encrypt, decrypt, fetchRetry, callClaude, getIntegrationKey,
  queueAction, logTask, reschedule, tomorrow9h, nextMonday8h, firstOfNextMonth8h, checkCron
}
