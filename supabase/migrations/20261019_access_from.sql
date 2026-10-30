-- ============================================================================
-- Ventana de acceso hacia atrás (`profiles.access_from`) — 2026-10-19
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- Rollback: 20261019_access_from_ROLLBACK_apagar.sql (por defecto: apaga la restricción, deja la columna)
--           20261019_access_from_ROLLBACK_completo.sql (también borra la columna; leer su advertencia)
-- ----------------------------------------------------------------------------
-- Regla: un atleta con access_from seteado solo ve planning_days con date >= access_from
-- (y los planning_blocks / exercise_links que cuelgan de esos días). Hacia adelante no se limita.
--  · access_from NULL (todos los perfiles existentes, altas manuales, reactivaciones) → ve TODO, como hoy.
--  · role = 'admin' → nunca se restringe (aunque tuviera access_from).
--  · Sin perfil → no se restringe acá (las policies permissive existentes ya no le dan nada).
--
-- Diseño (calcado de "Solo atleta activo puede leer" / is_active_athlete()):
--  · Policies RESTRICTIVE nuevas FOR SELECT TO authenticated → se combinan con AND sobre las
--    existentes. NO se toca ninguna policy actual (ni las hybrid-aware ni las de admin).
--  · Las funciones NO miran program / program_slug → no hay lógica de Hybrid acá que pueda romperse.
--  · Las funciones devuelven "NOT EXISTS (restricción que aplica)": solo pueden dar false para un
--    atleta con access_from NO nulo. Para cualquier otro caso dan true.
--  · SECURITY DEFINER + search_path fijo → leen profiles / planning_days sin depender de su RLS
--    (sin recursión) y solo devuelven un boolean.
--  · Tablas sin fecha propia: planning_blocks (day_id → planning_days.date) y
--    exercise_links (block_id → planning_blocks.day_id → planning_days.date).
--  · block_rm_exercises ya no existe (dropeada 2026-07-28): los RM viven en planning_blocks.content.
--  · block_completions / block_images: son datos PROPIOS del atleta (athlete_id = auth.uid()); un alumno
--    nuevo no tiene filas de días anteriores → no se gatean.
--  · El service_role (Edge Functions) bypassa RLS → no lo afecta.
-- ============================================================================

begin;

-- 1) Columna (nullable, SIN default → no cambia nada para ningún perfil existente)
alter table public.profiles
  add column if not exists access_from date;

-- 2) Helpers
-- ¿El usuario actual puede ver una fecha de planificación?
create or replace function public.athlete_can_see_date(d date)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role is distinct from 'admin'
      and p.access_from is not null
      and (d is null or d < p.access_from)
  );
$$;

-- ¿El usuario actual puede ver un planning_day (por id)? (para planning_blocks.day_id)
create or replace function public.athlete_can_see_day(p_day_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role is distinct from 'admin'
      and p.access_from is not null
      and not exists (
        select 1 from public.planning_days pd
        where pd.id = p_day_id
          and pd.date >= p.access_from
      )
  );
$$;

-- ¿El usuario actual puede ver un planning_block (por id)? (para exercise_links.block_id)
create or replace function public.athlete_can_see_block(p_block_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role is distinct from 'admin'
      and p.access_from is not null
      and not exists (
        select 1 from public.planning_blocks pb
        join public.planning_days pd on pd.id = pb.day_id
        where pb.id = p_block_id
          and pd.date >= p.access_from
      )
  );
$$;

grant execute on function public.athlete_can_see_date(date)  to authenticated;
grant execute on function public.athlete_can_see_day(uuid)   to authenticated;
grant execute on function public.athlete_can_see_block(uuid) to authenticated;

-- 3) Policies RESTRICTIVE nuevas (solo SELECT; no reemplazan a ninguna existente)
drop policy if exists "Ventana de acceso (access_from)" on public.planning_days;
create policy "Ventana de acceso (access_from)" on public.planning_days
  as restrictive for select to authenticated
  using (public.athlete_can_see_date(date));

drop policy if exists "Ventana de acceso (access_from)" on public.planning_blocks;
create policy "Ventana de acceso (access_from)" on public.planning_blocks
  as restrictive for select to authenticated
  using (public.athlete_can_see_day(day_id));

drop policy if exists "Ventana de acceso (access_from)" on public.exercise_links;
create policy "Ventana de acceso (access_from)" on public.exercise_links
  as restrictive for select to authenticated
  using (public.athlete_can_see_block(block_id));

-- ----------------------------------------------------------------------------
-- Verificación (solo lectura, correr después):
-- a) Nadie quedó restringido todavía (debería dar 0 hasta la primera alta nueva por MP):
--    select count(*) from public.profiles where access_from is not null;
-- b) Las 3 policies nuevas existen y las anteriores siguen intactas:
--    select tablename, policyname, permissive, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('planning_days','planning_blocks','exercise_links')
--    order by tablename, policyname;
-- ----------------------------------------------------------------------------

commit;
