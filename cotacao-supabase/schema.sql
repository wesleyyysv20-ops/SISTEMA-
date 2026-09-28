-- =====================================================================
-- Sistema de cotação DISPPAR — banco no Supabase
-- Rode este arquivo inteiro no SQL Editor de um PROJETO NOVO do Supabase
-- (separado do seu outro projeto). Pode rodar de novo sem problema.
-- Antes de rodar, troque o e-mail no final do arquivo pelo seu.
-- =====================================================================

-- Quem pode usar o sistema (e-mails liberados)
create table if not exists public.cotacao_usuarios (
  email      text primary key check (email = lower(email)),
  criado_em  timestamptz not null default now()
);

-- Todos os dados do sistema, no mesmo formato de documentos usado pelo app:
-- "sistema/config", "produtos/lote-000", "fornecedores/lote-000", "cotacoes/<id>"…
create table if not exists public.cotacao_documentos (
  caminho         text primary key,
  colecao         text generated always as (split_part(caminho, '/', 1)) stored,
  dados           jsonb not null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid default auth.uid()
);
create index if not exists cotacao_documentos_colecao_idx on public.cotacao_documentos (colecao);

-- O usuário logado está na lista de acesso?
create or replace function public.cotacao_tem_acesso()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cotacao_usuarios
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.cotacao_tem_acesso() from public, anon;
grant execute on function public.cotacao_tem_acesso() to authenticated;

-- Marca quando e quem alterou cada documento
create or replace function public.cotacao_carimbo()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
drop trigger if exists cotacao_documentos_carimbo on public.cotacao_documentos;
create trigger cotacao_documentos_carimbo
  before insert or update on public.cotacao_documentos
  for each row execute function public.cotacao_carimbo();

-- Segurança: só usuários logados E liberados leem ou gravam. Visitantes (anon) não veem nada.
alter table public.cotacao_usuarios   enable row level security;
alter table public.cotacao_documentos enable row level security;

revoke all on public.cotacao_usuarios, public.cotacao_documentos from anon;
grant select on public.cotacao_usuarios to authenticated;
grant select, insert, update, delete on public.cotacao_documentos to authenticated;

drop policy if exists "cotacao_usuarios: ver o próprio e-mail" on public.cotacao_usuarios;
create policy "cotacao_usuarios: ver o próprio e-mail" on public.cotacao_usuarios
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "cotacao_documentos: ler" on public.cotacao_documentos;
create policy "cotacao_documentos: ler" on public.cotacao_documentos
  for select to authenticated using (public.cotacao_tem_acesso());

drop policy if exists "cotacao_documentos: incluir" on public.cotacao_documentos;
create policy "cotacao_documentos: incluir" on public.cotacao_documentos
  for insert to authenticated with check (public.cotacao_tem_acesso());

drop policy if exists "cotacao_documentos: alterar" on public.cotacao_documentos;
create policy "cotacao_documentos: alterar" on public.cotacao_documentos
  for update to authenticated using (public.cotacao_tem_acesso()) with check (public.cotacao_tem_acesso());

drop policy if exists "cotacao_documentos: excluir" on public.cotacao_documentos;
create policy "cotacao_documentos: excluir" on public.cotacao_documentos
  for delete to authenticated using (public.cotacao_tem_acesso());

-- ---------------------------------------------------------------------
-- LIBERE O SEU E-MAIL (troque pelo e-mail que você vai usar no login).
-- Para liberar outra pessoa depois, rode só esta linha com o e-mail dela.
-- ---------------------------------------------------------------------
insert into public.cotacao_usuarios (email) values (lower('seu-email@exemplo.com'))
on conflict do nothing;
