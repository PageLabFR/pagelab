const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const PLAN_LIMITS = { trial: 10, solo: 3, pro: 10, agence: 10, cancelled: 0 }

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
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { session, messages } = JSON.parse(event.body || '{}')

    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const { userId } = sessionData

    const [users, agents, integrations, history, pending] = await Promise.all([
      db('GET', 'users', null, `?id=eq.${userId}&select=*`),
      db('GET', 'agents_config', null, `?user_id=eq.${userId}&select=*`),
      db('GET', 'integrations', null, `?user_id=eq.${userId}&select=tool_name,is_connected`),
      db('GET', 'tasks_history', null, `?user_id=eq.${userId}&order=created_at.desc&limit=8&select=*`),
      db('GET', 'pending_actions', null, `?user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=10&select=agent_slug,summary`)
    ])

    const user = users?.[0]
    const plan = user?.plan || 'trial'
    const agentLimit = PLAN_LIMITS[plan]

    const agentsSummary = (agents || []).map(a => {
      const next = a.next_run_at ? new Date(a.next_run_at).toLocaleDateString('fr-FR') : 'à la demande'
      const last = a.last_run_at ? new Date(a.last_run_at).toLocaleDateString('fr-FR') : 'jamais'
      return `- ${a.agent_slug}: ${a.is_active ? 'ACTIF' : 'PAUSE'} | prochain: ${next} | dernier: ${last}`
    }).join('\n') || 'Aucun agent configuré'

    const historySummary = (history || []).map(t => {
      // On expose le résultat chiffré pour que Baptiste ne sur-interprète pas.
      const r = t.result || {}
      let detail = ''
      if (typeof r.drafted === 'number' || typeof r.overdue === 'number')
        detail = ` (factures en retard: ${r.overdue ?? '?'}, relances préparées: ${r.drafted ?? 0})`
      else if (typeof r.count === 'number') detail = ` (${r.count} préparé(s))`
      else if (r.reason) detail = ` (ignoré: ${r.reason})`
      else if (r.title) detail = ` (« ${String(r.title).slice(0, 40)} »)`
      else if (r.error) detail = ` (erreur: ${String(r.error).slice(0, 50)})`
      return `- ${new Date(t.created_at).toLocaleDateString('fr-FR')} | ${t.agent_slug} | ${t.action_type} | ${t.status}${detail}`
    }).join('\n') || 'Aucune tâche récente'

    const systemPrompt = `Tu es Baptiste, coordinateur IA de PageLab pour ${user?.prenom || 'le client'} (secteur: ${user?.secteur || 'non précisé'}, plan: ${plan}, limite: ${agentLimit} agents).

AGENTS:
${agentsSummary}

INTÉGRATIONS: ${(integrations || []).map(i => `${i.tool_name}: ${i.is_connected ? 'connecté' : 'non'}`).join(', ') || 'aucune'}

ACTIONS EN ATTENTE DE VALIDATION (${(pending || []).length}):
${(pending || []).map(p => `- ${p.agent_slug}: ${p.summary}`).join('\n') || 'Aucune action en attente'}

HISTORIQUE:
${historySummary}

Règles importantes :
- Rappelle au client qu'AUCUNE action sensible (envoi, publication, paiement) n'est exécutée sans sa validation. C'est lui le patron.
- S'il y a des actions en attente, invite-le à les valider depuis le panneau au-dessus du chat.
- Si un agent a tourné mais n'a rien trouvé à faire (ex: action "skip", ou "relances_prepared" avec 0 résultat), dis-le clairement et positivement (ex: "Marc a vérifié tes factures : aucune en retard, tout est à jour ✅"). Un agent qui ne trouve rien fait quand même son travail.
- Tu peux DÉCLENCHER un agent à la demande quand le client le demande (ex: "écris un article", "fais des posts", "vérifie mes factures").
  IMPORTANT pour le contenu créatif (Léo article, Alex posts, Sophie newsletter) : si le client n'a PAS précisé le SUJET/THÈME, demande-le-lui d'abord en une phrase, NE lance pas l'agent tout de suite. Une fois le thème connu, lance l'agent en passant le thème dans "brief". Après le lancement, préviens que le résultat apparaîtra dans le panneau de validation pour qu'il le relise avant publication.
- Réponds en français, max 150 mots, ton clair et chaleureux. Utilise **gras** pour les points clés.
- Tu peux ajouter sur la dernière ligne UNE seule ACTION JSON pour piloter les agents :
{"action":"pause","agent":"slug"} | {"action":"activate","agent":"slug"} | {"action":"pause_all"} | {"action":"activate_all"} | {"action":"run","agent":"slug","brief":"le thème demandé par le client"}
Agents déclenchables (slug) : marc, leo, sophie, alex, julie, nina, emma, lucas, hugo. N'ajoute le JSON "run" QUE si tu as le thème (ou si l'agent n'a pas besoin de thème comme marc/lucas).`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages || []
      })
    })

    if (!claudeRes.ok) throw new Error(`Claude: ${await claudeRes.text()}`)
    const claudeData = await claudeRes.json()
    let response = claudeData.content[0].text.trim()

    let action = null
    let agentsUpdated = false
    let runResult = null
    // Capture un objet JSON d'action en fin de message (tolère un brief avec guillemets simples)
    const actionMatch = response.match(/(\{[\s\S]*?"action"[\s\S]*?\})\s*$/)
    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        response = response.replace(actionMatch[1], '').trim()
        if (action.action === 'pause') {
          await db('PATCH', 'agents_config', { is_active: false }, `?user_id=eq.${userId}&agent_slug=eq.${action.agent}`)
          agentsUpdated = true
        } else if (action.action === 'activate') {
          await db('PATCH', 'agents_config', { is_active: true }, `?user_id=eq.${userId}&agent_slug=eq.${action.agent}`)
          agentsUpdated = true
        } else if (action.action === 'pause_all') {
          await db('PATCH', 'agents_config', { is_active: false }, `?user_id=eq.${userId}&agent_slug=neq.baptiste`)
          agentsUpdated = true
        } else if (action.action === 'activate_all') {
          await db('PATCH', 'agents_config', { is_active: true }, `?user_id=eq.${userId}&agent_slug=neq.baptiste`)
          agentsUpdated = true
        } else if (action.action === 'run' && action.agent) {
          // Déclenche l'agent à la demande (prépare des actions à valider, n'envoie rien)
          const siteUrl = process.env.SITE_URL || 'https://pagelab.fr'
          try {
            const r = await fetch(`${siteUrl}/.netlify/functions/agent-run`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session, agent: action.agent, brief: action.brief || null })
            })
            runResult = await r.json().catch(() => ({}))
          } catch (e) { runResult = { error: e.message } }
        }
      } catch (e) { console.error('Action parse error:', e) }
    }

    await db('POST', 'tasks_history', {
      user_id: userId, agent_slug: 'baptiste', action_type: 'chat',
      result: { msg: (messages || []).slice(-1)[0]?.content?.slice(0, 80), action },
      status: 'success'
    })

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ response, action, agentsUpdated, runResult }) }
  } catch (err) {
    console.error('baptiste-chat error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
