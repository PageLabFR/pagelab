// netlify/functions/lucas-data.js
// Lecture seule : trésorerie réelle depuis Stripe (entrées sur 6 mois + solde dispo).
// Auth : ?s=<session base64url>.
const L = require('./_lib')

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  try {
    const session = event.queryStringParameters?.s
    let sd
    try { sd = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sd.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    const { userId } = sd

    const stripeKey = await L.getIntegrationKey(userId, 'stripe')
    if (!stripeKey) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ connected: false }) }

    // Entrées : charges réussies des 6 derniers mois, regroupées par mois
    const since = Math.floor((Date.now() - 183 * 24 * 60 * 60 * 1000) / 1000)
    const res = await L.fetchRetry(`https://api.stripe.com/v1/charges?created[gte]=${since}&limit=100`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    })
    if (!res.ok) throw new Error(`Stripe: ${await res.text()}`)
    const data = await res.json()
    const charges = (data.data || []).filter(c => c.paid && c.status === 'succeeded')

    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('fr-FR', { month: 'short' }), total: 0 })
    }
    let monthInCents = 0
    const curKey = `${now.getFullYear()}-${now.getMonth()}`
    const currency = (charges[0]?.currency || 'eur').toUpperCase()
    for (const c of charges) {
      const d = new Date((c.created || 0) * 1000)
      const k = `${d.getFullYear()}-${d.getMonth()}`
      const m = months.find(x => x.key === k)
      if (m) m.total += (c.amount || 0) / 100
      if (k === curKey) monthInCents += (c.amount || 0)
    }

    // Solde Stripe (dispo + en attente)
    let balanceAvailable = null
    try {
      const bres = await L.fetchRetry('https://api.stripe.com/v1/balance', { headers: { 'Authorization': `Bearer ${stripeKey}` } })
      if (bres.ok) {
        const b = await bres.json()
        const av = (b.available || []).reduce((s, x) => s + (x.amount || 0), 0)
        const pe = (b.pending || []).reduce((s, x) => s + (x.amount || 0), 0)
        balanceAvailable = ((av + pe) / 100).toFixed(2)
      }
    } catch (e) {}

    const maxMonth = Math.max(1, ...months.map(m => m.total))
    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        connected: true,
        currency,
        entriesMonth: (monthInCents / 100).toFixed(2),
        balance: balanceAvailable,
        chart: months.map(m => ({ label: m.label, pct: Math.round(m.total / maxMonth * 100), total: m.total.toFixed(0) })),
        count: charges.length
      })
    }
  } catch (err) {
    console.error('lucas-data error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
