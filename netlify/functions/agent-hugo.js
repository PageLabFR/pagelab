// netlify/functions/agent-hugo.js
// Hugo — Rapport Notion. Compile les tâches de la semaine et crée une page
// Notion récap (espace de l'utilisateur -> pas de validation tierce requise).

const L = require('./_lib')
const RESEND_KEY = process.env.RESEND_API_KEY

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const notionKey = await L.getIntegrationKey(userId, 'notion')
    if (!notionKey) {
      await L.logTask(userId, 'hugo', 'skip', 'skipped', { reason: 'no notion' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const history = await L.db('GET', 'tasks_history', null,
      `?user_id=eq.${userId}&created_at=gte.${since}&status=eq.success&order=created_at.desc&limit=30&select=agent_slug,action_type,created_at`)
    const summaryLines = (history || []).map(t =>
      `- ${t.agent_slug}: ${t.action_type} (${new Date(t.created_at).toLocaleDateString('fr-FR')})`).join('\n') || 'Aucune tâche cette semaine'

    const reportContent = await L.callClaude(
      `Tu es Hugo, assistant de reporting pour ${user?.prenom || 'un professionnel'} (${user?.secteur || 'général'}).
Rédige un résumé hebdomadaire en français à partir de ces tâches :
${summaryLines}
Format : texte simple, puces "•", max 200 mots, ton professionnel et positif.`,
      { max_tokens: 800 })

    const dbId = agentConfig?.notion_database_id
    if (dbId) {
      const notionRes = await L.fetchRetry('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${notionKey}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: { title: { title: [{ text: { content: `Rapport PageLab — ${new Date().toLocaleDateString('fr-FR')}` } }] } },
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: reportContent } }] } }]
        })
      })
      if (!notionRes.ok) throw new Error(`Notion: ${await notionRes.text()}`)
    }

    await L.reschedule(userId, 'hugo', L.nextMonday8h())
    await L.logTask(userId, 'hugo', 'notion_report_created', 'success', { tasks_logged: (history || []).length }, Date.now() - start)

    if (RESEND_KEY && user?.email) {
      await L.fetchRetry('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'Hugo (PageLab) <contact@pagelab.fr>', to: user.email,
          subject: `Hugo — rapport hebdomadaire créé`,
          html: `<div style="font-family:Arial,sans-serif"><h2>Rapport de la semaine</h2><p>${(history || []).length} tâche(s) compilées${dbId ? ' et envoyées dans votre Notion' : ''}.</p></div>`
        })
      })
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, tasks: (history || []).length }) }
  } catch (err) {
    console.error('Hugo error:', err.message)
    await L.logTask(userId, 'hugo', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
