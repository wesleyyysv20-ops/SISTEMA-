# Sistema de Cotação DISPPAR — estado atual

Repositório: <https://github.com/wesleyyysv20-ops/SISTEMA->, branch `claude/friendly-feynman-g6eduz`
(no repositório também existe um app Android que não faz parte do sistema de cotação).

## O que é

Sistema web de cotação de autopeças para duas lojas (Paranoá = DPR, São Sebastião = DSS). Uma página só
(HTML + JavaScript puro, sem build). Substitui o programa DISPPAR (Python) e a planilha COTAÇÃO COMPLETA.xlsm.

- `cotacao/` — o sistema (site estático): `index.html`, `app.js`, `style.css`, `config.js`, `_headers`,
  `vendor/` (ExcelJS e supabase-js locais). O `README.md` de lá descreve as funções.
- `cotacao-supabase/` — banco no Supabase: `schema.sql` (tabelas + RLS), `publicar.mjs` (robô de publicação),
  `README.md` (passo a passo).
- `cotacao-testes/` — testes automáticos com Playwright (`npm install`, `npx playwright install chromium`, `npm test`).
- `.github/workflows/` — testes a cada alteração, publicação e GitHub Pages.

## Publicado (desde 28/09/2026)

- **Site:** <https://cotacoes-disppar.pages.dev> (Cloudflare Pages, projeto `cotacoes-disppar`, envio direto pelo wrangler).
- **Banco:** Supabase, projeto `cotacoes-disppar` (São Paulo). Login por e-mail e senha; só entram os e-mails da
  tabela `cotacao_usuarios`. Cadastro aberto desligado: administradores cadastram usuários em Configurações → Conta
  (funções do `cotacao-supabase/usuarios.sql`, já aplicado em 29/09/2026, junto com o tempo real).
- **Publicar de novo** depois de mudar o sistema (na pasta do repositório, com `npx wrangler login` feito uma vez):

      npx wrangler pages deploy cotacao --project-name cotacoes-disppar --branch main

## Onde os dados ficam

- Tabela `cotacao_documentos` do Supabase, em documentos JSON: `sistema/config`, `sistema/extra`,
  `produtos/b-00`…`b-63` e `fornecedores/b-00`…`b-03` (cada item sempre no mesmo "balde", pelo id) e `cotacoes/<id>`.
- Cada gravação confere a versão (`atualizado_em`): se outro computador gravou antes, o sistema junta as duas versões
  item por item em vez de sobrescrever. O que não chegou a ser enviado fica anotado no navegador e vai na próxima abertura.
- Backup manual: **Configurações → Baixar backup** / **Restaurar backup**.

## Cuidados

- Não colocar tokens nem a chave `service_role` em arquivos do repositório (o repositório é público).
- A chave `anon` no `config.js` é pública por natureza; a proteção é o login + RLS + `cotacao_usuarios`.
- Rodar `npm test` em `cotacao-testes/` depois de qualquer mudança.
- Arquivos com fim de linha LF (padrão do repositório).

## Pendências

- Backup automático dos dados (o plano grátis do Supabase não guarda cópias; o projeto pausa após 7 dias sem uso).
- Trocar a chave `service_role` do Supabase (foi exposta numa conversa; não está em nenhum arquivo).
