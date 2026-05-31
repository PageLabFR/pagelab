const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SITE_URL = process.env.SITE_URL || 'https://pagelab.fr'

async function db(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token
  if (!token) return { statusCode: 302, headers: { Location: `${SITE_URL}/login.html?error=missing` } }

  try {
    const links = await db('GET', 'magic_links', null, `?token=eq.${token}&used=eq.false&select=*`)
    const link = links?.[0]

    if (!link) return { statusCode: 302, headers: { Location: `${SITE_URL}/login.html?error=invalid` } }
    if (new Date(link.expires_at) < new Date()) return { statusCode: 302, headers: { Location: `${SITE_URL}/login.html?error=expired` } }

    await db('PATCH', 'magic_links', { used: true }, `?id=eq.${link.id}`)

    const users = await db('GET', 'users', null, `?email=eq.${encodeURIComponent(link.email)}&select=id,prenom,plan,trial_ends_at`)
    const user = users?.[0]
    if (!user) return { statusCode: 302, headers: { Location: `${SITE_URL}/login.html?error=server` } }

    const session = Buffer.from(JSON.stringify({
      userId: user.id,
      email: link.email,
      plan: user.plan || 'trial',
      trial_ends_at: user.trial_ends_at,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })).toString('base64url')

    const dest = !user.prenom
      ? `${SITE_URL}/onboarding.html?s=${session}`
      : `${SITE_URL}/baptiste.html?s=${session}`

    return { statusCode: 302, headers: { Location: dest } }
  } catch (err) {
    console.error('verify error:', err.message)
    return { statusCode: 302, headers: { Location: `${SITE_URL}/login.html?error=server` } }
  }
}
