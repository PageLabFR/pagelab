// netlify/functions/agent-nina.js
// Nina — Fiches produits. Récupère des produits sans description sur Shopify
// (ou WooCommerce), génère une fiche optimisée et la met EN ATTENTE.
// La mise à jour réelle de la boutique se fait après validation.
// NB: déclenché à la demande (next_run_at peut être null), pas par le cron auto.

const L = require('./_lib')
const MAX_PER_RUN = 10

async function fetchShopifyProducts(domain, token) {
  // domain attendu: "ma-boutique.myshopify.com"
  const res = await L.fetchRetry(`https://${domain}/admin/api/2024-04/products.json?limit=50`, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
  })
  if (!res.ok) throw new Error(`Shopify: ${await res.text()}`)
  const data = await res.json()
  return (data.products || [])
}

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]

    const shopifyKey = await L.getIntegrationKey(userId, 'shopify')
    const domain = agentConfig?.shopify_domain
    if (!shopifyKey || !domain) {
      await L.logTask(userId, 'nina', 'skip', 'skipped', { reason: 'no shopify config' })
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) }
    }

    const products = await fetchShopifyProducts(domain, shopifyKey)
    const needDesc = products.filter(p => !p.body_html || p.body_html.trim().length < 20).slice(0, MAX_PER_RUN)

    let created = 0
    for (const p of needDesc) {
      const prompt = `Tu es Nina, rédactrice de fiches produits pour ${user?.prenom || 'une boutique'} (secteur: ${user?.secteur || 'général'}).
Rédige une description produit vendeuse et honnête en français pour : "${p.title}".
Règles : 60-120 mots, met en avant bénéfices et usages, n'invente AUCUNE caractéristique technique non fournie. Réponds uniquement par le texte de la description (HTML simple <p> autorisé).`
      let desc
      try { desc = await L.callClaude(prompt, { max_tokens: 400 }) } catch (e) { console.error('nina draft', e.message); continue }

      const ok = await L.queueAction(userId, 'nina', 'update_shopify_product',
        `Mettre à jour la fiche : « ${p.title} »`,
        { productId: p.id, domain, title: p.title, html: desc },
        `product-${p.id}`)
      if (ok) created++
    }

    await L.logTask(userId, 'nina', 'product_descriptions_drafted', 'success', { scanned: products.length, drafted: created }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, scanned: products.length, drafted: created }) }
  } catch (err) {
    console.error('Nina error:', err.message)
    await L.logTask(userId, 'nina', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
