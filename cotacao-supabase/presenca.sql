-- =====================================================================
-- "Quem está nesta cotação agora": canal privado de presença do Supabase Realtime.
-- Só usuários logados E liberados (cotacao_usuarios) entram no canal 'cotacao-presenca'.
-- Rode no SQL Editor depois do schema.sql. Pode rodar de novo sem problema.
-- =====================================================================

drop policy if exists "cotacao: presença (ver)" on realtime.messages;
create policy "cotacao: presença (ver)" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'cotacao-presenca' and public.cotacao_tem_acesso());

drop policy if exists "cotacao: presença (anunciar)" on realtime.messages;
create policy "cotacao: presença (anunciar)" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() = 'cotacao-presenca' and public.cotacao_tem_acesso());
