// Ferramentas da Central (usadas pelos scripts do pendrive)
//   node ferramentas.js copiar-banco <origem.db> <destino.db>   cópia segura com o sistema ligado (VACUUM INTO)
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [cmd, origem, destino] = process.argv.slice(2)
if (cmd === 'copiar-banco') {
  for (const f of [destino, destino + '-wal', destino + '-shm']) fs.rmSync(f, { force: true })
  const d = new DatabaseSync(origem, { readOnly: true })
  d.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`)
  d.close()
  const c = new DatabaseSync(destino, { readOnly: true })
  const ok = c.prepare('PRAGMA integrity_check').get()
  c.close()
  console.log(Object.values(ok)[0] === 'ok' ? 'ok' : 'falhou')
} else {
  console.log('Uso: node ferramentas.js copiar-banco <origem.db> <destino.db>')
  process.exit(1)
}
