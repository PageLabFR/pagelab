// AGENT SOPHIE — Newsletter Brevo
import { supabase, getIntegration, logTask, updateAgentRun, getHistory } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }
function nextFirstOfMonth(h=9){const d=new Date();d.setMonth(d.getMonth()+1,1);d.setHours(h,0,0,0);return d.toISOString()}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, agentConfig } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const brevoInt = await getIntegration(userId, 'brevo')

    if (!brevoInt?.api_key) {
      await logTask(userId, 'sophie', 'skip', { reason: 'no brevo' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const history = await getHistory(userId, 15)
    const tasksSummary = history.filter(t => t.status === 'success').slice(0, 6)
      .map(t => `- ${t.agent_slug}: ${t.action_type}`).join('\n')

    const monthName = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })
    const tone = agentConfig?.tone || 'professionnel et chaleureux'

    const raw = await callClaude(`
Tu es Sophie, agent newsletter. Génère une newsletter mensuelle en JSON strict.
Client: ${user.prenom}, secteur: ${user.secteur}, mois: ${monthName}, ton: ${tone}
Activités du mois: ${tasksSummary || 'Premier envoi'}
Retourne UNIQUEMENT ce JSON:
{"subject":"Objet accrocheur (50 chars max)","html_content":"Corps HTML complet de la newsletter avec style inline, sections claires, contenu de valeur. Min 300 mots."}
    `, '', 2000)

    let nl
    try { nl = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { throw new Error('JSON newsletter invalide') }

    // Create and send Brevo campaign
    const campaignRes = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: { 'api-key': brevoInt.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Newsletter ${monthName} — ${user.email}`,
        subject: nl.subject,
        htmlContent: nl.html_content,
        sender: { name: user.prenom || 'PageLab', email: 'contact@pagelab.fr' },
        replyTo: { email: user.email },
        ...(agentConfig?.list_id ? { recipients: { listIds: [parseInt(agentConfig.list_id)] } } : {})
      })
    })
    if (!campaignRes.ok) throw new Error(`Brevo campaign: ${await campaignRes.text()}`)
    const campaign = await campaignRes.json()

    // Send now
    if (campaign.id) {
      await fetch(`https://api.brevo.com/v3/emailCampaigns/${campaign.id}/sendNow`, {
        method: 'POST', headers: { 'api-key': brevoInt.api_key }
      })
    }

    await updateAgentRun(userId, 'sophie', nextFirstOfMonth())
    await logTask(userId, 'sophie', 'newsletter_sent', { subject: nl.subject, campaignId: campaign.id }, 'success', Date.now() - start)

    await sendEmail({ to: user.email, subject: `Sophie a envoyé votre newsletter 📧`,
      html: emailBase(`<h1>Newsletter envoyée ✓</h1><p>Sujet : <b>${nl.subject}</b></p><p style="font-size:13px;color:#55556a">Prochain envoi : 1er du mois prochain.</p>`)
    })

    return new Response(JSON.stringify({ sent: true, subject: nl.subject }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'sophie', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/sophie' }
