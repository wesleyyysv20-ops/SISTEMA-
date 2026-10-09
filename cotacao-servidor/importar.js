// =====================================================================
// Traz os dados da cotação que estão no Supabase para o servidor local.
// Uso: node importar.js exportacao.json [--substituir]
// O arquivo pode ser:
//   { "documentos": { "caminho": dados, ... }, "usuarios": [{ email, nome, admin }] }  (exportação da migração)
//   { "caminho": dados, ... }                                                          (um backup do Supabase)
// Os usuários entram com uma senha provisória (o Supabase não entrega as senhas),
// anotada em dados/senhas-provisorias.txt — cada um troca ao entrar.
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [arquivo, ...opcoes] = process.argv.slice(2)
if (!arquivo) {
  console.log('Uso: node importar.js exportacao.json [--substituir]')
  process.exit(1)
}
const B = await import('./banco.js')
const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '')) // aceita arquivo salvo com BOM pelo Windows
const documentos = bruto.documentos && typeof bruto.documentos === 'object' ? bruto.documentos : bruto
const usuarios = Array.isArray(bruto.usuarios) ? bruto.usuarios : []
const caminhos = Object.keys(documentos).filter(k => k.includes('/'))
if (!caminhos.length) { console.error('⛔ O arquivo não tem documentos da cotação.'); process.exit(1) }

if (B.contarDocs() && !opcoes.includes('--substituir')) {
  console.error(`⛔ O servidor já tem ${B.contarDocs()} documentos. Para trocar pelos do arquivo, rode de novo com --substituir (antes é feita uma cópia de segurança).`)
  process.exit(1)
}
if (B.contarDocs()) console.log('Cópia de segurança antes de substituir:', B.fazerBackupDocs('antes de importar', true))

B.db.exec('BEGIN')
try {
  B.db.exec('DELETE FROM documentos')
  for (const c of caminhos) B.gravarDoc(c, documentos[c], 'importação')
  B.db.exec('COMMIT')
} catch (e) {
  B.db.exec('ROLLBACK')
  throw e
}
console.log(`✓ ${caminhos.length} documentos importados (${caminhos.filter(c => c.startsWith('cotacoes/')).length} cotações).`)

const linhas = []
for (const u of usuarios) {
  if (!u?.email) continue
  if (B.acharUsuario(u.email)) { B.salvarUsuario({ email: u.email, nome: u.nome || null, admin: !!u.admin }); continue }
  const senha = crypto.randomBytes(4).toString('hex') // 8 letras/números
  B.salvarUsuario({ email: u.email, senha, nome: u.nome || null, admin: !!u.admin })
  linhas.push(`${String(u.email).trim().toLowerCase()}\t${senha}${u.admin ? '\t(administrador)' : ''}`)
}
if (linhas.length) {
  const f = path.join(B.PASTA_DADOS, 'senhas-provisorias.txt')
  fs.writeFileSync(f, 'Senhas provisórias da Cotação (cada pessoa troca em Configurações → Conta e usuários)\r\n\r\n' + linhas.join('\r\n') + '\r\n')
  console.log(`✓ ${linhas.length} usuário(s) com senha provisória: ${f}`)
}
B.fazerBackupDocs('importação', true)
