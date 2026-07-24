// Minimal iframe-friendly HTML for the app callback pages (rendered inside the
// BigCommerce control panel).

export function appPage(title: string, bodyHtml: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1a1d24}
.wrap{max-width:640px;margin:48px auto;padding:0 24px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px;box-shadow:0 1px 3px rgba(16,24,40,.1)}
h1{font-size:20px;margin:0 0 8px}.muted{color:#6b7280}.ok{color:#0a8a5f;font-weight:600}.bad{color:#c0392b;font-weight:600}
a.btn{display:inline-block;margin-top:12px;padding:9px 16px;background:#388cb4;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}
code{font-family:ui-monospace,monospace;font-size:12px;background:#f0f2f5;padding:1px 6px;border-radius:4px}</style></head>
<body><div class="wrap"><div class="card">${bodyHtml}</div></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
