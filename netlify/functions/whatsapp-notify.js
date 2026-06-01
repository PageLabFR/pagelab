// netlify/functions/whatsapp-notify.js
// Envoie un message WhatsApp via Twilio. Appelé en interne (x-cron-secret)
// pour prévenir l'utilisateur qu'une action attend sa validation.
// Variables d'env requises :
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (ex: "whatsapp:+14155238886")

const L = require('./_lib')

const HEADERS = { 'Content-Type': 'application/json' }

async function sendWhatsApp(toPhone, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM
  if (!sid || !token || !from) throw new Error('Config Twilio manquante')

  const to = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`
  const body = new URLSearchParams({ From: from, To: to, Body: message })
  const res = await L.fetchRetry(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })
  if (!res.ok) throw new Error(`Twilio: ${await res.text()}`)
  return res.json()
}

exports.handler = async (event) => {
  if (event.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) }
  }
  try {
    const { userId } = JSON.parse(event.body || '{}')
    const users = await L.db('GET', 'users', null, `?id=eq.${userId}&select=phone,prenom`)
    const user = users?.[0]
    if (!user?.phone) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ skipped: 'no phone' }) }

    // Compte les actions en attente
    const pending = await L.db('GET', 'pending_actions', null,
      `?user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=5&select=id,summary`)
    const list = pending || []
    if (!list.length) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ skipped: 'nothing pending' }) }

    const lines = list.map((a, i) => `${i + 1}. ${a.summary}`).join('\n')
    const msg = `Bonjour ${user.prenom || ''} 👋\nVotre équipe PageLab a ${list.length} action(s) en attente de validation :\n\n${lines}\n\nRépondez "OUI" pour tout valider, "NON" pour tout refuser, ou ouvrez votre tableau de bord pour décider une par une.`
    await sendWhatsApp(user.phone, msg)

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ sent: true, count: list.length }) }
  } catch (err) {
    console.error('whatsapp-notify error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
