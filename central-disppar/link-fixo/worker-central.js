// =====================================================================
// CENTRAL AUTOMAÇÕES DISPPAR — LINK FIXO (Cloudflare Worker)
// Endereço que nunca muda. Repassa tudo para o túnel do momento do
// computador da loja (que muda a cada reinício). O próprio sistema avisa
// o túnel novo em POST /__registrar, provando que conhece o segredo.
// Aqui só fica a "impressão digital" (SHA-256) do segredo, nunca o segredo.
// Precisa de um KV ligado com o nome LINK.
// =====================================================================
const HASH_SEGREDO = '7765889289fc18f0952f7f7bdc1de2732f4581974e73b125a3f268a9a02131c0'

async function sha256(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const foraDoAr = () => new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Central Automações DISPPAR</title>
<meta http-equiv="refresh" content="15">
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#F3F4F8;color:#141A2E">
<div style="text-align:center;padding:24px"><h1 style="margin:0 0 8px">CENTRAL AUTOMAÇÕES <span style="color:#CE0704">DISPPAR</span></h1>
<p>O computador da loja está desligado ou sem internet.</p><p style="color:#545C72">Esta página tenta de novo sozinha a cada 15 segundos.</p></div>`,
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    // O sistema avisa qual é o túnel do momento
    if (url.pathname === '/__registrar') {
      if (req.method !== 'POST') return new Response('método inválido', { status: 405 })
      if ((await sha256(req.headers.get('x-segredo') || '')) !== HASH_SEGREDO) return new Response('não autorizado', { status: 401 })
      const { destino } = await req.json().catch(() => ({}))
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(destino || '')) return new Response('destino inválido', { status: 400 })
      await env.LINK.put('destino', destino)
      return new Response('ok')
    }

    const destino = await env.LINK.get('destino', { cacheTtl: 30 })
    if (!destino) return foraDoAr()

    // Repassa a requisição como veio (método, cabeçalhos, cookies, corpo)
    const cab = new Headers(req.headers)
    cab.delete('host') // o endereço de destino define o host
    cab.set('x-atende-ip', req.headers.get('cf-connecting-ip') || '') // IP real de quem acessa (proteção de senha)
    try {
      const resp = await fetch(new Request(destino + url.pathname + url.search, { method: req.method, headers: cab, body: req.body, redirect: 'manual' }))
      if (resp.status === 530 || resp.status === 502) return foraDoAr() // túnel antigo, já desligado
      return resp
    } catch {
      return foraDoAr()
    }
  }
}
