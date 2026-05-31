const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token
  const siteUrl = process.env.SITE_URL || 'https://pagelab.fr'

  if (!token) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/login.html?error=missing` } }
  }

  try {
    const { data: link } = await supabase
      .from('magic_links').select('*')
      .eq('token', token).eq('used', false).single()

    if (!link) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/login.html?error=invalid` } }
    }

    if (new Date(link.expires_at) < new Date()) {
      return { statusCode: 302, headers: { Location: `${siteUrl}/login.html?error=expired` } }
    }

    await supabase.from('magic_links').update({ used: true }).eq('id', link.id)

    const { data: user } = await supabase
      .from('users').select('id, prenom, plan, trial_ends_at')
      .eq('email', link.email).single()

    const session = Buffer.from(JSON.stringify({
      userId: user.id,
      email: link.email,
      plan: user.plan || 'trial',
      trial_ends_at: user.trial_ends_at,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })).toString('base64url')

    const dest = !user.prenom
      ? `${siteUrl}/onboarding.html?s=${session}`
      : `${siteUrl}/baptiste.html?s=${session}`

    return { statusCode: 302, headers: { Location: dest } }
  } catch (err) {
    console.error('verify error:', err.message)
    return { statusCode: 302, headers: { Location: `${siteUrl}/login.html?error=server` } }
  }
}
