-- ============================================================================
-- Leads (admin → 🎯 Leads) — seguimiento de `pending_subscriptions` — 2026-10-15
-- Correr en el SQL Editor de Supabase. Idempotente.
-- ----------------------------------------------------------------------------
--  · contacted_at: cuándo el admin marcó "Contactado" (null = sin contactar).
--  · contact_note: nota libre del admin sobre el contacto.
--  · RLS: SELECT y UPDATE solo admin (`get_my_role() = 'admin'`, mismo criterio que
--    payments / site_config / profiles). La policy de INSERT anónimo
--    ("Público crea pending") NO se toca: la landing sigue insertando igual.
--  · process-payment usa service_role (bypassa RLS) → sigue leyendo/borrando igual.
-- ============================================================================

alter table public.pending_subscriptions
  add column if not exists contacted_at timestamptz default null,
  add column if not exists contact_note text;

-- (ya está activado; se repite por si acaso, no cambia nada)
alter table public.pending_subscriptions enable row level security;

-- SELECT solo admin (recrea la policy existente con el mismo nombre y criterio)
drop policy if exists "Admin ve pending" on public.pending_subscriptions;
create policy "Admin ve pending" on public.pending_subscriptions
  for select
  using (public.get_my_role() = 'admin');

-- UPDATE solo admin (para contacted_at / contact_note)
drop policy if exists "Admin actualiza pending" on public.pending_subscriptions;
create policy "Admin actualiza pending" on public.pending_subscriptions
  for update
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- ----------------------------------------------------------------------------
-- Verificación (opcional): listar las policies de la tabla. Debería haber solo:
--   "Público crea pending" (INSERT) · "Admin ve pending" (SELECT) · "Admin actualiza pending" (UPDATE)
-- Si aparece otra de SELECT/UPDATE con `true` o para anon/authenticated, avisar antes de seguir.
-- ----------------------------------------------------------------------------
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'pending_subscriptions';
