-- ============================================================================
-- ROLLBACK de 20261115_pagos_conservar.sql: vuelve a borrar los pagos al eliminar un alumno (ON DELETE CASCADE).
-- athlete_id queda admitiendo vacío: si ya hay pagos de alumnos eliminados, volver a NOT NULL fallaría.
-- Para volver también a NOT NULL hay que decidir antes qué hacer con esos pagos:
--   select count(*) from payments where athlete_id is null;
-- Se puede correr dos veces.
-- ============================================================================
alter table public.payments drop constraint if exists payments_athlete_id_fkey;
alter table public.payments
  add constraint payments_athlete_id_fkey foreign key (athlete_id) references public.profiles(id) on delete cascade;
