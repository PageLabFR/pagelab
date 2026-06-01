// netlify/functions/whatsapp-webhook.js
// Reçoit les messages WhatsApp entrants (Twilio) et applique OUI/NON.
// À configurer comme webhook entrant dans la console Twilio.
// Sécurité : on identifie l'utilisateur par son numéro de téléphone (champ users.phone).
// "OUI" -> approuve toutes les actions pending ; "NON" -> refuse toutes.

const L = require('./_lib')

const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'

// Réponse au format TwiML (Twilio attend du XML)
function twiml(message) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
  return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: xml }
}

exports.handler = async (event) => {
  try {
    // Twilio envoie du x-www-form-urlencoded
    const params = new URLSearchParams(event.body || '')
    const from = (params.get('From') || '').replace('whatsapp:', '').trim()
    const text = (params.get('Body') || '').trim().toUpperCase()
    if (!from) return twiml('Numéro non reconnu.')

    // Retrouve l'utilisateur par téléphone (on teste avec/sans préfixe)
    let users = await L.db('GET', 'users', null, `?phone=eq.${encodeURIComponent(from)}&select=id,prenom`)
    if (!users?.length) {
      const alt = from.startsWith('+') ? from.slice(1) : `+${from}`
      users = await L.db('GET', 'users', null, `?phone=eq.${encodeURIComponent(alt)}&select=id,prenom`)
    }
    const user = users?.[0]
    if (!user) return twiml("Ce numéro n'est lié à aucun compte PageLab. Ajoutez-le dans vos paramètres.")

    const pending = await L.db('GET', 'pending_actions', null,
      `?user_id=eq.${user.id}&status=eq.pending&select=id`)
    const ids = (pending || []).map(a => a.id)
    if (!ids.length) return twiml('Aucune action en attente actuellement. 👍')

    const isYes = ['OUI', 'OUI.', 'YES', 'Y', 'O', 'VALIDER', 'OK'].includes(text)
    const isNo = ['NON', 'NON.', 'NO', 'N', 'REFUSER', 'STOP'].includes(text)

    if (!isYes && !isNo) {
      return twiml(`Vous avez ${ids.length} action(s) en attente. Répondez "OUI" pour tout valider ou "NON" pour tout refuser. Détail : ${SITE_URL}/baptiste.html`)
    }

    const endpoint = isYes ? 'actions-approve' : 'actions-reject'
    let done = 0
    for (const id of ids) {
      const res = await L.fetchRetry(`${SITE_URL}/.netlify/functions/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
        body: JSON.stringify({ userId: user.id, actionId: id })
      })
      if (res.ok) done++
    }

    return twiml(isYes
      ? `✅ ${done} action(s) validée(s) et exécutée(s). Merci ${user.prenom || ''} !`
      : `🚫 ${done} action(s) refusée(s). Rien n'a été envoyé.`)
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message)
    return twiml("Une erreur s'est produite. Réessayez ou utilisez votre tableau de bord.")
  }
}
