export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200 })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const PRICE_IDS = {
    solo: 'price_1TWDWC1FzE1O4WqO1sNkinsV',
    pro: 'price_1TWDWQ1FzE1O4WqO3W6fTURB',
    agence: 'price_1TWDWe1FzE1O4WqOrpJOX4Pk'
  }

  try {
    const { plan, session } = await req.json()

    if (!PRICE_IDS[plan]) {
      return new Response(JSON.stringify({ error: 'Plan invalide' }), { status: 400 })
    }

    // Decode session to get email
    let email = null
    if (session) {
      try {
        const s = JSON.parse(Buffer.from(session, 'base64url').toString())
        email = s.email
      } catch {}
    }

    const siteUrl = process.env.SITE_URL

    // Create Stripe checkout session
    const params = new URLSearchParams({
      'mode': 'subscription',
      'line_items[0][price]': PRICE_IDS[plan],
      'line_items[0][quantity]': '1',
      'success_url': `${siteUrl}/baptiste.html?payment=success&s=${session || ''}`,
      'cancel_url': `${siteUrl}/billing.html?payment=cancelled`,
      'allow_promotion_codes': 'true',
      'billing_address_collection': 'auto',
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

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Stripe error: ${err}`)
    }

    const checkoutSession = await res.json()

    return new Response(JSON.stringify({ url: checkoutSession.url }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('stripe-checkout error:', err)
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500 })
  }
}

export const config = { path: '/api/stripe/checkout' }
