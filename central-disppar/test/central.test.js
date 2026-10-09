import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Monta uma Central de teste (pastas ligadas às fontes), liga os dois sistemas em portas de teste
// SEM link público e SEM WhatsApp, e confere que um cair não derruba o outro.
const FONTES = path.resolve(import.meta.dirname, '..', '..')
const COT = path.join(FONTES, 'sistema-cotacao-disppar')
const ATENDE = process.env.ATENDE_FONTE || 'C:/Users/BALCAO/Desktop/ATENDIMENTO WHATSAPP'
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'central-'))
const liga = (alvo, nome) => { fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true }); fs.symlinkSync(alvo, path.join(raiz, nome), 'junction') }
liga(path.join(FONTES, 'central-disppar', 'central'), 'central')
liga(path.join(COT, 'cotacao-servidor'), 'cotacao/servidor')
liga(path.join(COT, 'cotacao'), 'cotacao/site')
liga(path.join(ATENDE, 'servidor'), 'atende/servidor')
liga(path.join(ATENDE, 'painel'), 'atende/painel')
const base = 4100 + Math.floor(Math.random() * 50) * 3
fs.mkdirSync(path.join(raiz, 'dados'), { recursive: true })
fs.writeFileSync(path.join(raiz, 'dados', 'central.json'), JSON.stringify({ cotacao: { porta: base + 1 }, atende: { porta: base + 2 } }))
const CENTRAL = `http://127.0.0.1:${base}`
const vigia = spawn(process.execPath, ['--no-warnings', path.join(raiz, 'central', 'vigia.js')], {
  env: { ...process.env, CENTRAL_RAIZ: raiz, PORTA_CENTRAL: String(base), SEM_LINK: '1', SEM_WHATSAPP: '1', NODE_EXE: process.execPath, CENTRAL_CONFERIR_MS: '1500', CENTRAL_TOLERANCIA_MS: '25000' },
  stdio: 'pipe',
})
after(() => {
  try { console.log('--- log atende ---', fs.readFileSync(path.join(raiz, 'dados', 'logs', 'atende.log'), 'utf8').slice(-1500)) } catch { /* sem log */ }
  vigia.kill()
  setTimeout(() => fs.rmSync(raiz, { recursive: true, force: true }), 2500)
})
const status = async () => (await (await fetch(CENTRAL + '/api/central/status')).json())
const esperar = async (cond, ms = 30000) => { const fim = Date.now() + ms; for (;;) { const s = await status().catch(() => null); if (s && cond(s)) return s; if (Date.now() > fim) throw new Error('tempo esgotado: ' + JSON.stringify(s)); await new Promise(r => setTimeout(r, 500)) } }
const sis = (s, id) => s.sistemas.find(x => x.id === id)

test('Central: liga os dois sistemas; derrubar um não afeta o outro e ele volta sozinho', async () => {
  const s1 = await esperar(s => s.sistemas.length === 2 && s.sistemas.every(x => x.status === 'no ar'))
  assert.deepEqual(s1.sistemas.map(x => x.id), ['cotacao', 'atende'])
  assert.equal(s1.noServidor, true)
  // página inicial
  const html = await (await fetch(CENTRAL + '/')).text()
  assert.match(html, /CENTRAL AUTOMAÇÕES/)
  // os dois respondem nas portas deles
  assert.equal((await fetch(`http://127.0.0.1:${base + 1}/api/status`)).status, 200)
  assert.ok((await fetch(`http://127.0.0.1:${base + 2}/`)).status < 500)
  // derruba a Cotação de propósito (como se ela travasse e fechasse)
  const pid = (await (await fetch(`http://127.0.0.1:${base + 1}/api/status`)).json()) && null
  process.kill((await status()).sistemas && Number(await pidDe('cotacao')), 'SIGKILL')
  await esperar(s => sis(s, 'cotacao').status !== 'no ar' || sis(s, 'cotacao').reinicios > 0)
  // o Atende continua no ar o tempo todo
  assert.ok((await fetch(`http://127.0.0.1:${base + 2}/`)).status < 500, 'o Atende continua respondendo')
  // e a Cotação volta sozinha
  const s3 = await esperar(s => sis(s, 'cotacao').status === 'no ar' && sis(s, 'cotacao').reinicios >= 1)
  assert.equal(sis(s3, 'atende').reinicios, 0, 'o Atende não foi reiniciado')
  // reiniciar pela internet é proibido; no servidor, pode
  const fora = await fetch(CENTRAL + '/api/central/reiniciar/atende', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4' } })
  assert.equal(fora.status, 403)
  void pid
})

async function pidDe(id) {
  // o vigia não expõe o PID pela página (é público); o teste lê pelo Windows qual node roda a pasta do sistema
  const { execSync } = await import('node:child_process')
  const porta = id === 'cotacao' ? base + 1 : base + 2
  const linhas = execSync(`netstat -ano -p TCP`, { encoding: 'utf8' }).split(/\r?\n/).filter(l => l.includes(`127.0.0.1:${porta} `) && /LISTENING/.test(l))
  return linhas[0].trim().split(/\s+/).pop()
}
