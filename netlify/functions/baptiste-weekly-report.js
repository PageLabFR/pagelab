const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

exports.handler = async () => {
  console.log('Rapport hebdomadaire — ' + new Date().toISOString())

  try {
    const { data: users } = await supabase.from('users').select('*').eq('is_active', true)
    if (!users?.length) return { statusCode: 200, body: JSON.stringify({ sent: 0 }) }

    let sent = 0
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    for (const user of users) {
      try {
        if (user.plan === 'cancelled') continue
        if (user.plan === 'trial' && new Date(user.trial_ends_at) < new Date()) continue

        const { data: tasks } = await supabase.from('tasks_history')
          .select('*').eq('user_id', user.id).gte('created_at', oneWeekAgo)
          .order('created_at', { ascending: false })

        if (!tasks?.length) continue

        const success = tasks.filter(t => t.status === 'success').length
        const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:40px 24px;background:#07070f;font-family:Arial,sans-serif;color:#eeeef8}.logo{font-size:22px;font-weight:800;color:#fff;margin-bottom:32px}.logo span{color:#7c3aed}.card{background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px}h1{font-size:22px;font-weight:800;color:#fff;margin:0 0 14px}p{font-size:15px;color:#9898b8;line-height:1.75;margin:0 0 14px}.cta{display:inline-block;padding:13px 28px;background:#7c3aed;color:#fff !important;border-radius:50px;font-size:15px;font-weight:600;text-decoration:none;margin:16px 0}.badge{display:inline-block;padding:4px 12px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);border-radius:50px;font-size:12px;color:#c4b5fd;margin-bottom:16px}</style></head><body><div class="logo">Page<span>Lab</span></div><div class="card"><div class="badge">Rapport du ${date}</div><h1>Bonjour ${user.prenom || ''} 👋</h1><p>Votre équipe a accompli <b>${success} tâche(s)</b> cette semaine.</p><p>Vos agents continuent de travailler en autonomie. Parlez à Baptiste pour voir le détail ou modifier vos paramètres.</p><a href="${process.env.SITE_URL}/baptiste.html" class="cta">Parler à Baptiste →</a></div></body></html>`

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'Baptiste <contact@pagelab.fr>',
            to: user.email,
            subject: `📊 ${success} tâche(s) accomplies cette semaine`,
            html
          })
        })
        sent++
      } catch (e) { console.error('Report error:', e.message) }
    }

    return { statusCode: 200, body: JSON.stringify({ sent }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
