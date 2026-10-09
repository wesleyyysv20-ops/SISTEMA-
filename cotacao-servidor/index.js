// =====================================================================
// Cotação DISPPAR — programa que fica ligado no servidor da loja
// (faz parte da Central Automações DISPPAR, mas funciona sozinho também).
// Iniciar: node index.js   (a Central liga e religa este programa sozinha)
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'

const PORTA = Number(process.env.PORTA || 3220)
// Só este computador acessa direto; de fora, o acesso é pelo túnel da Cloudflare
const HOST = process.env.HOST || '127.0.0.1'

function parar(msg) {
  console.error('\n' + msg + '\n')
  process.exit(2) // 2 = não adianta tentar de novo (a Central entende)
}

const [maior, menor] = process.versions.node.split('.').map(Number)
if (maior < 22 || (maior === 22 && menor < 5)) parar(`⛔ Este computador tem o Node ${process.versions.node}. A Cotação precisa do Node 22.5 ou mais novo.`)

process.on('unhandledRejection', e => console.error(`[${new Date().toLocaleTimeString('pt-BR')}] Erro não tratado (ignorado): ${e?.stack || e}`))

const B = await import('./banco.js')
const { iniciarServidor, PASTA_SITE } = await import('./servidor.js')
const { iniciarLinkFixo } = await import('./tunel.js')

console.log('Cotação DISPPAR — iniciando.')
console.log('Dados em: ' + B.PASTA_DADOS)
console.log('Site em: ' + PASTA_SITE)
if (!fs.existsSync(path.join(PASTA_SITE, 'index.html'))) parar('⛔ Não achei o site da cotação (index.html) em ' + PASTA_SITE)
if (!B.contarAdmins()) console.warn('\n⚠️  Nenhum administrador cadastrado. Rode: node criar-admin.js email senha\n')

try {
  await iniciarServidor(PORTA, HOST)
} catch (e) {
  if (e.code === 'EADDRINUSE') parar(`⛔ A Cotação já está aberta neste computador (porta ${PORTA} em uso).`)
  throw e
}
if (process.env.SEM_LINK !== '1') iniciarLinkFixo(PORTA)

// Cópias de segurança: dos dados 2x por dia (quando mudou) e do arquivo do banco 1x por dia
function backups() {
  try {
    const h = new Date().getHours()
    const ultimo = B.listarBackups()[0]
    const horas = ultimo ? (Date.now() - Date.parse(ultimo.criado_em)) / 3600_000 : Infinity
    if (horas >= 11 || (h >= 23 && horas >= 1)) { const id = B.fazerBackupDocs('automático'); if (id) console.log('Backup dos dados:', id) }
    const f = B.copiarArquivoBanco()
    if (f) console.log('Cópia do banco:', f)
  } catch (e) {
    console.error('Falha no backup:', e.message)
  }
}
backups()
setInterval(backups, 30 * 60_000)

process.on('SIGINT', () => { console.log('Desligando...'); process.exit(0) })
process.on('SIGTERM', () => process.exit(0))
