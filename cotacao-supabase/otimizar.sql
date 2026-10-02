-- =====================================================================
-- Otimizar o espaço do banco (rodar uma vez no SQL Editor do Supabase)
-- Nada do sistema é apagado: só cópias de backup antigas e o histórico
-- de execução do agendador (pg_cron).
-- =====================================================================

-- 1) Backups: antes guardava 2 cópias por dia durante 30 dias (~60 cópias do banco inteiro).
--    Agora guarda: as 6 mais novas + 1 por dia nos últimos 14 dias + 1 por semana nas últimas 8 semanas.
create or replace function public.cotacao_limpar_backups()
returns int
language plpgsql security definer
set search_path = public
as $$
declare v_n int;
begin
  with manter as (
    (select id from public.cotacao_backups order by criado_em desc limit 6)
    union
    (select distinct on (date_trunc('day', criado_em)) id from public.cotacao_backups
      where criado_em >= now() - interval '14 days' order by date_trunc('day', criado_em), criado_em desc)
    union
    (select distinct on (date_trunc('week', criado_em)) id from public.cotacao_backups
      where criado_em >= now() - interval '8 weeks' order by date_trunc('week', criado_em), criado_em desc)
  )
  delete from public.cotacao_backups where id not in (select id from manter);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cotacao_limpar_backups() from public, anon, authenticated;

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
  perform public.cotacao_limpar_backups();
  return v_id;
end;
$$;
revoke all on function public.cotacao_fazer_backup(text, boolean) from public, anon, authenticated;

-- 2) Histórico do agendador: guarda só 7 dias (ele cresce sem parar)
delete from cron.job_run_details where end_time < now() - interval '7 days';
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cotacao-limpar-cron') then
    perform cron.unschedule('cotacao-limpar-cron');
  end if;
  perform cron.schedule('cotacao-limpar-cron', '30 3 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$);
end;
$$;

-- 3) Limpa agora as cópias antigas
select public.cotacao_limpar_backups() as backups_apagados;

-- 4) Tamanho de cada tabela depois da limpeza
select relname as tabela, pg_size_pretty(pg_total_relation_size(c.oid)) as tamanho
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'cron') and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc limit 10;

-- 5) (depois, numa consulta separada) devolver ao disco o espaço liberado:
--    vacuum full public.cotacao_backups;
--    vacuum full cron.job_run_details;
--    vacuum full public.cotacao_documentos;
