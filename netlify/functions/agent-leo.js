import { supabase, getIntegration, logTask, updateAgentRun } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }
function nextMonday(h=8){const d=new Date();const days=(8-d.getDay())%7||7;d.setDate(d.getDate()+days);d.setHours(h,0,0,0);return d.toISOString()}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, agentConfig } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const wpInt = await getIntegration(userId, 'wordpress')

    if (!wpInt?.api_key || !wpInt?.extra_config?.site_url) {
      await logTask(userId, 'leo', 'skip', { reason: 'no wordpress' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const siteUrl = wpInt.extra_config.site_url.replace(/\/$/, '')
    const username = wpInt.extra_config.username || 'admin'
    const auth = Buffer.from(`${username}:${wpInt.api_key}`).toString('base64')

    // Get recent posts to avoid duplicates
    const recentRes = await fetch(`${siteUrl}/wp-json/wp/v2/posts?per_page=5&orderby=date`, {
      headers: { 'Authorization': `Basic ${auth}` }
    })
    const recent = recentRes.ok ? await recentRes.json() : []
    const recentTitles = recent.map(p => p.title?.rendered || '').join(' | ')

    const keywords = agentConfig?.keywords || [user.secteur || 'services']
    const ville = agentConfig?.ville || ''
    const style = agentConfig?.style || 'professionnel et clair'

    const raw = await callClaude(`
Tu es Léo, agent SEO. Génère un article de blog WordPress optimisé SEO en JSON strict.
Secteur: ${user.secteur} | Mots-clés: ${keywords.join(', ')} | Localisation: ${ville || 'France'} | Style: ${style}
Articles récents (à ne pas dupliquer): ${recentTitles || 'aucun'}
Retourne UNIQUEMENT ce JSON valide:
{"title":"Titre SEO accrocheur (60 chars max)","slug":"slug-url","excerpt":"Meta description 155 chars","content":"<article HTML complet avec <h2>, <p>, <ul>. Min 600 mots. SEO naturel.>","tags":["tag1","tag2","tag3"]}
    `, '', 2500)

    let article
    try { article = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { throw new Error('JSON invalide de Claude') }

    const pubRes = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: article.title, slug: article.slug,
        content: article.content, excerpt: article.excerpt,
        status: 'publish'
      })
    })
    if (!pubRes.ok) throw new Error(`WordPress: ${await pubRes.text()}`)
    const published = await pubRes.json()

    await updateAgentRun(userId, 'leo', nextMonday())
    await logTask(userId, 'leo', 'article_published', {
      title: article.title, url: published.link
    }, 'success', Date.now() - start)

    await sendEmail({
      to: user.email,
      subject: `Léo a publié un article sur votre site 📝`,
      html: emailBase(`
        <h1>Article publié ✓</h1>
        <p><b>${article.title}</b></p>
        <p>Optimisé pour : <b>${keywords.join(', ')}</b></p>
        <p style="font-size:13px;color:#55556a">Prochain article : lundi prochain à 8h.</p>
      `, 'Voir l\'article →', published.link)
    })

    return new Response(JSON.stringify({ published: true, title: article.title, url: published.link }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'leo', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/leo' }
