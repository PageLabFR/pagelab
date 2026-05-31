const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const PRICE_IDS = {
  solo: 'price_1TWDWC1FzE1O4WqO1sNkinsV',
  pro: 'price_1TWDWQ1FzE1O4WqO3W6fTURB',
  agence: 'price_1TWDWe1FzE1O4WqOrpJOX4Pk'
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { plan, session } = JSON.parse(event.body || '{}')
    if (!PRICE_IDS[plan]) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Plan invalide' }) }

    let email = null
    if (session) {
      try { email = JSON.parse(Buffer.from(session, 'base64url').toString()).email } catch {}
    }

    const siteUrl = process.env.SITE_URL || 'https://pagelab.fr'
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': PRICE_IDS[plan],
      'line_items[0][quantity]': '1',
      success_url: `${siteUrl}/baptiste.html?payment=success&s=${session || ''}`,
      cancel_url: `${siteUrl}/billing.html?payment=cancelled`,
      allow_promotion_codes: 'true',
    })
    if (email) params.set('customer_email', email)

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })

    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ url: data.url }) }
  } catch (err) {
    console.error('stripe-checkout error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
