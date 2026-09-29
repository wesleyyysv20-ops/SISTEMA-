-- =====================================================================
-- Backup automático do sistema de cotação (no próprio Supabase).
-- Duas vezes por dia (12h e 23h de Brasília) guarda uma cópia de todos os documentos,
-- só se algo mudou desde a última. Mantém 30 dias (e nunca menos que as 7 cópias mais novas).
-- Administradores veem, baixam e restauram as cópias em Configurações → Backup.
-- Rode no SQL Editor depois do schema.sql e do usuarios.sql. Pode rodar de novo sem problema.
-- =====================================================================

create extension if not exists pg_cron;

create table if not exists public.cotacao_backups (
  id          bigserial primary key,
  criado_em   timestamptz not null default now(),
  motivo      text not null default 'automático',
  documentos  int not null,
  dados       jsonb not null            -- { "caminho": dados, ... }
);
create index if not exists cotacao_backups_criado_idx on public.cotacao_backups (criado_em desc);

-- ninguém lê a tabela direto: só pelas funções abaixo (administradores)
alter table public.cotacao_backups enable row level security;
revoke all on public.cotacao_backups from anon, authenticated;

-- Faz a cópia. p_forcar = false: não copia se nada mudou desde a última.
create or replace function public.cotacao_fazer_backup(p_motivo text default 'automático', p_forcar boolean default false)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_ultimo timestamptz;
  v_mudou timestamptz;
begin
  select max(atualizado_em) into v_mudou from public.cotacao_documentos;
  select max(criado_em) into v_ultimo from public.cotacao_backups;
  if not p_forcar and v_ultimo is not null and (v_mudou is null or v_mudou <= v_ultimo) then
    return null; -- nada mudou
  end if;
  insert into public.cotacao_backups (motivo, documentos, dados)
  select coalesce(nullif(trim(p_motivo), ''), 'automático'), count(*), coalesce(jsonb_object_agg(caminho, dados), '{}'::jsonb)
  from public.cotacao_documentos
  returning id into v_id;
  -- guarda 30 dias, e sempre as 7 cópias mais novas
  delete from public.cotacao_backups
  where criado_em < now() - interval '30 days'
    and id not in (select id from public.cotacao_backups order by criado_em desc limit 7);
  return v_id;
end;
$$;
revoke all on function public.cotacao_fazer_backup(text, boolean) from public, anon, authenticated;

-- Administrador: fazer uma cópia agora
create or replace function public.cotacao_backup_agora(p_motivo text default 'manual')
returns bigint
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem fazer backup.' using errcode = '42501';
  end if;
  return public.cotacao_fazer_backup(p_motivo || ' (' || coalesce(auth.jwt() ->> 'email', '') || ')', true);
end;
$$;

-- Administrador: lista das cópias (sem os dados)
create or replace function public.cotacao_listar_backups()
returns table (id bigint, criado_em timestamptz, motivo text, documentos int, tamanho bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem ver os backups.' using errcode = '42501';
  end if;
  return query
    select b.id, b.criado_em, b.motivo, b.documentos, pg_column_size(b.dados)::bigint
    from public.cotacao_backups b
    order by b.criado_em desc;
end;
$$;

-- Administrador: os dados de uma cópia (para baixar ou restaurar)
create or replace function public.cotacao_ler_backup(p_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem ler os backups.' using errcode = '42501';
  end if;
  select dados into v from public.cotacao_backups where id = p_id;
  if v is null then
    raise exception 'Backup não encontrado.';
  end if;
  return v;
end;
$$;

revoke all on function public.cotacao_backup_agora(text), public.cotacao_listar_backups(), public.cotacao_ler_backup(bigint) from public, anon;
grant execute on function public.cotacao_backup_agora(text), public.cotacao_listar_backups(), public.cotacao_ler_backup(bigint) to authenticated;

-- Agenda: 15h e 02h UTC = 12h e 23h em Brasília
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cotacao-backup') then
    perform cron.unschedule('cotacao-backup');
  end if;
  perform cron.schedule('cotacao-backup', '0 2,15 * * *', $job$select public.cotacao_fazer_backup('automático')$job$);
end $$;

-- primeira cópia agora
select public.cotacao_fazer_backup('primeira cópia', true) as backup_id;
