import { supabase } from './_shared/supabase.js'
import { sendEmail, emailBase } from './_shared/resend.js'
import crypto from 'crypto'

const PLAN_MAP = {
  'price_1TWDWC1FzE1O4WqO1sNkinsV': 'solo',
  'price_1TWDWQ1FzE1O4WqO3W6fTURB': 'pro',
  'price_1TWDWe1FzE1O4WqOrpJOX4Pk': 'agence'
}

const PLAN_AGENT_LIMITS = { solo: 3, pro: 10, agence: 10 }

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  // Verify signature
  try {
    const ts = sig.match(/t=(\d+)/)?.[1]
    const v1 = sig.match(/v1=([^,]+)/)?.[1]
    const expected = crypto
      .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${ts}.${body}`).digest('hex')
    if (v1 !== expected) return new Response('Invalid signature', { status: 400 })
  } catch {
    return new Response('Signature error', { status: 400 })
  }

  const event = JSON.parse(body)

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const s = event.data.object
        const email = (s.customer_email || s.customer_details?.email || '').toLowerCase()
        const priceId = s.line_items?.data?.[0]?.price?.id
        const plan = PLAN_MAP[priceId] || 'pro'
        const customerId = s.customer

        if (!email) break

        await supabase.from('users').update({
          plan, is_active: true,
          stripe_customer_id: customerId,
          trial_ends_at: null
        }).eq('email', email)

        // Enforce agent limit for solo plan
        if (plan === 'solo') {
          const { data: activeAgents } = await supabase
            .from('agents_config').select('id, agent_slug')
            .eq('is_active', true).neq('agent_slug', 'baptiste')
            .in('user_id', [
              supabase.from('users').select('id').eq('email', email)
            ])

          if (activeAgents && activeAgents.length > 3) {
            const toDeactivate = activeAgents.slice(3).map(a => a.id)
            await supabase.from('agents_config')
              .update({ is_active: false }).in('id', toDeactivate)
          }
        }

        const { data: user } = await supabase.from('users').select('prenom').eq('email', email).single()

        await sendEmail({
          to: email,
          subject: `✅ Paiement confirmé — Plan ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
          html: emailBase(`
            <h1>Paiement confirmé ✓</h1>
            <p>Bonjour ${user?.prenom || ''}, votre abonnement <b>PageLab ${plan.charAt(0).toUpperCase() + plan.slice(1)}</b> est actif.</p>
            <p>Vos agents travaillent en autonomie. Baptiste vous envoie un rapport chaque lundi.</p>
          `, 'Accéder à mon espace →', `${process.env.SITE_URL}/baptiste.html`)
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const customerId = sub.customer

        const { data: user } = await supabase.from('users')
          .select('id, email, prenom').eq('stripe_customer_id', customerId).single()

        if (user) {
          await supabase.from('users')
            .update({ plan: 'cancelled', is_active: false }).eq('id', user.id)
          await supabase.from('agents_config')
            .update({ is_active: false }).eq('user_id', user.id)

          await sendEmail({
            to: user.email,
            subject: 'Votre abonnement PageLab a été annulé',
            html: emailBase(`
              <h1>Abonnement annulé</h1>
              <p>Bonjour ${user.prenom || ''}, votre abonnement a été annulé. Vos agents sont en pause.</p>
              <p>Vos données sont conservées 30 jours. Vous pouvez vous réabonner à tout moment.</p>
            `, 'Se réabonner →', `${process.env.SITE_URL}/billing.html`)
          })
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const customerId = invoice.customer

        const { data: user } = await supabase.from('users')
          .select('email, prenom').eq('stripe_customer_id', customerId).single()

        if (user) {
          await sendEmail({
            to: user.email,
            subject: '⚠️ Échec de paiement PageLab',
            html: emailBase(`
              <h1>Échec de paiement</h1>
              <p>Bonjour ${user.prenom || ''}, votre paiement PageLab a échoué.</p>
              <p>Veuillez mettre à jour vos informations de paiement pour continuer à utiliser vos agents.</p>
            `, 'Gérer mon abonnement →', `${process.env.SITE_URL}/billing.html`)
          })
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const priceId = sub.items?.data?.[0]?.price?.id
        const newPlan = PLAN_MAP[priceId]
        if (newPlan) {
          await supabase.from('users')
            .update({ plan: newPlan }).eq('stripe_customer_id', sub.customer)
        }
        break
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err) {
    console.error('stripe-webhook error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/stripe/webhook' }
