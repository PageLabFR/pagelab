// netlify/functions/actions-approve.js
// Approuve une action en attente ET l'exécute (envoi/publication réels).
// C'est le SEUL endroit où une action irréversible part vraiment.
// Auth : { session, actionId } depuis le dashboard
//   ou  header x-internal-secret=CRON_SECRET + { userId, actionId } (WhatsApp).

const L = require('./_lib')
const RESEND_KEY = process.env.RESEND_API_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// ---- Exécuteurs par type d'action. Renvoie un objet result, ou jette. ----
const EXECUTORS = {
  async send_relance_email(p, ctx) {
    if (!p.to || !p.subject || !p.body) throw new Error('Payload relance incomplet')
    const res = await L.fetchRetry('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Marc (PageLab) <contact@pagelab.fr>', to: p.to, subject: p.subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#222">${String(p.body).replace(/\n/g, '<br>')}</div>`
      })
    })
    if (!res.ok) throw new Error(`Resend: ${await res.text()}`)
    return { sent: p.to, invoice: p.invoiceNumber || null, amount: p.amount || null }
  },

  async send_prospection_email(p, ctx) {
    if (!p.to || !p.body) throw new Error('Payload prospection incomplet')
    const res = await L.fetchRetry('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Julie (PageLab) <contact@pagelab.fr>', to: p.to, subject: p.subject || 'Prise de contact',
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#222">${String(p.body).replace(/\n/g, '<br>')}</div>`
      })
    })
    if (!res.ok) throw new Error(`Resend: ${await res.text()}`)
    return { sent: p.to }
  },

  async publish_wordpress_post(p, ctx) {
    const key = await L.getIntegrationKey(ctx.userId, 'wordpress')
    if (!key) throw new Error('WordPress non connecté')
    // key attendue au format "https://site.com|user:app_password" OU just app password si base_url en config
    let baseUrl = ctx.config?.wordpress_url || null
    let auth = key
    if (key.includes('|')) { const [u, a] = key.split('|'); baseUrl = baseUrl || u; auth = a }
    if (!baseUrl) throw new Error('URL WordPress manquante (config wordpress_url)')
    const res = await L.fetchRetry(`${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${Buffer.from(auth).toString('base64')}` },
      body: JSON.stringify({ title: p.title, content: p.html, status: 'draft', slug: p.slug || undefined })
    })
    if (!res.ok) throw new Error(`WordPress: ${await res.text()}`)
    const data = await res.json()
    return { postId: data.id, status: data.status, link: data.link }
  },

  async send_newsletter_brevo(p, ctx) {
    const key = await L.getIntegrationKey(ctx.userId, 'brevo')
    if (!key) throw new Error('Brevo non connecté')
    const listId = ctx.config?.brevo_list_id
    if (!listId) throw new Error('brevo_list_id manquant en config')
    // Crée puis envoie une campagne email Brevo
    const create = await L.fetchRetry('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify({
        name: `PageLab — ${p.subject}`,
        subject: p.subject,
        sender: { name: ctx.user?.prenom || 'PageLab', email: 'contact@pagelab.fr' },
        htmlContent: p.html,
        recipients: { listIds: [Number(listId)] }
      })
    })
    if (!create.ok) throw new Error(`Brevo create: ${await create.text()}`)
    const camp = await create.json()
    const send = await L.fetchRetry(`https://api.brevo.com/v3/emailCampaigns/${camp.id}/sendNow`, {
      method: 'POST', headers: { 'api-key': key }
    })
    if (!send.ok) throw new Error(`Brevo send: ${await send.text()}`)
    return { campaignId: camp.id }
  },

  async publish_social_zernio(p, ctx) {
    const key = await L.getIntegrationKey(ctx.userId, 'zernio')
    if (!key) throw new Error('Zernio non connecté — connecte tes réseaux dans Intégrations')
    // Comptes sociaux connectés, stockés en config : zernio_accounts = [{platform, accountId}]
    const accounts = ctx.config?.zernio_accounts
    if (!Array.isArray(accounts) || !accounts.length) throw new Error('Aucun compte social connecté dans Zernio')
    const platforms = accounts.map(a => ({ platform: a.platform, accountId: a.accountId }))
    const res = await L.fetchRetry('https://zernio.com/api/v1/posts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: p.text, platforms })
    })
    if (!res.ok) throw new Error(`Zernio: ${await res.text()}`)
    return { published: true, platforms: platforms.map(p => p.platform) }
  },

  async update_shopify_product(p, ctx) {
    const key = await L.getIntegrationKey(ctx.userId, 'shopify')
    if (!key) throw new Error('Shopify non connecté')
    const res = await L.fetchRetry(`https://${p.domain}/admin/api/2024-04/products/${p.productId}.json`, {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: { id: p.productId, body_html: p.html } })
    })
    if (!res.ok) throw new Error(`Shopify: ${await res.text()}`)
    return { productId: p.productId, updated: true }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const body = JSON.parse(event.body || '{}')
    const internal = event.headers['x-internal-secret'] === process.env.CRON_SECRET

    let userId, actionId
    if (internal) { userId = body.userId; actionId = body.actionId }
    else {
      let s; try { s = JSON.parse(Buffer.from(body.session, 'base64url').toString()) }
      catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
      if (s.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
      userId = s.userId; actionId = body.actionId
    }
    if (!userId || !actionId) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Paramètres manquants' }) }

    const rows = await L.db('GET', 'pending_actions', null,
      `?id=eq.${actionId}&user_id=eq.${userId}&status=eq.pending&select=*`)
    const action = rows?.[0]
    if (!action) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Action introuvable ou déjà traitée' }) }

    // Contexte utile aux exécuteurs (user + config de l'agent)
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const cfgRows = await L.db('GET', 'agents_config', null, `?user_id=eq.${userId}&agent_slug=eq.${action.agent_slug}&select=config`)
    const ctx = { userId, user: users?.[0] || {}, config: cfgRows?.[0]?.config || {} }

    let result, newStatus
    try {
      const exec = EXECUTORS[action.action_type]
      if (!exec) throw new Error(`Type d'action non supporté: ${action.action_type}`)
      result = await exec(action.payload || {}, ctx)
      newStatus = 'executed'
    } catch (e) {
      result = { error: e.message }; newStatus = 'failed'
    }

    await L.db('PATCH', 'pending_actions',
      { status: newStatus, decided_at: new Date().toISOString(), result }, `?id=eq.${actionId}`)
    await L.logTask(userId, action.agent_slug, action.action_type,
      newStatus === 'executed' ? 'success' : 'error', result)

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: newStatus === 'executed', status: newStatus, result }) }
  } catch (err) {
    console.error('actions-approve error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
