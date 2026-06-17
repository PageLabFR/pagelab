// netlify/functions/stripe-checkout.js
// Crée une session Stripe Checkout pour l'abonnement PageLab (essai 14 jours).
// Requiert les variables d'env : STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SITE_URL.
// Auth : { session } (base64url {userId, exp}).

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1TiY0Z1FzE1O4WqOFhjq4MyZ'   // pack agents à vie (19€)
const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

async function db(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Config Stripe incomplète (STRIPE_SECRET_KEY / STRIPE_PRICE_ID)' }) }
    }

    const { session } = JSON.parse(event.body || '{}')
    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }
    const { userId } = sessionData

    // Récupère l'email de l'utilisateur (pré-rempli dans Checkout)
    const users = await db('GET', 'users', null, `?id=eq.${userId}&limit=1&select=email,stripe_customer_id`)
    const user = (users && users[0]) || {}

    // Construit la requête Checkout (form-urlencoded, l'API Stripe ne prend pas du JSON ici)
    const params = new URLSearchParams()
    params.append('mode', 'subscription')
    params.append('line_items[0][price]', STRIPE_PRICE_ID)
    params.append('line_items[0][quantity]', '1')
    params.append('subscription_data[trial_period_days]', '14')
    params.append('success_url', `${SITE_URL}/dashboard.html?paye=1`)
    params.append('cancel_url', `${SITE_URL}/dashboard.html?paiement_annule=1`)
    params.append('client_reference_id', String(userId))
    params.append('metadata[userId]', String(userId))
    if (user.email) params.append('customer_email', user.email)
    params.append('allow_promotion_codes', 'true')

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })
    const data = await res.json()
    if (!res.ok) {
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: data.error?.message || 'Erreur Stripe' }) }
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ url: data.url }) }
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
