const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'

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

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error(`Claude: ${await res.text()}`)
  const data = await res.json()
  return data.content[0].text
}

exports.handler = async (event) => {
  if (event.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' }
  }

  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const integrations = await db('GET', 'integrations', null,
      `?user_id=eq.${userId}&tool_name=eq.notion&is_connected=eq.true&select=*`)
    const notionInt = integrations?.[0]

    if (!notionInt?.api_key) {
      await db('POST', 'tasks_history', {
        user_id: userId, agent_slug: 'hugo',
        action_type: 'skip', result: { reason: 'no notion' }, status: 'skipped'
      })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    // Get last week tasks
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const history = await db('GET', 'tasks_history', null,
      `?user_id=eq.${userId}&created_at=gte.${oneWeekAgo}&status=eq.success&order=created_at.desc&limit=20&select=*`)

    const tasksSummary = (history || []).map(t =>
      `- ${t.agent_slug}: ${t.action_type} (${new Date(t.created_at).toLocaleDateString('fr-FR')})`
    ).join('\n') || 'Aucune tâche cette semaine'

    // Generate report with Claude
    const reportContent = await callClaude(`
Tu es Hugo, agent Notion pour ${user?.prenom} (${user?.secteur}).
Crée un résumé de rapport hebdomadaire en français pour Notion.
Tâches accomplies cette semaine:
${tasksSummary}
Format: texte simple, bullet points avec •, max 200 mots. Ton professionnel et positif.
    `)

    // Create Notion page
    const dbId = agentConfig?.notion_database_id
    if (dbId) {
      const notionRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionInt.api_key}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: {
            title: {
              title: [{
                text: { content: `Rapport PageLab — semaine du ${new Date().toLocaleDateString('fr-FR')}` }
              }]
            }
          },
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: reportContent } }]
            }
          }]
        })
      })

      if (!notionRes.ok) throw new Error(`Notion: ${await notionRes.text()}`)
    }

    // Update next run (every monday)
    const d = new Date()
    const days = (8 - d.getDay()) % 7 || 7
    d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0)

    await db('PATCH', 'agents_config',
      { last_run_at: new Date().toISOString(), next_run_at: d.toISOString() },
      `?user_id=eq.${userId}&agent_slug=eq.hugo`)

    await db('POST', 'tasks_history', {
      user_id: userId, agent_slug: 'hugo',
      action_type: 'notion_report_created',
      result: { tasks_logged: (history || []).length },
      status: 'success',
      duration_ms: Date.now() - start
    })

    // Notify by email
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Hugo <contact@pagelab.fr>',
        to: user.email,
        subject: `Hugo — Rapport hebdomadaire créé dans Notion 📋`,
        html: `<!DOCTYPE html><html><body style="background:#07070f;color:#eeeef8;font-family:Arial,sans-serif;padding:40px 24px"><div style="max-width:560px;margin:0 auto"><div style="font-size:22px;font-weight:800;margin-bottom:32px">Page<span style="color:#7c3aed">Lab</span></div><div style="background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px"><h1 style="font-size:20px;color:#fff;margin:0 0 12px">Rapport Notion créé ✓</h1><p style="color:#9898b8;line-height:1.7">${(history||[]).length} tâche(s) de la semaine ont été loggées dans votre Notion.</p></div></div></body></html>`
      })
    })

    return { statusCode: 200, body: JSON.stringify({ success: true, tasks: (history || []).length }) }
  } catch (err) {
    console.error('Hugo error:', err.message)
    await db('POST', 'tasks_history', {
      user_id: userId, agent_slug: 'hugo',
      action_type: 'error', result: { error: err.message }, status: 'error'
    })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
