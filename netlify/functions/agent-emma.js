import { supabase, logTask, updateAgentRun } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }
function nextMonday(h=9){const d=new Date();const days=(8-d.getDay())%7||7;d.setDate(d.getDate()+days);d.setHours(h,0,0,0);return d.toISOString()}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, agentConfig } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const urls = agentConfig?.competitor_urls || []

    if (!urls.length) {
      await updateAgentRun(userId, 'emma', nextMonday())
      await logTask(userId, 'emma', 'no_competitors', {}, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const data = []
    for (const url of urls.slice(0, 4)) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8000)
        })
        if (!res.ok) continue
        const html = await res.text()
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || url
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500)
        data.push({ url, title, text })
      } catch {}
    }

    if (!data.length) {
      await updateAgentRun(userId, 'emma', nextMonday())
      await logTask(userId, 'emma', 'fetch_failed', {}, 'error')
      return new Response(JSON.stringify({ error: 'fetch failed' }), { status: 200 })
    }

    const report = await callClaude(`
Tu es Emma, agente de veille pour ${user.prenom} (${user.secteur}).
Analyse ces données concurrentes et rédige un rapport HTML concis.
${data.map((c,i) => `Concurrent ${i+1}: ${c.title} (${c.url})\n${c.text}`).join('\n---\n')}
Inclure: points clés détectés, ce qui mérite attention, 2-3 recommandations actionnables.
Format: <h3>, <p>, <ul>. Max 350 mots.
    `, '', 900)

    await updateAgentRun(userId, 'emma', nextMonday())
    await logTask(userId, 'emma', 'veille_done', { competitors: data.length }, 'success', Date.now() - start)

    await sendEmail({ to: user.email, subject: `Emma — Rapport de veille de la semaine 🔍`,
      html: emailBase(`<h1>Veille concurrentielle 🔍</h1><p><b>${data.length} site(s)</b> analysé(s) cette semaine.</p>${report}<p style="font-size:13px;color:#55556a;margin-top:16px">Prochain rapport : lundi prochain.</p>`)
    })

    return new Response(JSON.stringify({ analysed: data.length }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'emma', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/emma' }
