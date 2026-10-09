import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PASTA = path.resolve(import.meta.dirname, '..')
const rodar = (env, ...args) => spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: PASTA, env: { ...process.env, ...env }, encoding: 'utf8' })

test('importar: documentos e usuários do Supabase, com senha provisória; não substitui sem pedir', () => {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'cot-imp-'))
  const arq = path.join(dados, 'exportacao.json')
  fs.writeFileSync(arq, JSON.stringify({
    documentos: { 'sistema/config': { loja: 'DISPPAR' }, 'produtos/b-00': { itens: [{ id: 'p1', codigo: 'A' }] }, 'cotacoes/c1': { id: 'c1', numero: '0001' }, 'qtds/c1': { qtds: { 0: { paranoa: 2 } } } },
    usuarios: [{ email: 'Chefe@Disppar.com', nome: 'Chefe', admin: true }, { email: 'compras@disppar.com', admin: false }],
  }))
  const r = rodar({ PASTA_DADOS: dados }, 'importar.js', arq)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /4 documentos importados \(1 cotações\)/)
  assert.match(r.stdout, /2 usuário\(s\) com senha provisória/)
  const senhas = fs.readFileSync(path.join(dados, 'senhas-provisorias.txt'), 'utf8')
  assert.match(senhas, /chefe@disppar\.com\t\w{8}\t\(administrador\)/)
  // de novo, sem --substituir: recusa (não apaga o que já está no servidor)
  const r2 = rodar({ PASTA_DADOS: dados }, 'importar.js', arq)
  assert.equal(r2.status, 1)
  assert.match(r2.stderr, /--substituir/)
  const r3 = rodar({ PASTA_DADOS: dados }, 'importar.js', arq, '--substituir')
  assert.equal(r3.status, 0, r3.stderr)
  assert.match(r3.stdout, /Cópia de segurança antes de substituir: \d+/)
  fs.rmSync(dados, { recursive: true, force: true })
})
