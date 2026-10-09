// =====================================================================
// Monta a pasta CENTRAL-DISPPAR do pendrive a partir das fontes.
// Uso: node montar-pendrive.mjs <pasta-destino>      (ex.: F:\  →  F:\CENTRAL-DISPPAR)
// Junta: central (vigia + página), Cotação (servidor + site), DISPPAR Atende
// (versão instalada em C:\DISPPAR-Atende, sem os dados), runtime (node + cloudflared)
// e os instaladores. Os DADOS entram depois, pelo LEVAR-DADOS.bat no computador antigo.
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'

const destinoBase = process.argv[2]
if (!destinoBase) { console.log('Uso: node montar-pendrive.mjs <pasta-destino>'); process.exit(1) }
const AQUI = import.meta.dirname
const COT = path.resolve(AQUI, '..', 'sistema-cotacao-disppar')
const ATENDE = process.env.ATENDE_INSTALADO || 'C:\\DISPPAR-Atende'
const D = path.join(path.resolve(destinoBase), 'CENTRAL-DISPPAR')

const pular = (...nomes) => src => !nomes.some(n => typeof n === 'string' ? path.basename(src) === n : n.test(path.basename(src)))
function copiar(origem, destino, filtro = () => true) {
  if (!fs.existsSync(origem)) throw new Error('não achei ' + origem)
  fs.rmSync(destino, { recursive: true, force: true })
  fs.cpSync(origem, destino, { recursive: true, filter: filtro })
  console.log('  ✓', path.relative(D, destino))
}

console.log('Montando', D)
fs.mkdirSync(D, { recursive: true })
copiar(path.join(AQUI, 'central'), path.join(D, 'programa', 'central'))
copiar(path.join(COT, 'cotacao-servidor'), path.join(D, 'programa', 'cotacao', 'servidor'), pular('dados', 'test', 'node_modules'))
copiar(path.join(COT, 'cotacao'), path.join(D, 'programa', 'cotacao', 'site'), pular('_headers', 'README.md'))
copiar(path.join(ATENDE, 'servidor'), path.join(D, 'programa', 'atende', 'servidor'), pular('dados', /^dados-anterior/, 'test', /\.log$/, 'INICIAR.bat', 'CRIAR-ADMIN.bat', 'SERVIDOR.bat'))
copiar(path.join(ATENDE, 'painel'), path.join(D, 'programa', 'atende', 'painel'))
copiar(path.join(ATENDE, 'runtime'), path.join(D, 'runtime'))
copiar(path.join(AQUI, 'instalador', 'scripts'), path.join(D, 'scripts'))
for (const f of fs.readdirSync(path.join(AQUI, 'instalador')).filter(f => /\.(bat|txt)$/i.test(f))) fs.copyFileSync(path.join(AQUI, 'instalador', f), path.join(D, f))
for (const p of ['cotacao', 'atende', 'central']) fs.mkdirSync(path.join(D, 'dados', p), { recursive: true })
// links fixos (segredos): ficam fora do GitHub, em central-disppar/link-fixo/*.json → dados/<sistema>/link-fixo.json
const LF = path.join(AQUI, 'link-fixo')
if (fs.existsSync(LF)) for (const p of ['cotacao', 'central']) {
  const f = path.join(LF, `${p}.json`)
  if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(D, 'dados', p, 'link-fixo.json')); console.log('  ✓ link fixo de', p) }
}
const tamanho = d => fs.readdirSync(d, { withFileTypes: true }).reduce((t, e) => t + (e.isDirectory() ? tamanho(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0)
console.log(`Pronto: ${(tamanho(D) / 1024 / 1024).toFixed(0)} MB em ${D}`)
