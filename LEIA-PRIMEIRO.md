# Sistema de Cotação DISPPAR — estado atual e próximos passos

Repositório original: <https://github.com/wesleyyysv20-ops/SISTEMA->, branch `claude/friendly-feynman-g6eduz`
(este pacote é uma cópia das pastas do sistema; no repositório também existe um app Android que não faz parte daqui).

## O que é

Sistema web de cotação de autopeças para duas lojas (São Sebastião = DSS, Paranoá = DPR). Uma página só
(HTML + JavaScript puro, sem build). Substitui o programa DISPPAR (Python) e a planilha COTAÇÃO COMPLETA.xlsm.

- `cotacao/` — o sistema (site estático): `index.html`, `app.js`, `style.css`, `config.js`, `_headers`,
  `vendor/` (ExcelJS e supabase-js locais). O `README.md` de lá descreve todas as funções.
- `cotacao-supabase/` — banco no Supabase: `schema.sql` (tabelas + RLS, validado em PostgreSQL 16),
  `publicar.mjs` (robô de publicação), `publicar.json` (e-mail de login), `README.md` (passo a passo manual).
- `cotacao-testes/` — 47 testes automáticos com Playwright (`npm install`, `npx playwright install chromium`, `npm test`).
- `.github/workflows/` — testes a cada alteração (`cotacao-testes.yml`), publicação (`cotacao-publicar.yml`)
  e GitHub Pages (`cotacao-pages.yml`, só na branch main).

## Onde os dados ficam

- Sem configuração (`config.js` em branco): no navegador (localStorage).
- Com `config.js` preenchido: no Supabase, tabela `cotacao_documentos` (documentos JSON: `sistema/config`,
  `sistema/extra`, `produtos/lote-00`…, `fornecedores/lote-00`…, `cotacoes/<id>`), com login por e-mail e senha e
  acesso só para os e-mails da tabela `cotacao_usuarios`.
- Os dados atuais do usuário estão na versão publicada como página do Claude: baixar em
  **Configurações → Baixar backup** e restaurar no site novo em **Configurações → Restaurar backup**.

## O que falta fazer (a publicação)

Requisito do usuário: **tudo separado do outro projeto que ele já tem** no Supabase e na Cloudflare.

1. **Supabase — projeto novo** `cotacoes-disppar` (região São Paulo, `sa-east-1`):
   - rodar `cotacao-supabase/schema.sql` no SQL Editor, trocando `seu-email@exemplo.com` pelo e-mail de login
     (o `publicar.json` tem `wesleyyysv2.0@gmail.com`; confirmar com o usuário);
   - Authentication → Users → criar o usuário com esse e-mail (Auto Confirm) ou mandar convite;
   - Authentication → desligar "Allow new users to sign up";
   - pegar a Project URL e a chave **anon public** (nunca usar a service_role no site).
2. **`cotacao/config.js`**: preencher `supabaseUrl` e `supabaseAnonKey`.
3. **Cloudflare Pages — projeto novo** `cotacoes-disppar`: publicar a pasta `cotacao` (sem build command,
   build output `cotacao`). O usuário teve problema para entrar na conta da Cloudflare com e-mail e senha
   (provavelmente a conta foi criada pelo login do Google ou do GitHub).
4. Supabase → Authentication → URL Configuration: **Site URL** = endereço do site (para o link de
   "esqueci a senha" e do convite abrirem a tela de criar senha, que já existe no sistema).
5. Abrir o site, entrar e restaurar o backup.

### Caminho automático (já pronto, faltou só o segredo)

O workflow `cotacao-publicar.yml` roda `publicar.mjs`, que faz os passos 1 a 4 sozinho pelas APIs e manda o
convite por e-mail. Ele dispara quando `cotacao-supabase/publicar.json` muda (ou por re-run). Precisa dos
segredos do repositório (Settings → Secrets and variables → Actions → **Repository secrets**):
- `SUPABASE_ACCESS_TOKEN` — <https://supabase.com/dashboard/account/tokens>
- `CLOUDFLARE_API_TOKEN` — permissão **Account → Cloudflare Pages → Edit** (opcional: sem ele, faz só o Supabase)

Nas duas execuções anteriores o segredo chegou **vazio** ao workflow (foi salvo em lugar errado), então nada
foi criado ainda. O script pode rodar quantas vezes precisar: ele reaproveita o que já existe.

## Cuidados

- Não colocar tokens nem a chave service_role em arquivos do repositório (o repositório é público).
- A chave anon no `config.js` é pública por natureza; a proteção é o RLS + `cotacao_usuarios` (testado).
- Rodar `npm test` em `cotacao-testes/` depois de qualquer mudança.
