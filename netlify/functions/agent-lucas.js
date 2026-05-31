import { supabase, getIntegration, logTask, updateAgentRun } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }
function nextFirstOfMonth(h=8){const d=new Date();d.setMonth(d.getMonth()+1,1);d.setHours(h,0,0,0);return d.toISOString()}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const stripeInt = await getIntegration(userId, 'stripe')

    if (!stripeInt?.api_key) {
      await logTask(userId, 'lucas', 'skip', { reason: 'no stripe' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const monthName = from.toLocaleString('fr-FR', { month: 'long', year: 'numeric' })
    const fromTs = Math.floor(from.getTime() / 1000)
    const toTs = Math.floor(to.getTime() / 1000)

    const chargesRes = await fetch(
      `https://api.stripe.com/v1/charges?created[gte]=${fromTs}&created[lte]=${toTs}&limit=100`,
      { headers: { 'Authorization': `Bearer ${stripeInt.api_key}` } }
    )
    if (!chargesRes.ok) throw new Error(`Stripe: ${chargesRes.status}`)
    const { data: charges } = await chargesRes.json()

    const refundsRes = await fetch(
      `https://api.stripe.com/v1/refunds?created[gte]=${fromTs}&created[lte]=${toTs}&limit=100`,
      { headers: { 'Authorization': `Bearer ${stripeInt.api_key}` } }
    )
    const { data: refunds } = refundsRes.ok ? await refundsRes.json() : { data: [] }

    const totalRev = (charges || []).filter(c => c.status === 'succeeded').reduce((s,c) => s + c.amount, 0) / 100
    const totalRef = (refunds || []).reduce((s,r) => s + r.amount, 0) / 100
    const net = totalRev - totalRef
    const currency = charges?.[0]?.currency?.toUpperCase() || 'EUR'

    const txLines = (charges || []).slice(0, 15).map(c => {
      const date = new Date(c.created * 1000).toLocaleDateString('fr-FR')
      return `${date} | ${(c.amount/100).toFixed(2)} ${currency} | ${c.description || c.customer_email || 'Transaction'} | ${c.status}`
    }).join('\n')

    const analysis = await callClaude(`
Tu es Lucas, agent comptable pour ${user.prenom} (${user.secteur}).
Génère un récap comptable mensuel HTML pour ${monthName}.
Données: encaissé ${totalRev.toFixed(2)} ${currency}, remboursé ${totalRef.toFixed(2)} ${currency}, net ${net.toFixed(2)} ${currency}, ${(charges||[]).length} transactions.
Détails: ${txLines}
Inclure: résumé financier, points notables, recommandation simple. Format <h3><p>. Max 250 mots.
    `, '', 800)

    await updateAgentRun(userId, 'lucas', nextFirstOfMonth())
    await logTask(userId, 'lucas', 'recap_sent', { month: monthName, revenue: totalRev, net }, 'success', Date.now() - start)

    await sendEmail({ to: user.email, subject: `Lucas — Récap comptable ${monthName} 📊`,
      html: emailBase(`
        <h1>Récap comptable — ${monthName} 📊</h1>
        <div style="display:flex;gap:12px;margin:14px 0;flex-wrap:wrap">
          <div style="background:#0d1a0d;border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px 16px">
            <div style="font-size:11px;color:#55556a">ENCAISSÉ</div>
            <div style="font-size:22px;font-weight:800;color:#10b981">${totalRev.toFixed(2)} €</div>
          </div>
          <div style="background:#1a0d0d;border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:12px 16px">
            <div style="font-size:11px;color:#55556a">REMBOURSÉ</div>
            <div style="font-size:22px;font-weight:800;color:#ef4444">${totalRef.toFixed(2)} €</div>
          </div>
          <div style="background:#0d0d1a;border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:12px 16px">
            <div style="font-size:11px;color:#55556a">NET</div>
            <div style="font-size:22px;font-weight:800;color:#7c3aed">${net.toFixed(2)} €</div>
          </div>
        </div>
        ${analysis}
      `)
    })

    return new Response(JSON.stringify({ revenue: totalRev, net, transactions: (charges||[]).length }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'lucas', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/lucas' }
