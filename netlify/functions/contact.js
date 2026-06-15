// netlify/functions/contact.js
// Reçoit le formulaire de contact et envoie un email via Resend.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { nom, email, metier, message } = JSON.parse(event.body || '{}');
    if (!nom || !email || !message) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Champs manquants' }) };
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Config email manquante' }) };
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'PageLab <contact@pagelab.fr>',
        to: ['contact@pagelab.fr'],
        reply_to: email,
        subject: `Nouveau contact : ${nom}${metier ? ' (' + metier + ')' : ''}`,
        text: `Nom : ${nom}\nEmail : ${email}\nMétier : ${metier || '—'}\n\nMessage :\n${message}`,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Envoi échoué', detail: t }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
