// Cria (ou atualiza) um usuário administrador da Cotação.
// Uso: node criar-admin.js email senha [nome]
const [email, senha, ...nome] = process.argv.slice(2)
if (!email || !senha) {
  console.log('Uso: node criar-admin.js email senha [nome]')
  process.exit(1)
}
const B = await import('./banco.js')
try {
  B.salvarUsuario({ email, senha, nome: nome.join(' ') || null, admin: true })
  if (B.acharUsuario(email)) B.definirSenha(email, senha)
  console.log(`✓ Administrador pronto: ${email.toLowerCase()} (dados em ${B.PASTA_DADOS})`)
} catch (e) {
  console.error('⛔ ' + e.message)
  process.exit(1)
}
