import { supabase, getIntegration, logTask, updateAgentRun } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }
function nextDay(h=8){const d=new Date();d.setDate(d.getDate()+1);d.setHours(h,0,0,0);return d.toISOString()}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, agentConfig } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const brevoInt = await getIntegration(userId, 'brevo')

    if (!brevoInt?.api_key) {
      await logTask(userId, 'julie', 'skip', { reason: 'no brevo' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const prospects = agentConfig?.prospects || []
    if (!prospects.length) {
      await updateAgentRun(userId, 'julie', nextDay())
      await logTask(userId, 'julie', 'no_prospects', {}, 'skipped')
      return new Response(JSON.stringify({ skipped: true, reason: 'no prospects' }), { status: 200 })
    }

    const now = Date.now()
    const toContact = prospects.filter(p => {
      if (!p.last_contact) return true
      const days = (now - new Date(p.last_contact).getTime()) / 86400000
      return (p.step === 1 && days >= 3) || (p.step === 2 && days >= 7)
    }).slice(0, 8)

    let sent = 0
    for (const p of toContact) {
      if (!p.email) continue
      const isFollowUp = (p.step || 0) > 0
      const body = await callClaude(`
Email de prospection ${isFollowUp ? `suivi (relance ${p.step})` : 'initial'} pour ${user.prenom} (${user.secteur}).
Prospect: ${p.prenom || ''} — ${p.entreprise || ''} — ${p.secteur || ''}
Règles: max 100 mots, humain et personnalisé, CTA simple (10 min d'appel ?).
Retourne UNIQUEMENT le corps HTML avec balises <p>.
      `, '', 400)

      await sendEmail({
        to: p.email,
        subject: isFollowUp ? `Suite de mon message — ${user.prenom}` : `${p.prenom ? p.prenom + ', ' : ''}une question rapide`,
        html: emailBase(`<h1>${isFollowUp ? 'Suite de notre échange' : `Bonjour ${p.prenom || ''}`}</h1>${body}`),
        from: `${user.prenom || 'PageLab'} <contact@pagelab.fr>`
      })

      p.last_contact = new Date().toISOString()
      p.step = (p.step || 0) + 1
      sent++
    }

    // Save updated prospects
    await supabase.from('agents_config')
      .update({ config: { ...agentConfig, prospects } })
      .eq('user_id', userId).eq('agent_slug', 'julie')

    await updateAgentRun(userId, 'julie', nextDay())
    await logTask(userId, 'julie', 'emails_sent', { sent }, 'success', Date.now() - start)

    if (sent > 0) {
      await sendEmail({ to: user.email, subject: `Julie a contacté ${sent} prospect(s) aujourd'hui 📨`,
        html: emailBase(`<h1>Prospection du jour 📨</h1><p><b>${sent} email(s)</b> envoyé(s) aujourd'hui.</p>`)
      })
    }

    return new Response(JSON.stringify({ sent }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'julie', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/julie' }
