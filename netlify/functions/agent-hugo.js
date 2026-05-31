import { supabase, getIntegration, logTask, updateAgentRun } from './_shared/supabase.js'
import { callClaude } from './_shared/claude.js'
import { sendEmail, emailBase } from './_shared/resend.js'

function verifyCron(req) { return req.headers.get('x-cron-secret') === process.env.CRON_SECRET }
function nextDay(h=9){const d=new Date();d.setDate(d.getDate()+1);d.setHours(h,0,0,0);return d.toISOString()}

export default async (req) => {
  if (!verifyCron(req)) return new Response('Unauthorized', { status: 401 })
  const start = Date.now()
  const { userId } = await req.json()

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    const gmbInt = await getIntegration(userId, 'google_my_business')

    if (!gmbInt?.api_key || !gmbInt?.extra_config?.account_id || !gmbInt?.extra_config?.location_id) {
      await logTask(userId, 'hugo', 'skip', { reason: 'no gmb' }, 'skipped')
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const { account_id, location_id } = gmbInt.extra_config

    const reviewsRes = await fetch(
      `https://mybusiness.googleapis.com/v4/accounts/${account_id}/locations/${location_id}/reviews?pageSize=20`,
      { headers: { 'Authorization': `Bearer ${gmbInt.api_key}` } }
    )
    if (!reviewsRes.ok) throw new Error(`GMB: ${reviewsRes.status}`)
    const { reviews } = await reviewsRes.json()

    const unanswered = (reviews || []).filter(r => !r.reviewReply)
    if (!unanswered.length) {
      await updateAgentRun(userId, 'hugo', nextDay())
      await logTask(userId, 'hugo', 'no_reviews', {}, 'success')
      return new Response(JSON.stringify({ replied: 0 }), { status: 200 })
    }

    let replied = 0
    for (const review of unanswered.slice(0, 5)) {
      const stars = review.starRating
      const reviewText = review.comment || ''
      const reviewer = review.reviewer?.displayName || 'Client'

      const reply = await callClaude(`
Réponds à cet avis Google pour ${user.prenom} (${user.secteur}).
Note: ${stars}/5 — Auteur: ${reviewer} — Texte: "${reviewText}"
Règles: max 80 mots, chaleureux si positif, empathique si négatif, signature avec ${user.prenom}.
Retourne UNIQUEMENT le texte de la réponse, sans formatage.
      `, '', 250)

      const replyRes = await fetch(
        `https://mybusiness.googleapis.com/v4/accounts/${account_id}/locations/${location_id}/reviews/${review.reviewId}/reply`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${gmbInt.api_key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: reply })
        }
      )
      if (replyRes.ok) replied++
    }

    await updateAgentRun(userId, 'hugo', nextDay())
    await logTask(userId, 'hugo', 'reviews_replied', { replied }, 'success', Date.now() - start)

    if (replied > 0) {
      await sendEmail({ to: user.email, subject: `Hugo a répondu à ${replied} avis Google ⭐`,
        html: emailBase(`<h1>Avis Google traités ✓</h1><p><b>${replied} réponse(s)</b> publiée(s) sur Google My Business.</p>`)
      })
    }

    return new Response(JSON.stringify({ replied }), { status: 200 })
  } catch (err) {
    await logTask(userId, 'hugo', 'error', { error: err.message }, 'error', Date.now() - start)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/api/agents/hugo' }
