// =====================================================================
// CENTRAL AUTOMAÇÕES DISPPAR — o "vigia"
// Um único serviço do Windows que liga cada sistema (Cotação, DISPPAR Atende)
// como um PROGRAMA SEPARADO. Se um cair ou travar, só ele é religado: o outro
// nem percebe. Também entrega a página inicial da Central com o status de cada um.
// Iniciar: runtime\node.exe central\vigia.js   (a tarefa do Windows faz isso sozinha)
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

export const RAIZ = process.env.CENTRAL_RAIZ ? path.resolve(process.env.CENTRAL_RAIZ) : path.resolve(import.meta.dirname, '..')
const DADOS = path.join(RAIZ, 'dados')
const LOGS = path.join(DADOS, 'logs')
fs.mkdirSync(LOGS, { recursive: true })
const PORTA = Number(process.env.PORTA_CENTRAL || 3200)
const NODE = process.env.NODE_EXE || (fs.existsSync(path.join(RAIZ, 'runtime', 'node.exe')) ? path.join(RAIZ, 'runtime', 'node.exe') : process.execPath)
const CLOUDFLARED = path.join(RAIZ, 'runtime', 'cloudflared.exe')
const hora = () => new Date().toLocaleString('pt-BR')

// ---------- os sistemas da Central (dá para trocar portas/pastas em dados/central.json) ----------
const PADRAO = [
  {
    id: 'cotacao', nome: 'Cotação', icone: '🧾', descricao: 'Cotações, comparativo de preços e pedidos de compra',
    pasta: 'cotacao/servidor', script: 'index.js', porta: 3220, saude: '/api/status',
    env: { PASTA_DADOS: 'dados/cotacao', PASTA_SITE: 'cotacao/site' },
  },
  {
    id: 'atende', nome: 'DISPPAR Atende', icone: '💬', descricao: 'Central de WhatsApp das lojas Paranoá e São Sebastião',
    pasta: 'atende/servidor', script: 'index.js', porta: 3210, saude: '/',
    env: { PASTA_DADOS: 'dados/atende' },
  },
]
function lerConfig() {
  const arq = path.join(DADOS, 'central.json')
  let extra = {}
  try { extra = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '')) } catch { /* sem arquivo: padrão */ }
  return PADRAO.map(s => ({ ...s, ...(extra[s.id] || {}), env: { ...s.env, ...(extra[s.id]?.env || {}) } }))
    .filter(s => fs.existsSync(path.join(RAIZ, s.pasta, s.script)) && extra[s.id]?.desligado !== true)
}

// ---------- cada sistema num programa separado, religado se cair ----------
const sistemas = new Map()
function log(s, texto) {
  const arq = path.join(LOGS, `${s.id}.log`)
  try {
    if (fs.existsSync(arq) && fs.statSync(arq).size > 10 * 1024 * 1024) fs.renameSync(arq, arq + '.1')
    fs.appendFileSync(arq, texto)
  } catch { /* disco cheio etc.: segue */ }
}
function ligar(s) {
  const st = sistemas.get(s.id)
  if (st.parando) return
  const env = { ...process.env, PORTA: String(s.porta), CLOUDFLARED, PATH: `${path.join(RAIZ, 'runtime')};${process.env.PATH}` }
  for (const [k, v] of Object.entries(s.env)) env[k] = /^[A-Z]:|^\//i.test(v) || !v.includes('/') ? v : path.join(RAIZ, v)
  log(s, `\n[${hora()}] ===== ligando ${s.nome} =====\n`)
  const p = spawn(NODE, ['--no-warnings', s.script], { cwd: path.join(RAIZ, s.pasta), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  Object.assign(st, { proc: p, status: 'ligando', desde: Date.now(), pid: p.pid, falhasSaude: 0 })
  p.stdout.on('data', d => log(s, String(d)))
  p.stderr.on('data', d => log(s, String(d)))
  p.on('exit', codigo => {
    st.proc = null
    st.pid = null
    if (st.parando) { st.status = 'desligado'; return }
    const agora = Date.now()
    st.quedas = st.quedas.filter(t => agora - t < 10 * 60_000).concat(agora)
    st.reinicios++
    // código 2 = erro de configuração (não adianta insistir logo); muitas quedas seguidas = espera mais
    const espera = codigo === 2 ? 5 * 60_000 : st.quedas.length >= 5 ? 2 * 60_000 : 10_000
    st.status = codigo === 2 ? 'com problema' : 'reiniciando'
    st.ultimaQueda = { em: new Date().toISOString(), codigo }
    log(s, `[${hora()}] ${s.nome} parou (código ${codigo}). Religando em ${Math.round(espera / 1000)} s.\n`)
    st.timer = setTimeout(() => ligar(s), espera)
  })
}
function desligar(s) {
  const st = sistemas.get(s.id)
  st.parando = true
  clearTimeout(st.timer)
  if (st.proc) try { st.proc.kill() } catch { /* já saiu */ }
}
function reiniciar(id) {
  const s = [...sistemas.values()].find(x => x.cfg.id === id)?.cfg
  if (!s) return false
  const st = sistemas.get(id)
  clearTimeout(st.timer)
  if (st.proc) {
    st.proc.once('exit', () => { clearTimeout(st.timer); st.parando = false; ligar(s) })
    st.parando = true
    st.proc.kill()
  } else { st.parando = false; ligar(s) }
  st.reinicios++
  return true
}

// ---------- confere se cada sistema responde (travado = religa) ----------
async function conferir() {
  for (const st of sistemas.values()) {
    const s = st.cfg
    if (!st.proc) continue
    try {
      const r = await fetch(`http://127.0.0.1:${s.porta}${s.saude}`, { signal: AbortSignal.timeout(8000) })
      if (r.status >= 500) throw new Error('resposta ' + r.status)
      st.status = 'no ar'
      st.falhasSaude = 0
    } catch {
      // ainda ligando (primeiro minuto) não conta; depois, 4 falhas seguidas (2 min) = travado
      if (Date.now() - st.desde < Number(process.env.CENTRAL_TOLERANCIA_MS || 60_000)) continue
      st.falhasSaude++
      if (st.falhasSaude >= 4) {
        log(s, `[${hora()}] ${s.nome} não responde há 2 minutos: religando.\n`)
        st.falhasSaude = 0
        try { st.proc.kill() } catch { /* já saiu */ }
      }
    }
  }
}

// ---------- endereço público de cada sistema (link fixo) ----------
function linkDe(s) {
  try { return JSON.parse(fs.readFileSync(path.join(RAIZ, s.env.PASTA_DADOS, 'link-fixo.json'), 'utf8')).endereco || null } catch { return null }
}
export function statusCentral() {
  return {
    nome: 'CENTRAL AUTOMAÇÕES DISPPAR',
    agora: new Date().toISOString(),
    sistemas: [...sistemas.values()].map(st => ({
      id: st.cfg.id, nome: st.cfg.nome, icone: st.cfg.icone, descricao: st.cfg.descricao,
      status: st.status, desde: st.desde ? new Date(st.desde).toISOString() : null, reinicios: st.reinicios,
      ultimaQueda: st.ultimaQueda || null, link: linkDe(st.cfg), local: `http://localhost:${st.cfg.porta}`,
    })),
  }
}

// ---------- página inicial da Central ----------
const PORTAL = path.join(import.meta.dirname, 'portal')
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const deFora = req => !!(req.headers['cf-connecting-ip'] || req.headers['x-atende-ip'] || req.headers['cf-ray'])
function servidorCentral() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local')
    const json = (st, c) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(c)) }
    if (url.pathname === '/api/central/status') return json(200, { ...statusCentral(), noServidor: !deFora(req) })
    if (url.pathname.startsWith('/api/central/reiniciar/') && req.method === 'POST') {
      // reiniciar só no próprio servidor (pela internet, não)
      if (deFora(req)) return json(403, { erro: 'Reiniciar só pelo próprio servidor.' })
      return json(reiniciar(url.pathname.split('/').pop()) ? 200 : 404, { ok: true })
    }
    let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
    const alvo = path.normalize(path.join(PORTAL, rel))
    if (!alvo.startsWith(PORTAL) || !fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) { res.writeHead(404); return res.end('não encontrado') }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    fs.createReadStream(alvo).pipe(res)
  })
}

// ---------- começa ----------
export async function iniciarCentral({ semLink = process.env.SEM_LINK === '1' } = {}) {
  const srv = servidorCentral()
  await new Promise((ok, falha) => { srv.once('error', falha); srv.listen(PORTA, process.env.HOST || '127.0.0.1', ok) })
  console.log(`[${hora()}] CENTRAL AUTOMAÇÕES DISPPAR no ar em http://localhost:${PORTA}`)
  for (const s of lerConfig()) {
    sistemas.set(s.id, { cfg: s, proc: null, status: 'ligando', reinicios: -1, quedas: [], parando: false })
    sistemas.get(s.id).reinicios = 0
    ligar(s)
  }
  const intervalo = Number(process.env.CENTRAL_CONFERIR_MS || 30_000)
  setInterval(conferir, intervalo)
  setTimeout(conferir, Math.min(15_000, intervalo))
  if (!semLink) {
    // página inicial também com link fixo (dados/central/link-fixo.json), no mesmo esquema dos sistemas
    process.env.PASTA_DADOS = path.join(DADOS, 'central')
    fs.mkdirSync(process.env.PASTA_DADOS, { recursive: true })
    process.env.CLOUDFLARED = CLOUDFLARED
    const { iniciarLinkFixo } = await import('./tunel.js')
    iniciarLinkFixo(PORTA)
  }
  const sair = () => { for (const st of sistemas.values()) desligar(st.cfg); setTimeout(() => process.exit(0), 1500) }
  process.on('SIGINT', sair)
  process.on('SIGTERM', sair)
  return srv
}

if (process.argv[1] && path.basename(process.argv[1]) === 'vigia.js') {
  process.on('unhandledRejection', e => console.error(`[${hora()}] Erro não tratado (ignorado): ${e?.stack || e}`))
  iniciarCentral().catch(e => {
    if (e.code === 'EADDRINUSE') { console.error(`⛔ A Central já está ligada neste computador (porta ${PORTA}).`); process.exit(2) }
    console.error(e)
    process.exit(1)
  })
}
