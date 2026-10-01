-- =====================================================================
-- Usuários do sistema de cotação: administradores cadastram outras pessoas
-- pelo próprio sistema (Configurações → Usuários), sem abrir o Supabase.
-- Rode no SQL Editor depois do schema.sql. Pode rodar de novo sem problema.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

alter table public.cotacao_usuarios add column if not exists admin boolean not null default false;
alter table public.cotacao_usuarios add column if not exists nome text;

-- O usuário logado é administrador?
create or replace function public.cotacao_sou_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cotacao_usuarios
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and admin
  );
$$;

-- Lista de usuários (só administradores)
create or replace function public.cotacao_listar_usuarios()
returns table (email text, nome text, admin boolean, criado_em timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem ver os usuários.' using errcode = '42501';
  end if;
  return query
    select u.email, u.nome, u.admin, u.criado_em, a.last_sign_in_at
    from public.cotacao_usuarios u
    left join auth.users a on lower(a.email) = u.email
    order by u.admin desc, u.email;
end;
$$;

-- Cadastra (ou libera de novo) um usuário com e-mail e senha. Só administradores.
-- A conta já nasce confirmada: a pessoa entra direto com o e-mail e a senha.
create or replace function public.cotacao_adicionar_usuario(p_email text, p_senha text, p_nome text default null, p_admin boolean default false)
returns void
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem cadastrar usuários.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;
  select id into v_id from auth.users where lower(email) = v_email limit 1;
  if v_id is null then
    if coalesce(length(p_senha), 0) < 6 then
      raise exception 'A senha precisa ter pelo menos 6 caracteres.';
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
            extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text,
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  elsif coalesce(length(p_senha), 0) > 0 then
    if length(p_senha) < 6 then
      raise exception 'A senha precisa ter pelo menos 6 caracteres.';
    end if;
    update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now() where id = v_id;
  end if;
  insert into public.cotacao_usuarios (email, nome, admin) values (v_email, nullif(trim(p_nome), ''), coalesce(p_admin, false))
  on conflict (email) do update set nome = coalesce(excluded.nome, public.cotacao_usuarios.nome), admin = excluded.admin;
end;
$$;

-- Troca a senha de outro usuário (esqueceu a senha). Só administradores.
create or replace function public.cotacao_definir_senha(p_email text, p_senha text)
returns void
language plpgsql security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem trocar a senha de outra pessoa.' using errcode = '42501';
  end if;
  if coalesce(length(p_senha), 0) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now()
  where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;

-- Tira o acesso (a conta continua existindo, mas não lê nem grava nada). Só administradores.
create or replace function public.cotacao_remover_usuario(p_email text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.cotacao_sou_admin() then
    raise exception 'Só administradores podem tirar o acesso.' using errcode = '42501';
  end if;
  if lower(trim(p_email)) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Você não pode tirar o seu próprio acesso.';
  end if;
  delete from public.cotacao_usuarios where email = lower(trim(p_email));
end;
$$;

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

revoke all on function public.cotacao_sou_admin(), public.cotacao_listar_usuarios(),
  public.cotacao_adicionar_usuario(text, text, text, boolean), public.cotacao_definir_senha(text, text),
  public.cotacao_remover_usuario(text), public.cotacao_definir_admin(text, boolean) from public, anon;
grant execute on function public.cotacao_sou_admin(), public.cotacao_listar_usuarios(),
  public.cotacao_adicionar_usuario(text, text, text, boolean), public.cotacao_definir_senha(text, text),
  public.cotacao_remover_usuario(text), public.cotacao_definir_admin(text, boolean) to authenticated;

-- Tempo real: cada computador fica sabendo na hora quando outro salva alguma coisa
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cotacao_documentos') then
    alter publication supabase_realtime add table public.cotacao_documentos;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- O PRIMEIRO ADMINISTRADOR (troque pelo seu e-mail, se for rodar em outro projeto)
-- ---------------------------------------------------------------------
update public.cotacao_usuarios set admin = true where email = lower('wesleyyysv2.0@gmail.com');
