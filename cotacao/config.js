/*
 * Configuração do site publicado (Cloudflare Pages + Supabase).
 * Preencha com os dados do projeto do Supabase: Project Settings → API.
 * A "anon public key" pode ficar aqui: quem protege os dados é a tabela cotacao_usuarios
 * (só os e-mails liberados leem e gravam) e o login.
 * Deixe em branco para usar o sistema sem Supabase (dados só no navegador).
 */
window.COTACAO_CONFIG = window.COTACAO_CONFIG || {
  supabaseUrl: 'https://tdjfmlosdviqplizjvyd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkamZtbG9zZHZpcXBsaXpqdnlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTcyNTEsImV4cCI6MjEwNjE3MzI1MX0.rXYiZaDziFp7dNbIK8Jnn__sjiWJv0O1EkNERlRnMxw',
};
