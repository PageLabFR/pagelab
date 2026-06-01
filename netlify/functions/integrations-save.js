// netlify/functions/integrations-save.js
// Chiffre une clé API en AES-256-GCM puis l'enregistre (upsert) pour l'utilisateur.
// Prérequis : variable d'env ENCRYPTION_KEY = 64 caractères hex (= 32 octets).
//   Générer une fois :  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const crypto = require('crypto')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const VALID_TOOLS = ['wordpress', 'shopify', 'woocommerce', 'stripe', 'brevo', 'buffer', 'notion', 'google_my_business']

// --- Chiffrement AES-256-GCM ---
// Format stocké : "iv:authTag:ciphertext" (chacun en hex)
function encrypt(plain) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}
// (decrypt fourni pour les agents qui consomment la clé — voir note)
function decrypt(payload) {
  const [ivHex, tagHex, dataHex] = String(payload).split(':')
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

async function db(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'ENCRYPTION_KEY manquante ou invalide (64 hex attendus)' }) }
    }

    const { session, tool, key } = JSON.parse(event.body || '{}')

    let sessionData
    try { sessionData = JSON.parse(Buffer.from(session, 'base64url').toString()) }
    catch { return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session invalide' }) } }
    if (sessionData.exp < Date.now()) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Session expirée' }) }

    const slug = String(tool || '').toLowerCase()
    if (!VALID_TOOLS.includes(slug)) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Outil inconnu' }) }
    if (!key || String(key).trim().length < 8) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Clé invalide' }) }

    const { userId } = sessionData

    // Upsert : on supprime l'ancienne entrée pour cet outil puis on réinsère.
    await db('DELETE', 'integrations', null, `?user_id=eq.${userId}&tool_name=eq.${slug}`)
    await db('POST', 'integrations', {
      user_id: userId,
      tool_name: slug,
      api_key: encrypt(key.trim()),
      is_connected: true
    })

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, tool: slug }) }
  } catch (err) {
    console.error('integrations-save error:', err.message)
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
  }
}
