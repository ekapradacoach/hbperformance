-- ============================================================================
-- profiles: un alumno solo puede cambiar las columnas de la lista blanca — 2026-11-02
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- Rollback: 20261102_profiles_lista_blanca_ROLLBACK_apagar.sql (saca solo el trigger y su función).
-- ----------------------------------------------------------------------------
-- Problema: authenticated tiene UPDATE sobre toda la tabla y la policy "Usuario actualiza su propio perfil" solo
-- exige auth.uid() = id. Un alumno podía cambiarse role, subscription_end, subscription_status, access_from, etc.
--
-- Lista blanca = lo que hoy escribe app/dashboard.html: full_name, phone, avatar_url, hybrid_variant,
-- shortcut_guide_seen. Cualquier otra columna, también una que se agregue después, queda protegida.
-- Si una pantalla nueva del alumno necesita escribir otra columna, hay que sumarla acá.
--
--  · Admin (get_my_role() = 'admin'): sin límite. Lee el rol ANTES del cambio, así que nadie se habilita a sí mismo.
--  · service_role (Edge Functions) y postgres (SQL Editor): sin límite, no son anon ni authenticated.
--  · No cambia ningún dato existente ni toca policies.
-- ============================================================================

begin;

create or replace function public.proteger_perfil_lista_blanca()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  columna text;
begin
  if current_user in ('anon', 'authenticated')
     and public.get_my_role() is distinct from 'admin' then
    select e.key into columna
    from jsonb_each(to_jsonb(new)) e
    where e.key <> all (array['full_name', 'phone', 'avatar_url', 'hybrid_variant', 'shortcut_guide_seen'])
      and e.value is distinct from to_jsonb(old) -> e.key
    limit 1;

    if columna is not null then
      raise exception 'No tenés permiso para modificar %', columna using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_perfil_lista_blanca on public.profiles;
create trigger proteger_perfil_lista_blanca
  before update on public.profiles
  for each row execute function public.proteger_perfil_lista_blanca();

commit;
