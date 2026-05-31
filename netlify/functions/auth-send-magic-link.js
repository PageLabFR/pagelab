import { supabase } from './_shared/supabase.js'
import { sendEmail, emailBase } from './_shared/resend.js'
import crypto from 'crypto'

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200 })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const { email } = await req.json()
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Email invalide' }), { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Get or create user
    let { data: user } = await supabase
      .from('users').select('id, prenom, plan').eq('email', normalizedEmail).single()

    if (!user) {
      const { data: newUser, error } = await supabase
        .from('users').insert({ email: normalizedEmail }).select().single()
      if (error) throw error
      user = newUser
    }

    // Invalidate old tokens
    await supabase.from('magic_links')
      .update({ used: true }).eq('email', normalizedEmail).eq('used', false)

    // Create new token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    await supabase.from('magic_links').insert({
      email: normalizedEmail, token, expires_at: expiresAt
    })

    const magicUrl = `${process.env.SITE_URL}/.netlify/functions/auth-verify-magic-link?token=${token}`
    const isNew = !user.prenom

    const content = `
      <div class="badge">✦ ${isNew ? 'Activation de votre compte' : 'Connexion'}</div>
      <h1>${isNew ? 'Bienvenue sur PageLab !' : `Votre lien de connexion`}</h1>
      <p>${isNew
        ? 'Cliquez ci-dessous pour activer votre compte et configurer votre équipe IA avec Baptiste.'
        : 'Voici votre lien de connexion. Valable <b>15 minutes</b>.'
      }</p>
      <p style="font-size:13px;color:#55556a">Si vous n'avez pas demandé ce lien, ignorez cet email en toute sécurité.</p>
    `

    await sendEmail({
      to: normalizedEmail,
      subject: isNew ? '🚀 Activez votre compte PageLab' : '🔗 Votre lien de connexion PageLab',
      html: emailBase(content, isNew ? 'Activer mon compte →' : 'Se connecter →', magicUrl)
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('send-magic-link error:', err)
    return new Response(JSON.stringify({ error: 'Erreur serveur, réessayez.' }), { status: 500 })
  }
}

export const config = { path: '/api/auth/send-magic-link' }
