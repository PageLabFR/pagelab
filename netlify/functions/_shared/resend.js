export async function sendEmail({ to, subject, html, from = 'PageLab <contact@pagelab.fr>' }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({ from, to, subject, html })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend error: ${res.status} ${err}`)
  }
  return res.json()
}

export function emailBase(content, ctaText = null, ctaUrl = null) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#07070f;font-family:Inter,Arial,sans-serif;color:#eeeef8}
.wrap{max-width:580px;margin:0 auto;padding:40px 24px}
.logo{font-size:22px;font-weight:800;color:#fff;margin-bottom:32px;letter-spacing:-.02em}
.logo span{color:#7c3aed}
.card{background:#12121f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px}
h1{font-size:22px;font-weight:800;color:#fff;margin:0 0 14px;line-height:1.2;letter-spacing:-.02em}
p{font-size:15px;color:#9898b8;line-height:1.75;margin:0 0 14px}
b{color:#eeeef8}
ul{margin:10px 0 14px;padding-left:0;list-style:none}
li{font-size:14px;color:#9898b8;line-height:1.8;padding:3px 0}
.cta{display:inline-block;padding:13px 28px;background:#7c3aed;color:#fff !important;border-radius:50px;font-size:15px;font-weight:600;text-decoration:none;margin:16px 0 24px}
.divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:22px 0}
.badge{display:inline-block;padding:5px 13px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:50px;font-size:12px;color:#c4b5fd;font-weight:600;margin-bottom:18px}
.footer{font-size:12px;color:#55556a;text-align:center;margin-top:24px;line-height:1.6}
.footer a{color:#7c3aed;text-decoration:none}
.stat-row{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}
.stat-box{background:#0d0d1a;border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:12px 16px;min-width:100px}
.stat-val{font-size:22px;font-weight:800;color:#7c3aed;line-height:1}
.stat-label{font-size:11px;color:#55556a;margin-top:4px}
</style></head>
<body><div class="wrap">
<div class="logo">Page<span>Lab</span></div>
<div class="card">
${content}
${ctaText && ctaUrl ? `<a href="${ctaUrl}" class="cta">${ctaText}</a>` : ''}
<hr class="divider">
<p style="font-size:13px;color:#55556a;margin:0">
Vous recevez cet email car vous êtes inscrit sur PageLab.<br>
<a href="https://pagelab.fr" style="color:#7c3aed">pagelab.fr</a> · contact@pagelab.fr · 06 98 29 48 72
</p>
</div>
<div class="footer">© 2025 PageLab — SIREN 102 261 344 — Versailles<br>
<a href="https://pagelab.fr/politique-confidentialite.html">Confidentialité</a> · 
<a href="https://pagelab.fr/cgv.html">CGV</a></div>
</div></body></html>`
}
