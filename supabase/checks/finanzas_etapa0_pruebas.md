# Finanzas, etapa 0: datos confiables

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo nombres, mails ni ids de alumnos: el repo es público.** Todas las consultas de acá devuelven solo cantidades o nombres de columnas.

Qué cambia:
- **0a.** `process-payment`: cuando alguien cancela desde MP, además de `cancelled` carga la fecha de fin de acceso, sin pisar una fecha que ya exista.
- **0b.** Tabla nueva `subscription_events` (altas, bajas, vueltas y pruebas), llenada por un trigger en `profiles` y reconstruida desde los pagos. "Evolución de alumnos" la usa.
- **0c.** Función `admin_ranking_actividad`: el ranking "Alumnos más activos" se cuenta en la base, sin el tope de 1000 filas.
- **0d.** Los pagos se conservan al eliminar un alumno; en 💰 Pagos figuran como "Alumno eliminado".

- **0e.** "Dar de baja" en el admin: con alumnos de MP puede cancelar también la suscripción en MP (función nueva `admin-cancel-subscription`). Pasos en la Parte F.

**No se tocan** la semana de prueba, el portal, las landings ni `cancel-subscription`.

## Parte A: controles previos

### 1. Terminal: simulaciones

Corré cada una desde la raíz del proyecto:

```bash
node supabase/tests/process-payment-bajas.sim.mjs
```

```bash
node supabase/tests/process-payment.sim.mjs
```

```bash
node supabase/tests/process-payment-pagos.sim.mjs
```

```bash
node supabase/tests/process-payment-etapa6.sim.mjs
```

**Tiene que dar**, en la última línea: `16 de 16`, `52 de 52`, `23 de 23` y `TODO OK`. En la etapa 6, la línea "Diferencial" dice `363 de 402 escenarios idénticos …, 39 con el cambio buscado de la etapa 0a de finanzas, 0 con diferencias no buscadas`.

### 2. SQL: columnas que usan el trigger y el ranking

```sql
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'profiles' and column_name in ('role', 'program', 'subscription_status', 'subscription_start', 'subscription_end', 'payment_grace_until', 'trial_status', 'trial_started_at', 'trial_resolved_at', 'created_at'))
    or (table_name = 'block_completions' and column_name in ('athlete_id', 'completed_at'))
    or (table_name = 'payments' and column_name in ('athlete_id', 'paid_at')))
order by table_name, column_name;
```

**Tiene que dar:** 14 filas. `completed_at`, `created_at`, `trial_started_at`, `trial_resolved_at` y `payment_grace_until` con `timestamp with time zone`; `paid_at`, `subscription_start` y `subscription_end` con `date`. Si falta una fila o el tipo es otro, frená.

### 3. SQL: foto de antes (para comparar)

```sql
select
  (select count(*) from profiles where role = 'athlete' and subscription_status = 'cancelled' and subscription_end is null) as cancelados_sin_fecha,
  (select count(*) from payments) as pagos,
  (select count(*) from block_completions) as completados;
```

**Anotá los tres números** (completados debería ser 3064 o más).

## Parte B: SQL nuevo

### 4. Pagos que se conservan

Pegá y corré `supabase/migrations/20261115_pagos_conservar.sql` completo. Después:

```sql
select rc.delete_rule,
       (select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'payments' and column_name = 'athlete_id') as admite_vacio,
       (select count(*) from payments) as pagos
from information_schema.referential_constraints rc
where rc.constraint_name = 'payments_athlete_id_fkey';
```

**Tiene que dar:** `SET NULL`, `YES` y la misma cantidad de pagos del paso 3.

### 5. Ranking

Pegá y corré `supabase/migrations/20261115_ranking_actividad.sql` completo. Después:

```sql
select sum(total) as total_ranking, (select count(*) from block_completions) as total_tabla
from admin_ranking_actividad('2026-11-01', '2026-12-01');
```

**Tiene que dar:** los dos números iguales (salvo completados sin alumno, que no cuentan).

### 6. Historial de altas y bajas

Pegá y corré `supabase/migrations/20261115_finanzas_eventos.sql` completo. Después, cada consulta por separado:

```sql
select kind, source, count(*) from subscription_events group by 1, 2 order by 1, 2;
```

```sql
select count(*) as bajas_sin_fecha from subscription_events where kind = 'baja' and access_until is null and not voided;
```

```sql
select tgname from pg_trigger where tgname = 'profiles_subscription_events';
```

```sql
select count(*) as politicas from pg_policies where tablename = 'subscription_events';
```

**Tiene que dar:** filas de `alta`, `baja`, `prueba_*` y quizás `reactivacion`, todas con `reconstruccion`. `bajas_sin_fecha` igual a `cancelados_sin_fecha` del paso 3. El trigger aparece (1 fila). `politicas = 1`.

Volvé a correr el archivo completo y repetí la primera consulta: **las cantidades no cambian** (no duplica).

## Parte C: deploy de `process-payment`

### 7. Pestaña para volver atrás

Abrí y dejá abierta la versión deployada hoy:

`https://github.com/ekapradacoach/hbperformance/blob/c4ae58a/supabase/functions/process-payment/index.ts`

### 8. Deploy

Deployá `process-payment` desde el panel de Supabase con el código local de `supabase/functions/process-payment/index.ts`. **Verify JWT sigue en OFF.**

**Tiene que dar:** en el código deployado aparecen `cancelledAccessEnd` y `REVISAR BAJA`.

## Parte D: admin

### 9. Commit y push

**Antes, hacé los pasos 13 y 14 de la Parte F** (simulación y deploy de `admin-cancel-subscription`): el admin nuevo ya la usa.

Avisame y hago el commit y el push de `admin/index.html`, las migraciones, las funciones, las simulaciones y la documentación. GitHub Pages tarda unos minutos en publicar.

### 10. Métricas

En el admin → 📈 Métricas, mes actual:
- **Evolución de alumnos:** 6 meses con Altas (y entre paréntesis nuevas · vuelven · pruebas), Bajas, Neto y Activos al cierre. Ya no aparece `N/D`.
- **Alumnos más activos:** con "Mes seleccionado" aparecen completados del mes. Con "Histórico (todo)", la suma de la columna (con "Ver ranking completo") se acerca a `completados` del paso 3.
- **Nada en rojo** ni el mensaje "¿falta correr …?".

### 11. 💰 Pagos

Los pagos del mes se ven igual que antes. **No elimines a nadie para probar**: "Alumno eliminado" aparece recién cuando se elimine a alguien con pagos.

## Parte E: con la próxima baja real desde MP

Cuando alguien cancele desde MP (no hace falta provocarlo), dentro de las 24 horas:

```sql
select received_at, result, reason, http_status from mp_webhook_log
where event_type = 'subscription_preapproval' order by received_at desc limit 5;
```

En los logs de `process-payment` tiene que aparecer `Baja desde MP: acceso hasta … | fuente: …`. Y:

```sql
select count(*) as cancelados_sin_fecha from profiles
where role = 'athlete' and subscription_status = 'cancelled' and subscription_end is null;
```

**Tiene que dar:** no sube. Si aparece `REVISAR BAJA` en los logs, pasame la línea (no tiene mails).

## Parte F: "Dar de baja" que también cancela en MP

Qué cambia: el `prompt` de "Dar de baja" pasa a un modal con la fecha de fin de acceso. Si el alumno tiene suscripción de MP y no está en la semana de prueba, aparece la casilla **"Cancelar también la suscripción en Mercado Pago (deja de cobrarle)"**, tildada. Con la casilla, pide una segunda confirmación y llama a `admin-cancel-subscription`: cancela en MP y **recién después** guarda la baja. Si MP falla, no cambia nada. Sin la casilla, o con alumnos manuales, hace lo mismo que antes. Con una prueba en curso no aparece la casilla: se resuelve desde 🧪 Pruebas.

### 12. Secretos

No hay que cargar nada: usa `MP_ACCESS_TOKEN`, `SUPABASE_URL` y `SERVICE_ROLE_KEY`, que ya existen.

### 13. Terminal: simulación

```bash
node supabase/tests/admin-cancel-subscription.sim.mjs
```

**Tiene que dar:** `25 de 25 casos OK`.

### 14. Deploy

Creá la función `admin-cancel-subscription` desde el panel de Supabase con el código de `supabase/functions/admin-cancel-subscription/index.ts`. **Verify JWT en ON.**

Desde la consola del navegador con el admin abierto (F12 → Console), una llamada sin alumno, que no cambia nada:

```js
const { data: { session } } = await sb.auth.getSession();
await (await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/admin-cancel-subscription', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: '{}' })).json();
```

**Tiene que dar:** `{ ok: false, error: 'Falta el alumno.' }`. Y sin sesión (pestaña privada, o la misma llamada sin `Authorization`): 401.

### 15. Después del commit (paso 9): el modal

En 👥 Alumno → ⋮ → **Dar de baja**, y tocá **Cancelar** sin dar de baja a nadie:
- **alumno de MP:** fecha de hoy, la casilla tildada y el aviso en rojo;
- **alumno manual:** sin casilla;
- **alumno en prueba** (si hay): sin casilla, con el aviso de 🧪 Pruebas.

### 16. Con la próxima baja real de un alumno de MP

Cuando un alumno de MP pida la baja, hacela desde el admin con la casilla tildada. **Tiene que dar:** el aviso "Alumno dado de baja y suscripción cancelada en Mercado Pago"; en el panel de MP (cuenta de trabajo) la suscripción figura cancelada; en Alumnos queda Cancelado con la fecha elegida. Unos minutos después llega el aviso de cancelación de MP: **la fecha no cambia** (mirala de nuevo en el panel del alumno). Normalmente en los logs de `process-payment` no aparece `Baja desde MP` para esa baja; si el aviso llegó en el mismo segundo, puede aparecer, pero la fecha que queda es igual la elegida en el admin. Si aparece `REVISAR BAJA` en los logs de `admin-cancel-subscription`, pasame la línea.

## Volver atrás

- **"Dar de baja" con MP:** revertir el commit del admin (vuelve el `prompt`) y borrar la función `admin-cancel-subscription` en el panel de Supabase.
- **`process-payment`:** deployar la versión de la pestaña del paso 7.
- **Admin:** revertir el commit. Hacerlo **antes** de los rollbacks de SQL (si no, Métricas muestra "¿falta correr …?").
- **Historial:** `supabase/migrations/20261115_finanzas_eventos_ROLLBACK.sql` (se pierden los eventos anotados desde el paso 6).
- **Ranking:** `supabase/migrations/20261115_ranking_actividad_ROLLBACK.sql`.
- **Pagos:** `supabase/migrations/20261115_pagos_conservar_ROLLBACK.sql` (vuelven a borrarse al eliminar; los que ya quedaron sin alumno se conservan).
