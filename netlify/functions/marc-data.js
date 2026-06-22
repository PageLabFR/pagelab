// netlify/functions/marc-data.js
// Lecture seule : renvoie les vraies factures Stripe de l'artisan pour l'atelier Marc.
// Ne crée AUCUNE relance (ça reste le rôle d'agent-marc + actions-approve).
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
    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    const { userId } = sessionData

    const stripeKey = await L.getIntegrationKey(userId, 'stripe')
    if (!stripeKey) {
      // Pas connecté : on le dit clairement, pas de fausses données.
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ connected: false }) }
    }

    const nowSec = Math.floor(Date.now() / 1000)

    // Factures ouvertes (impayées)
    const openRes = await L.fetchRetry('https://api.stripe.com/v1/invoices?status=open&limit=100', {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    })
    if (!openRes.ok) throw new Error(`Stripe: ${await openRes.text()}`)
    const openData = await openRes.json()

    // Factures payées récemment (pour le "récupéré ce mois")
    const paidRes = await L.fetchRetry('https://api.stripe.com/v1/invoices?status=paid&limit=100', {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    })
    const paidData = paidRes.ok ? await paidRes.json() : { data: [] }

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const monthStartSec = Math.floor(monthStart.getTime() / 1000)

    // Récupère les actions Marc : pending (préparées) + executed (relances envoyées)
    const pending = await L.db('GET', 'pending_actions', null,
      `?user_id=eq.${userId}&agent_slug=eq.marc&status=in.(pending,scheduled)&select=id,payload,status`) || []
    const sent = await L.db('GET', 'pending_actions', null,
      `?user_id=eq.${userId}&agent_slug=eq.marc&status=eq.executed&order=decided_at.desc&select=summary,payload,decided_at&limit=30`) || []

    // Compte les relances envoyées par facture (clé = invoiceId)
    const relancesByInvoice = {}
    for (const a of sent) {
      const invId = a.payload?.invoiceId
      if (invId) relancesByInvoice[invId] = (relancesByInvoice[invId] || 0) + 1
    }

    let toRecover = 0, recoveredMonth = 0, overdueCount = 0
    const invoices = (openData.data || []).map(i => {
      const amount = (i.amount_due || 0) / 100
      toRecover += amount
      const overdue = i.due_date && i.due_date < nowSec
      if (overdue) overdueCount++
      const daysLate = overdue ? Math.floor((nowSec - i.due_date) / 86400) : 0
      const nbRelances = relancesByInvoice[i.id] || 0
      return {
        client: i.customer_name || i.customer_email || 'Client',
        amount: amount.toFixed(2),
        currency: (i.currency || 'eur').toUpperCase(),
        status: nbRelances > 0 ? 'relance' : (overdue ? 'retard' : 'envoyee'),
        nbRelances,
        daysLate
      }
    }).sort((a, b) => b.daysLate - a.daysLate)

    for (const i of (paidData.data || [])) {
      if ((i.status_transitions?.paid_at || 0) >= monthStartSec) {
        recoveredMonth += (i.amount_paid || 0) / 100
      }
    }

    // Historique lisible des relances envoyées
    const history = sent.slice(0, 10).map(a => ({
      date: a.decided_at ? new Date(a.decided_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '',
      label: a.summary || 'Relance envoyée'
    }))

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        connected: true,
        toRecover: toRecover.toFixed(2),
        recoveredMonth: recoveredMonth.toFixed(2),
        overdueCount,
        pendingRelances: pending.length,
        sentCount: sent.length,
        invoices: invoices.slice(0, 12),
        history
      })
    }
  } catch (err) {
    console.error('marc-data error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
