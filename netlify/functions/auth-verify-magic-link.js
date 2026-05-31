import { supabase } from './_shared/supabase.js'

export default async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const siteUrl = process.env.SITE_URL

  if (!token) return Response.redirect(`${siteUrl}/login.html?error=missing`, 302)

  try {
    const { data: link } = await supabase
      .from('magic_links').select('*')
      .eq('token', token).eq('used', false).single()

    if (!link) return Response.redirect(`${siteUrl}/login.html?error=invalid`, 302)
    if (new Date(link.expires_at) < new Date()) {
      return Response.redirect(`${siteUrl}/login.html?error=expired`, 302)
    }

    // Mark used
    await supabase.from('magic_links').update({ used: true }).eq('id', link.id)

    // Get user
    const { data: user } = await supabase
      .from('users').select('id, prenom, plan, trial_ends_at')
      .eq('email', link.email).single()

    // Build session token (base64 encoded, expires in 7 days)
    const session = Buffer.from(JSON.stringify({
      userId: user.id,
      email: link.email,
      plan: user.plan,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })).toString('base64url')

    // Redirect: new users → onboarding, existing → baptiste
    const dest = !user.prenom
      ? `${siteUrl}/onboarding.html?s=${session}`
      : `${siteUrl}/baptiste.html?s=${session}`

    return Response.redirect(dest, 302)
  } catch (err) {
    console.error('verify-magic-link error:', err)
    return Response.redirect(`${siteUrl}/login.html?error=server`, 302)
  }
}

export const config = { path: '/api/auth/verify' }
