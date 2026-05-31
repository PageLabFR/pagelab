import { supabase, getHistory } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

export default async () => {
  console.log('📊 Rapport hebdomadaire Baptiste — ' + new Date().toISOString())

  try {
    const { data: users } = await supabase.from('users').select('*').eq('is_active', true)
    if (!users?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })

    let sent = 0
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    for (const user of users) {
      try {
        if (user.plan === 'trial' && new Date(user.trial_ends_at) < new Date()) continue
        if (user.plan === 'cancelled') continue

        const { data: tasks } = await supabase.from('tasks_history')
          .select('*').eq('user_id', user.id).gte('created_at', oneWeekAgo)
          .order('created_at', { ascending: false })

        if (!tasks?.length) continue

        const { data: agents } = await supabase.from('agents_config')
          .select('agent_slug, is_active, next_run_at').eq('user_id', user.id).eq('is_active', true)

        const success = tasks.filter(t => t.status === 'success')
        const errors = tasks.filter(t => t.status === 'error')

        const tasksSummary = success.slice(0, 8).map(t =>
          `- ${t.agent_slug} | ${t.action_type} | ${new Date(t.created_at).toLocaleDateString('fr-FR')}`
        ).join('\n')

        const reportText = await callClaude(`
Tu es Baptiste pour ${user.prenom || 'le client'} (${user.secteur || 'entrepreneur'}).
Rédige un rapport hebdomadaire chaleureux et concis en HTML.
Tâches réussies: ${success.length} | Erreurs: ${errors.length} | Agents actifs: ${agents?.length || 0}
Détails: ${tasksSummary}
Format: <p> et <b> uniquement. Ton de vrai collaborateur. Max 200 mots. Pas de titre h1.
        `, '', 500)

        const nextWeek = (agents || []).map(a => {
          const next = a.next_run_at ? new Date(a.next_run_at).toLocaleDateString('fr-FR') : 'bientôt'
          return `<li>${a.agent_slug.charAt(0).toUpperCase()+a.agent_slug.slice(1)} — ${next}</li>`
        }).join('')

        await sendEmail({
          to: user.email,
          subject: `📊 Rapport hebdomadaire — ${success.length} tâche(s) accomplies cette semaine`,
          html: emailBase(`
            <div class="badge">Rapport du ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1>Bonjour ${user.prenom || ''} 👋</h1>
            ${reportText}
            ${nextWeek ? `<div style="background:#0d0d1a;border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:14px;margin-top:14px">
              <div style="font-size:11px;color:#55556a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Semaine prochaine</div>
              <ul style="font-size:13px;color:#c0c0d8;list-style:none;padding:0;margin:0;line-height:1.8">${nextWeek}</ul>
            </div>` : ''}
          `, 'Parler à Baptiste →', `${process.env.SITE_URL}/baptiste.html`)
        })
        sent++
      } catch (e) { console.error(`Report error for ${user.email}:`, e.message) }
    }

    console.log(`✅ Rapports envoyés: ${sent}`)
    return new Response(JSON.stringify({ sent }), { status: 200 })
  } catch (err) {
    console.error('Weekly report error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { schedule: '0 8 * * 1' }
