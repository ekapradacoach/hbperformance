-- ============================================================================
-- Finanzas, etapa 2: gastos del mes (publicidad y otros) — 2026-11-15
-- Correr A MANO en el SQL Editor de Supabase, en una sola ejecución. Idempotente.
-- Rollback: 20261115_gastos_ROLLBACK.sql
-- ----------------------------------------------------------------------------
-- · Tabla NUEVA expenses: un gasto por fila, por mes (el día 1 del mes), con categoría, concepto y monto en ARS.
-- · Solo admin: ve, carga, edita y borra (get_my_role() = 'admin'). Un alumno o anon no ve nada.
-- · Aditiva: no cambia ninguna tabla ni dato existente. Sin datos personales de alumnos.
-- ============================================================================

begin;

create table if not exists public.expenses (
  id          bigint generated always as identity primary key,
  month       date not null check (extract(day from month) = 1),            -- primer día del mes del gasto
  category    text not null check (category in ('publicidad', 'otro')),
  concept     text not null check (length(btrim(concept)) between 1 and 120),
  amount      numeric(12, 2) not null check (amount > 0),                    -- ARS
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create index if not exists expenses_month_idx on public.expenses (month);

alter table public.expenses enable row level security;

revoke all on public.expenses from anon;
grant select, insert, update, delete on public.expenses to authenticated;

drop policy if exists "Admin gestiona gastos" on public.expenses;
create policy "Admin gestiona gastos" on public.expenses
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

commit;

-- Verificación: tiene que dar tabla = 1, rls = true, policies = 1, gastos = 0 la primera vez.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'expenses') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.expenses'::regclass) as rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'expenses') as policies,
  (select count(*) from public.expenses) as gastos;
