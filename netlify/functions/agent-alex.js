// netlify/functions/agent-alex.js  (V2 — Alex = réseaux sociaux, semi-autonome)
// Quand un chantier vient d'être réglé (paiement Stripe récent), Alex PROPOSE
// spontanément un post LinkedIn générique valorisant le savoir-faire, posé dans
// "À valider". L'artisan le relit/personnalise avant publication (copier-coller
// pour l'instant ; publication auto Zernio plus tard).
const L = require('./_lib')

exports.handler = async (event) => {
  if (!L.checkCron(event)) return { statusCode: 401, body: 'Unauthorized' }
  const start = Date.now()
  const { userId, agentConfig } = JSON.parse(event.body || '{}')

  try {
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=*`)
    const user = users?.[0]
    const metier = user?.metier || user?.secteur || 'artisan du bâtiment'
    const ville = user?.ville ? ` à ${user.ville}` : ''

    // Déclencheur : y a-t-il eu un paiement récent (chantier fini) ? Sinon, rien à raconter.
    let chantierRecent = false
    const stripeKey = await L.getIntegrationKey(userId, 'stripe')
    if (stripeKey) {
      const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
      const res = await L.fetchRetry(`https://api.stripe.com/v1/charges?created[gte]=${since}&limit=10`, {
        headers: { 'Authorization': `Bearer ${stripeKey}` }
      })
      if (res.ok) { const d = await res.json(); chantierRecent = (d.data || []).some(c => c.paid && c.status === 'succeeded') }
    }

    // Si un thème est imposé (brief), on poste dessus. Sinon, on ne propose un post que s'il y a eu un chantier récent.
    if (!agentConfig?.brief && !chantierRecent) {
      await L.reschedule(userId, 'alex', L.nextMonday8h())
      await L.logTask(userId, 'alex', 'social_post', 'success', { reason: 'aucun_chantier_recent', drafted: 0 }, Date.now() - start)
      return { statusCode: 200, body: JSON.stringify({ success: true, drafted: 0, reason: 'aucun_chantier_recent' }) }
    }

    const angle = agentConfig?.brief
      ? `Sujet imposé : "${agentConfig.brief}".`
      : `Un chantier vient d'être terminé. Écris un post qui valorise le savoir-faire et le sérieux, sans inventer de détails précis sur le chantier (reste général : qualité, satisfaction client, fierté du travail bien fait).`

    const prompt = `Tu es Alex, expert communication LinkedIn pour un ${metier}${ville}.
${angle}
Rédige UN post LinkedIn authentique à la première personne, en français : accroche forte en 1re ligne, ton humain et concret (pas corporate), 100-180 mots, retours à la ligne pour aérer, 3-4 hashtags pertinents à la fin, 2 emojis max. Réponds UNIQUEMENT par le texte du post, sans préambule ni guillemets.`
    const post = await L.callClaude(prompt, { max_tokens: 700 })

    await L.queueAction(
      userId, 'alex', 'publish_social_zernio',
      `Post LinkedIn proposé`,
      { text: post, network: 'linkedin' },
      `post:${new Date().toISOString().slice(0, 10)}`,
      agentConfig?.autonomy || 'validate'
    )

    await L.reschedule(userId, 'alex', L.nextMonday8h())
    await L.logTask(userId, 'alex', 'social_post', 'success', { drafted: 1 }, Date.now() - start)
    return { statusCode: 200, body: JSON.stringify({ success: true, drafted: 1 }) }
  } catch (err) {
    console.error('Alex error:', err.message)
    await L.logTask(userId, 'alex', 'error', 'error', { error: err.message })
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
