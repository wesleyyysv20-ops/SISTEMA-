/*
 * Configuração do site publicado (Cloudflare Pages + Supabase).
 * Preencha com os dados do projeto do Supabase: Project Settings → API.
 * A "anon public key" pode ficar aqui: quem protege os dados é a tabela cotacao_usuarios
 * (só os e-mails liberados leem e gravam) e o login.
 * Deixe em branco para usar o sistema sem Supabase (dados só no navegador).
 */
window.COTACAO_CONFIG = window.COTACAO_CONFIG || {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
