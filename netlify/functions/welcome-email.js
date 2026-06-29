// welcome-email — email de bienvenue brandé après création de compte.
// Appelé depuis connexion.html juste après l'inscription (session active).
const { cors, json, service, sendEmail } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return json({ error: 'non authentifié' }, 401);

  const svc = service();
  const { data: u, error } = await svc.auth.getUser(token);
  if (error || !u.user) return json({ error: 'session invalide' }, 401);

  const to = u.user.email;
  if (!to) return json({ error: "Pas d'email" }, 400);
  const name = (u.user.user_metadata && (u.user.user_metadata.full_name || u.user.user_metadata.name)) || '';

  const body = `Bonjour${name ? ' ' + name : ''},\n\n`
    + `Bienvenue sur PageLab — votre espace est prêt.\n\n`
    + `Vos agents préparent déjà vos réponses aux prospects, vos relances d'impayés et vos demandes d'avis. `
    + `Il ne vous reste qu'à valider d'un clic : rien ne part sans vous.\n\n`
    + `Connectez-vous pour faire vos premiers pas — et répondez simplement à cet email si vous avez la moindre question.\n\n`
    + `À très vite,\nL'équipe PageLab`;

  const r = await sendEmail(to, 'Bienvenue sur PageLab 👋', body, undefined, 'PageLab');
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 502);
};
