import { supabase, getIntegration, logTask, updateAgentRun, getHistory } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }

function nextPostDay(days = [1,3,5]) {
  const d = new Date(); d.setDate(d.getDate() + 1)
  while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0); return d.toISOString()
}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, agentConfig } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const bufferInt = await getIntegration(userId, 'buffer')

    if (!bufferInt?.api_key) {
      await logTask(userId, 'alex', 'skip', { reason: 'no buffer' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const history = await getHistory(userId, 6)
    const recentPosts = history.filter(t => t.agent_slug === 'alex').slice(0, 3)
      .map(t => t.result?.text_preview || '').filter(Boolean).join(' | ')

    const tone = agentConfig?.tone || 'professionnel et engageant'

    const raw = await callClaude(`
Tu es Alex, agent social media. Génère un post LinkedIn/Instagram.
Secteur: ${user.secteur}, ton: ${tone}, jour: ${new Date().toLocaleDateString('fr-FR', { weekday: 'long' })}
Posts récents (ne pas répéter): ${recentPosts || 'aucun'}
Retourne UNIQUEMENT ce JSON:
{"text":"Post complet avec emojis et hashtags pertinents. Max 1300 chars. Naturel, pas corporate.","type":"conseil|témoignage|astuce|question|coulisses"}
    `, '', 700)

    let post
    try { post = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { throw new Error('JSON post invalide') }

    // Get Buffer profiles
    const profilesRes = await fetch('https://api.bufferapp.com/1/profiles.json', {
      headers: { 'Authorization': `Bearer ${bufferInt.api_key}` }
    })
    if (!profilesRes.ok) throw new Error('Buffer profiles error')
    const profiles = await profilesRes.json()
    if (!profiles.length) throw new Error('No Buffer profiles')

    // Post now
    const postRes = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bufferInt.api_key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text: post.text, 'profile_ids[]': profiles[0].id, now: 'true' })
    })
    if (!postRes.ok) throw new Error(`Buffer post: ${await postRes.text()}`)

    const postDays = agentConfig?.post_days || [1, 3, 5]
    await updateAgentRun(userId, 'alex', nextPostDay(postDays))
    await logTask(userId, 'alex', 'post_published', { type: post.type, text_preview: post.text.slice(0, 100) }, 'success', Date.now() - start)

    await sendEmail({ to: user.email, subject: `Alex a publié sur vos réseaux 📱`,
      html: emailBase(`<h1>Post publié ✓</h1><p style="background:#0d0d1a;border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:14px;font-size:14px;color:#c0c0d8;line-height:1.7">${post.text.slice(0,200)}…</p>`)
    })

    return new Response(JSON.stringify({ published: true }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'alex', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/alex' }
