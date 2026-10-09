// =====================================================================
// LINK FIXO DA COTAÇÃO: abre o túnel da Cloudflare e avisa o repassador (Worker)
// qual é o endereço do momento. Assim os vendedores usam sempre o mesmo
// link, mesmo que o computador reinicie. (Mesmo esquema do DISPPAR Atende.)
// Configuração em dados/link-fixo.json: { "endereco": "https://...workers.dev", "segredo": "..." }
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { PASTA_DADOS } from "./banco.js"
import { estado } from "./servidor.js"

const ARQUIVO = path.join(PASTA_DADOS, 'link-fixo.json')
const hora = () => new Date().toLocaleTimeString('pt-BR')
export const estadoLink = (estado.link = { endereco: null, no_ar: false, avisado_em: null })

function acharCloudflared() {
  const candidatos = [
    process.env.CLOUDFLARED,
    path.join(import.meta.dirname, 'cloudflared.exe'),
    path.join(import.meta.dirname, '..', 'runtime', 'cloudflared.exe'), // Central DISPPAR
    path.join(import.meta.dirname, '..', '..', 'runtime', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe'
  ].filter(Boolean)
  const achado = candidatos.find((c) => fs.existsSync(c))
  if (achado) return achado
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null
}

// Fecha túneis que sobraram de uma execução anterior (apontando para esta porta)
function fecharTuneisAntigos(porta) {
  if (process.platform !== 'win32') return
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -match 'localhost:${porta}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
  { windowsHide: true })
}

export function iniciarLinkFixo(porta) {
  if (!fs.existsSync(ARQUIVO)) {
    console.log('Link fixo: desligado (falta o arquivo dados/link-fixo.json).')
    return
  }
  const { endereco, segredo } = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))
  estadoLink.endereco = endereco
  const exe = acharCloudflared()
  if (!exe) {
    console.warn('Link fixo: programa cloudflared não encontrado. Instale com: winget install --id Cloudflare.cloudflared (na Central ele já vem na pasta runtime)')
    return
  }
  fecharTuneisAntigos(porta)

  let atual = null
  let avisado = null
  let tentativa = null

  async function avisar() {
    clearTimeout(tentativa)
    if (!atual) return
    try {
      const r = await fetch(`${endereco}/__registrar`, {
        method: 'POST',
        headers: { 'x-segredo': segredo, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino: atual })
      })
      if (!r.ok) throw new Error(`resposta ${r.status}`)
      if (avisado !== atual) console.log(`[${hora()}] Link fixo no ar: ${endereco}`)
      avisado = atual
      Object.assign(estadoLink, { no_ar: true, avisado_em: new Date().toISOString() })
    } catch (e) {
      console.warn(`[${hora()}] Não consegui avisar o link fixo (${e.message}). Tento de novo em 30 s.`)
      tentativa = setTimeout(avisar, 30_000)
    }
  }

  function abrir() {
    const p = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${porta}`], { windowsHide: true })
    const ler = (d) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && m[0] !== atual) { atual = m[0]; avisar() }
    }
    p.stdout.on('data', ler)
    p.stderr.on('data', ler)
    p.on('exit', (codigo) => {
      atual = null
      estadoLink.no_ar = false
      console.warn(`[${hora()}] O túnel fechou (código ${codigo}). Reabrindo em 10 s...`)
      setTimeout(abrir, 10_000)
    })
    process.once('exit', () => p.kill())
  }

  setInterval(avisar, 10 * 60_000) // reforça o aviso de tempos em tempos
  abrir()
}
