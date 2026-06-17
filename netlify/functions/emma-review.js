// netlify/functions/emma-review.js
// Emma — demande d'avis. Génère un message + lien d'avis Google et l'envoie au
// client par email (via Resend). Pas d'API Google : on utilise le lien public.
// Auth : { session, action, ... }.
//   action="link"  : renvoie juste le lien d'avis à partir du placeId / nom.
//   action="send"  : envoie l'email de demande d'avis au client.
const L = require('./_lib')
const RESEND_KEY = process.env.RESEND_API_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function reviewLink({ placeId, name }) {
  if (placeId) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
  // fallback : recherche Google de l'établissement (l'artisan pourra cliquer "donner un avis")
  return `https://www.google.com/search?q=${encodeURIComponent((name || '') + ' avis google')}`
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }
  try {
    const { session, action, placeId, businessName, clientEmail, clientName } = JSON.parse(event.body || '{}')
    let sd
    try { sd = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sd.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const users = await L.db('GET', 'users', null, `?id=eq.${sd.userId}&select=prenom,metier,ville`)
    const user = users?.[0] || {}
    const link = reviewLink({ placeId, name: businessName || user.prenom })

    if (action === 'link') {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ link }) }
    }

    if (action === 'send') {
      if (!clientEmail || !/^[^@]+@[^@]+\.[^@]+$/.test(clientEmail)) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Email du client invalide' }) }
      }
      if (!RESEND_KEY) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Envoi email non configuré' }) }

      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.6;color:#1a1a2e">
        <p>Bonjour ${clientName || ''},</p>
        <p>Merci de votre confiance ! Si vous êtes satisfait${clientName ? '' : '(e)'} du travail réalisé, un petit avis Google m'aiderait énormément. Ça prend 30 secondes :</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${link}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;display:inline-block">⭐ Laisser un avis</a>
        </p>
        <p style="font-size:13px;color:#888">Merci beaucoup,<br>${user.prenom || 'Votre artisan'}</p>
      </div>`

      const res = await L.fetchRetry('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: `${user.prenom || 'PageLab'} (via PageLab) <contact@pagelab.fr>`,
          to: clientEmail,
          reply_to: undefined,
          subject: `Votre avis compte pour moi 🙏`,
          html
        })
      })
      if (!res.ok) return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Envoi échoué' }) }

      await L.logTask(sd.userId, 'emma', 'review_request_sent', 'success', { to: clientEmail })
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, link }) }
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Action inconnue' }) }
  } catch (err) {
    console.error('emma-review error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
