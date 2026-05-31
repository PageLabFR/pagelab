import { supabase, getIntegration, logTask } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyAuth(req) {
  return req.headers.get('x-cron-secret') === process.env.CRON_SECRET ||
         req.headers.get('x-from-baptiste') === process.env.CRON_SECRET
}

export default async (req) => {
  if (!verifyAuth(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId, productData, platform: reqPlatform } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const shopifyInt = await getIntegration(userId, 'shopify')
    const wooInt = await getIntegration(userId, 'woocommerce')
    const platform = reqPlatform || (shopifyInt ? 'shopify' : wooInt ? 'woocommerce' : null)

    if (!platform) {
      await logTask(userId, 'nina', 'skip', { reason: 'no platform' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const raw = await callClaude(`
Tu es Nina, agente fiches produits. Génère une fiche produit optimisée SEO en JSON strict.
Produit brut: ${JSON.stringify(productData || {})}
Secteur: ${user.secteur}
Retourne UNIQUEMENT ce JSON:
{"title":"Titre produit SEO (60 chars)","body_html":"Description HTML complète et persuasive (min 150 mots)","seo_title":"Meta title (60 chars)","seo_description":"Meta description (155 chars)","tags":["tag1","tag2","tag3"]}
    `, '', 1200)

    let product
    try { product = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { throw new Error('JSON produit invalide') }

    let publishedUrl = null

    if (platform === 'shopify' && shopifyInt) {
      const shopUrl = shopifyInt.extra_config?.shop_url || ''
      const res = await fetch(`${shopUrl}/admin/api/2024-01/products.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': shopifyInt.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: { ...product, status: 'active' } })
      })
      if (res.ok) { const d = await res.json(); publishedUrl = `${shopUrl}/products/${d.product?.handle}` }
    } else if (platform === 'woocommerce' && wooInt) {
      const siteUrl = wooInt.extra_config?.site_url || ''
      const auth = Buffer.from(`${wooInt.extra_config?.consumer_key}:${wooInt.api_key}`).toString('base64')
      const res = await fetch(`${siteUrl}/wp-json/wc/v3/products`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: product.title, description: product.body_html, status: 'publish', tags: product.tags.map(t => ({ name: t })) })
      })
      if (res.ok) { const d = await res.json(); publishedUrl = d.permalink }
    }

    await logTask(userId, 'nina', 'product_created', { title: product.title, platform, url: publishedUrl }, 'success', Date.now() - start)

    await sendEmail({ to: user.email, subject: `Nina a créé une fiche produit : ${product.title} 🛍️`,
      html: emailBase(`<h1>Fiche produit créée ✓</h1><p><b>${product.title}</b> — ${platform}</p>`,
        publishedUrl ? 'Voir le produit →' : null, publishedUrl)
    })

    return new Response(JSON.stringify({ created: true, title: product.title, url: publishedUrl }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'nina', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/nina' }
