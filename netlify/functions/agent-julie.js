// netlify/functions/agent-julie.js
// Julie — Prospection. Prépare des emails de prise de contact et les met EN
// ATTENTE. Envoi réel via Brevo après validation. Utilise les "leads" stockés
// dans agents_config.config.leads = [{name,email,company}] si présents.

const L = require('./_lib')
const MAX_PER_RUN = 10

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const brevoKey = await L.getIntegrationKey(userId, 'brevo')
    if (!brevoKey) {
      await L.logTask(userId, 'julie', 'skip', 'skipped', { reason: 'no brevo' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const leads = Array.isArray(agentConfig?.leads) ? agentConfig.leads.slice(0, MAX_PER_RUN) : []
    if (!leads.length) {
      await L.logTask(userId, 'julie', 'skip', 'skipped', { reason: 'no leads' })
      await L.reschedule(userId, 'julie', L.tomorrow9h())
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no leads' }) }
    }

    let created = 0
    for (const lead of leads) {
      if (!lead?.email) continue
      const prompt = `Tu es Julie, en charge de la prospection pour ${user?.prenom || 'un professionnel'} (secteur: ${user?.secteur || 'général'}).
Rédige un email de premier contact COURT et personnalisé en français pour ${lead.name || 'un prospect'}${lead.company ? ` (entreprise: ${lead.company})` : ''}.
Règles : 3-5 phrases, pas de spam, propose un échange, ton humain. Réponds uniquement par le corps de l'email.`
      let body
      try { body = await L.callClaude(prompt, { max_tokens: 400 }) } catch (e) { console.error('julie draft', e.message); continue }

      const ok = await L.queueAction(userId, 'julie', 'send_prospection_email',
        `Email de prospection à ${lead.name || lead.email}`,
        { to: lead.email, subject: `Prise de contact`, body },
        `lead-${lead.email}`)
      if (ok) created++
    }

    await L.reschedule(userId, 'julie', L.tomorrow9h())
    await L.logTask(userId, 'julie', 'prospection_drafted', 'success', { count: created }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, drafted: created }) }
  } catch (err) {
    console.error('Julie error:', err.message)
    await L.logTask(userId, 'julie', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
