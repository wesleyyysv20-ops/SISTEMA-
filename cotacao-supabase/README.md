# Publicar o sistema de cotação no Supabase e na Cloudflare

Tudo fica **separado do seu outro projeto**: um projeto novo no Supabase (banco e login) e um
projeto novo no Cloudflare Pages (o site). Nada é compartilhado com o que já existe lá.

## Publicação automática (recomendado)

O workflow **Publicar cotação (Supabase + Cloudflare)** (`.github/workflows/cotacao-publicar.yml`, script
[`publicar.mjs`](publicar.mjs)) faz tudo sozinho: cria o projeto `cotacoes-disppar` no Supabase (São Paulo),
roda o `schema.sql`, fecha os cadastros, cria o projeto Pages `cotacoes-disppar`, gera o `config.js`,
publica o site e manda um **convite por e-mail** para você criar a senha. Depois, cada alteração em
`cotacao/` é publicada de novo.

Você só precisa, uma vez:
1. Criar um token no Supabase: <https://supabase.com/dashboard/account/tokens> → **Generate new token**.
2. Criar um token na Cloudflare: **My Profile → API Tokens → Create Token → Custom token**, com a
   permissão **Account → Cloudflare Pages → Edit**.
3. No GitHub do repositório: **Settings → Secrets and variables → Actions → New repository secret**,
   criar `SUPABASE_ACCESS_TOKEN` e `CLOUDFLARE_API_TOKEN` com esses valores.
4. Enviar `cotacao-supabase/publicar.json` com o seu e-mail de login: `{"email": "voce@exemplo.com"}`.

## Publicação manual (se preferir fazer pelos painéis)

## 1. Supabase — projeto novo

1. Em <https://supabase.com/dashboard>, clique em **New project**. Nome sugerido: `cotacoes-disppar`.
   Escolha a região **South America (São Paulo)** e guarde a senha do banco.
   (Se o plano gratuito não deixar criar outro projeto, pause um que não use ou me avise.)
2. Abra **SQL Editor → New query**, cole o conteúdo de [`schema.sql`](schema.sql),
   **troque `seu-email@exemplo.com` pelo seu e-mail** (última linha) e clique em **Run**.
3. **Authentication → Users → Add user → Create new user**: o mesmo e-mail e uma senha.
   Marque **Auto Confirm User**.
4. **Authentication → Sign In / Providers**: desligue **Allow new users to sign up**
   (só você cria as contas).
5. **Project Settings → API**: copie a **Project URL** e a chave **anon public**.

Para liberar outra pessoa depois: crie o usuário (passo 3) e rode no SQL Editor
`insert into public.cotacao_usuarios (email) values ('email@dela.com');`

## 2. Configurar o site

No arquivo [`cotacao/config.js`](../cotacao/config.js), preencha:

```js
window.COTACAO_CONFIG = window.COTACAO_CONFIG || {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJ...',
};
```

A chave *anon public* é feita para ficar no site: quem protege os dados é o login e a lista
`cotacao_usuarios` (testado: sem estar na lista, não se lê nem se grava nada).

## 3. Cloudflare Pages — projeto novo

1. No painel da Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
2. Escolha o repositório **SISTEMA-** e configure:
   - **Project name:** `cotacoes-disppar` (vira o endereço `cotacoes-disppar.pages.dev`)
   - **Production branch:** a branch com o sistema (hoje `claude/friendly-feynman-g6eduz`, ou `main` depois de juntar)
   - **Framework preset:** None
   - **Build command:** (vazio)
   - **Build output directory:** `cotacao`
3. **Save and Deploy**. A cada alteração enviada para essa branch, o site é publicado de novo.
4. De volta ao Supabase, em **Authentication → URL Configuration**, coloque o endereço do site
   em **Site URL** (para o link de "Esqueci a senha" funcionar).

## 4. Levar os dados atuais

1. Na versão atual (página do Claude): **Configurações → ⬇ Baixar backup**.
2. No site novo, entre com o seu e-mail e senha.
3. **Configurações → 📥 Restaurar backup** e escolha o arquivo. Tudo vai para o Supabase.

Depois disso, use só o site novo: a página do Claude fica com os dados antigos.
