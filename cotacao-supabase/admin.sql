-- Definir quem é administrador (rodar uma vez no SQL Editor do Supabase; já incluído em usuarios.sql)

-- Torna (ou deixa de ser) administrador. Só administradores; ninguém tira o próprio acesso de administrador
-- (assim o sistema nunca fica sem nenhum).
create or replace function public.cotacao_definir_admin(p_email text, p_admin boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem definir administradores.' using errcode = '42501';
  end if;
  if not coalesce(p_admin, false) and lower(trim(p_email)) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Você não pode tirar o seu próprio acesso de administrador.';
  end if;
  update public.cotacao_usuarios set admin = coalesce(p_admin, false) where email = lower(trim(p_email));
  if not found then
    raise exception 'Usuário não encontrado: %', p_email;
  end if;
end;
$$;

revoke all on function public.cotacao_definir_admin(text, boolean) from public, anon;
grant execute on function public.cotacao_definir_admin(text, boolean) to authenticated;
