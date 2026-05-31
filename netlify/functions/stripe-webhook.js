const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PLAN_MAP = {
  'price_1TWDWC1FzE1O4WqO1sNkinsV': 'solo',
  'price_1TWDWQ1FzE1O4WqO3W6fTURB': 'pro',
  'price_1TWDWe1FzE1O4WqOrpJOX4Pk': 'agence'
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const sig = event.headers['stripe-signature']
  const body = event.body

  try {
    const ts = sig.match(/t=(\d+)/)?.[1]
    const v1 = sig.match(/v1=([^,]+)/)?.[1]
    const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${ts}.${body}`).digest('hex')
    if (v1 !== expected) return { statusCode: 400, body: 'Invalid signature' }
  } catch {
    return { statusCode: 400, body: 'Signature error' }
  }

  const evt = JSON.parse(body)

  try {
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object
      const email = (s.customer_email || s.customer_details?.email || '').toLowerCase()
      const priceId = s.line_items?.data?.[0]?.price?.id
      const plan = PLAN_MAP[priceId] || 'pro'

      if (email) {
        await supabase.from('users').update({
          plan, is_active: true, stripe_customer_id: s.customer, trial_ends_at: null
        }).eq('email', email)

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'PageLab <contact@pagelab.fr>',
            to: email,
            subject: `✅ Paiement confirmé — Plan ${plan}`,
            html: `<p>Votre abonnement PageLab <b>${plan}</b> est actif. Vos agents travaillent.</p>`
          })
        })
      }
    } else if (evt.type === 'customer.subscription.deleted') {
      const customerId = evt.data.object.customer
      const { data: user } = await supabase.from('users').select('id, email').eq('stripe_customer_id', customerId).single()
      if (user) {
        await supabase.from('users').update({ plan: 'cancelled', is_active: false }).eq('id', user.id)
        await supabase.from('agents_config').update({ is_active: false }).eq('user_id', user.id)
      }
    } else if (evt.type === 'customer.subscription.updated') {
      const priceId = evt.data.object.items?.data?.[0]?.price?.id
      const newPlan = PLAN_MAP[priceId]
      if (newPlan) {
        await supabase.from('users').update({ plan: newPlan }).eq('stripe_customer_id', evt.data.object.customer)
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) }
  } catch (err) {
    console.error('stripe-webhook error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
