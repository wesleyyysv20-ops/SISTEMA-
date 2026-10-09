// =====================================================================
// Cotação DISPPAR — banco local (SQLite que vem no Node 22.5+)
// Guarda os mesmos "documentos" que o sistema guardava no Supabase
// (sistema/config, produtos/b-NN, cotacoes/<id>, qtds/<id>…), os usuários,
// as sessões de login e as cópias de segurança.
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

export const PASTA_DADOS = process.env.PASTA_DADOS ? path.resolve(process.env.PASTA_DADOS) : path.join(import.meta.dirname, 'dados')
fs.mkdirSync(PASTA_DADOS, { recursive: true })
export const ARQUIVO_BANCO = path.join(PASTA_DADOS, 'cotacao.db')

export const db = new DatabaseSync(ARQUIVO_BANCO)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS documentos (
    caminho TEXT PRIMARY KEY,
    colecao TEXT NOT NULL,
    dados TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    atualizado_por TEXT
  );
  CREATE INDEX IF NOT EXISTS documentos_colecao ON documentos (colecao);
  CREATE TABLE IF NOT EXISTS usuarios (
    email TEXT PRIMARY KEY,
    nome TEXT,
    senha TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    ultimo_acesso TEXT
  );
  CREATE TABLE IF NOT EXISTS sessoes (
    token TEXT PRIMARY KEY,
    refresh TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    expira INTEGER NOT NULL,
    refresh_expira INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    criado_em TEXT NOT NULL,
    motivo TEXT NOT NULL,
    documentos INTEGER NOT NULL,
    tamanho INTEGER NOT NULL,
    dados BLOB NOT NULL
  );
`)

// ---------- versão de cada documento (o mesmo formato do Supabase: microssegundos, sempre crescente) ----------
let ultimoMicro = 0
export function novaVersao() {
  const agora = Date.now() * 1000
  ultimoMicro = Math.max(agora, ultimoMicro + 1)
  const ms = Math.floor(ultimoMicro / 1000)
  const micro = String(ultimoMicro % 1_000_000).padStart(6, '0')
  return new Date(ms).toISOString().slice(0, 19) + '.' + micro + '+00:00'
}
const colecaoDe = caminho => String(caminho).split('/')[0]

// ---------- documentos ----------
export function listarDocs({ caminhos = null, colecoes = null, versoes = null } = {}) {
  let linhas = db.prepare('SELECT caminho, colecao, dados, atualizado_em, atualizado_por FROM documentos ORDER BY caminho').all()
  if (caminhos) { const s = new Set(caminhos); linhas = linhas.filter(l => s.has(l.caminho)) }
  if (colecoes) { const s = new Set(colecoes); linhas = linhas.filter(l => s.has(l.colecao)) }
  if (versoes) { const s = new Set(versoes); linhas = linhas.filter(l => s.has(l.atualizado_em)) }
  return linhas
}
export function existeDoc(caminho) {
  return !!db.prepare('SELECT 1 FROM documentos WHERE caminho = ?').get(caminho)
}
export function gravarDoc(caminho, dados, por) {
  const v = novaVersao()
  db.prepare(`INSERT INTO documentos (caminho, colecao, dados, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(caminho) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`)
    .run(caminho, colecaoDe(caminho), JSON.stringify(dados), v, por || null)
  return v
}
export function apagarDoc(caminho) {
  db.prepare('DELETE FROM documentos WHERE caminho = ?').run(caminho)
}
export const contarDocs = () => db.prepare('SELECT COUNT(*) AS n FROM documentos').get().n
export const ultimaMudanca = () => db.prepare('SELECT MAX(atualizado_em) AS v FROM documentos').get().v

// ---------- usuários e senhas ----------
const normEmail = e => String(e || '').trim().toLowerCase()
export function hashSenha(senha) {
  const sal = crypto.randomBytes(16)
  const h = crypto.scryptSync(String(senha), sal, 64)
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`
}
export function senhaConfere(senha, guardada) {
  const [tipo, salHex, hHex] = String(guardada || '').split('$')
  if (tipo !== 'scrypt' || !salHex || !hHex) return false
  const h = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 64)
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'))
}
export const acharUsuario = email => db.prepare('SELECT * FROM usuarios WHERE email = ?').get(normEmail(email)) || null
export const listarUsuarios = () => db.prepare('SELECT email, nome, admin, criado_em, ultimo_acesso FROM usuarios ORDER BY email').all()
  .map(u => ({ ...u, admin: !!u.admin }))
export const contarAdmins = () => db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE admin = 1').get().n
export function salvarUsuario({ email, senha, nome = null, admin = false }) {
  const e = normEmail(email)
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw erroUso('E-mail inválido.')
  const ja = acharUsuario(e)
  if (!ja && String(senha || '').length < 6) throw erroUso('A senha precisa ter pelo menos 6 caracteres.')
  if (ja) {
    db.prepare('UPDATE usuarios SET nome = COALESCE(?, nome), admin = ? WHERE email = ?').run(nome, admin ? 1 : 0, e)
    if (senha) definirSenha(e, senha)
  } else {
    db.prepare('INSERT INTO usuarios (email, nome, senha, admin, criado_em) VALUES (?, ?, ?, ?, ?)').run(e, nome, hashSenha(senha), admin ? 1 : 0, new Date().toISOString())
  }
}
export function definirSenha(email, senha, manterToken = null) {
  if (String(senha || '').length < 6) throw erroUso('A senha precisa ter pelo menos 6 caracteres.')
  const r = db.prepare('UPDATE usuarios SET senha = ? WHERE email = ?').run(hashSenha(senha), normEmail(email))
  if (!r.changes) throw erroUso('Usuário não encontrado: ' + email)
  db.prepare('DELETE FROM sessoes WHERE email = ? AND token IS NOT ?').run(normEmail(email), manterToken) // senha nova: sai dos outros computadores
}
export function definirAdmin(email, admin) {
  const r = db.prepare('UPDATE usuarios SET admin = ? WHERE email = ?').run(admin ? 1 : 0, normEmail(email))
  if (!r.changes) throw erroUso('Usuário não encontrado: ' + email)
}
export function removerUsuario(email) {
  db.prepare('DELETE FROM usuarios WHERE email = ?').run(normEmail(email))
  db.prepare('DELETE FROM sessoes WHERE email = ?').run(normEmail(email))
}
export function erroUso(msg, code = 'P0001') {
  const e = new Error(msg)
  e.code = code
  e.uso = true
  return e
}

// ---------- sessões de login ----------
const HORA = 3600
export function criarSessao(email) {
  const token = crypto.randomBytes(32).toString('hex')
  const refresh = crypto.randomBytes(32).toString('hex')
  const agora = Math.floor(Date.now() / 1000)
  db.prepare('INSERT INTO sessoes (token, refresh, email, expira, refresh_expira) VALUES (?, ?, ?, ?, ?)').run(token, refresh, normEmail(email), agora + 12 * HORA, agora + 60 * 24 * HORA)
  db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE email = ?').run(new Date().toISOString(), normEmail(email))
  db.prepare('DELETE FROM sessoes WHERE refresh_expira < ?').run(agora)
  return { token, refresh, expira: agora + 12 * HORA }
}
export function usuarioDoToken(token) {
  if (!token) return null
  const s = db.prepare('SELECT * FROM sessoes WHERE token = ?').get(token)
  if (!s || s.expira < Math.floor(Date.now() / 1000)) return null
  return acharUsuario(s.email)
}
export function renovarSessao(refresh) {
  const s = db.prepare('SELECT * FROM sessoes WHERE refresh = ?').get(refresh)
  if (!s || s.refresh_expira < Math.floor(Date.now() / 1000) || !acharUsuario(s.email)) return null
  db.prepare('DELETE FROM sessoes WHERE refresh = ?').run(refresh)
  return { email: s.email, ...criarSessao(s.email) }
}
export const encerrarSessao = token => db.prepare('DELETE FROM sessoes WHERE token = ?').run(token)

// ---------- cópias de segurança ----------
export function fazerBackupDocs(motivo = 'automático', forcar = false) {
  const ultimo = db.prepare('SELECT criado_em FROM backups ORDER BY id DESC LIMIT 1').get()
  const mudou = ultimaMudanca()
  if (!forcar && ultimo && (!mudou || Date.parse(mudou.slice(0, 23) + 'Z') <= Date.parse(ultimo.criado_em))) return null // nada mudou
  const mapa = Object.fromEntries(listarDocs().map(l => [l.caminho, JSON.parse(l.dados)]))
  const json = JSON.stringify(mapa)
  const r = db.prepare('INSERT INTO backups (criado_em, motivo, documentos, tamanho, dados) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), motivo || 'automático', Object.keys(mapa).length, json.length, zlib.gzipSync(json))
  limparBackups()
  return Number(r.lastInsertRowid)
}
/** Guarda as 6 mais novas + 1 por dia (14 dias) + 1 por semana (8 semanas). */
export function limparBackups() {
  const todos = db.prepare('SELECT id, criado_em FROM backups ORDER BY criado_em DESC').all()
  const manter = new Set(todos.slice(0, 6).map(b => b.id))
  const agora = Date.now()
  const dias = new Set(), semanas = new Set()
  for (const b of todos) {
    const t = Date.parse(b.criado_em)
    const dia = b.criado_em.slice(0, 10)
    const semana = Math.floor(t / (7 * 86400_000))
    if (agora - t <= 14 * 86400_000 && !dias.has(dia)) { dias.add(dia); manter.add(b.id) }
    if (agora - t <= 56 * 86400_000 && !semanas.has(semana)) { semanas.add(semana); manter.add(b.id) }
  }
  for (const b of todos) if (!manter.has(b.id)) db.prepare('DELETE FROM backups WHERE id = ?').run(b.id)
}
export const listarBackups = () => db.prepare('SELECT id, criado_em, motivo, documentos, tamanho FROM backups ORDER BY id DESC').all()
export function lerBackup(id) {
  const b = db.prepare('SELECT dados FROM backups WHERE id = ?').get(Number(id))
  if (!b) throw erroUso('Backup não encontrado.')
  return JSON.parse(zlib.gunzipSync(b.dados).toString('utf8'))
}
/** Cópia do arquivo do banco inteiro (para o pendrive): dados/backups/cotacao-AAAA-MM-DD.db */
export function copiarArquivoBanco() {
  const pasta = path.join(PASTA_DADOS, 'backups')
  fs.mkdirSync(pasta, { recursive: true })
  const destino = path.join(pasta, `cotacao-${new Date().toISOString().slice(0, 10)}.db`)
  if (fs.existsSync(destino)) return null
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`)
  // guarda 10 dias de arquivos
  const arquivos = fs.readdirSync(pasta).filter(f => /^cotacao-\d{4}-\d\d-\d\d\.db$/.test(f)).sort()
  for (const f of arquivos.slice(0, -10)) fs.rmSync(path.join(pasta, f), { force: true })
  return destino
}
