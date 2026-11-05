# Etapa 6: SQL y deploy (primer cobro, cancelación, contador y mail del día 6)

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo claves ni datos reales: el repo es público.** El secreto del cron se genera en la terminal y se pega solo en el panel y en el editor de Supabase.

Orden: portal → `trial-reminders` + SQL → `cancel-subscription` → **`process-payment` al final**. Cada parte se puede hacer un día distinto. La prueba real va con la etapa 8.

## Parte A: controles previos

### 1. Terminal: simulaciones

Corré cada línea en la terminal de VS Code, desde la raíz del proyecto.

```bash
node supabase/tests/process-payment-etapa6.sim.mjs
```

```bash
node supabase/tests/cancel-subscription-etapa6.sim.mjs
```

```bash
node supabase/tests/trial-reminders.sim.mjs
```

```bash
node supabase/tests/process-payment.sim.mjs
```

```bash
node supabase/tests/process-payment-pagos.sim.mjs
```

**Tiene que dar**, en la última línea de cada una: `TODO OK` (con `402 de 402 escenarios idénticos a 76c477a` y `21 de 21` más arriba), `10 de 10`, `20 de 20`, `52 de 52` y `21 de 21`.

### 2. SQL: nadie está en prueba

```sql
select
  (select count(*) from public.profiles where trial_status is not null) as perfiles_con_prueba,
  (select count(*) from public.profiles where trial_status = 'in_trial') as en_prueba;
```

**Tiene que dar:** los dos en `0`. Así la parte nueva de `process-payment` no puede tocar a ningún alumno. Si no da 0, frená.

### 3. Pestañas para volver atrás

Abrí estas dos direcciones y dejalas abiertas:

- `process-payment` de hoy: `https://github.com/ekapradacoach/hbperformance/blob/76c477a/supabase/functions/process-payment/index.ts`
- `cancel-subscription` de hoy: `https://github.com/ekapradacoach/hbperformance/blob/4bde149/supabase/functions/cancel-subscription/index.ts`

**Tiene que dar:** en ninguna de las dos aparece la palabra `trial_status` (Ctrl+F: 0 resultados).

## Parte B: portal (contador de días)

### 4. Commit y push (lo hago yo, con tu OK)

Publica `app/dashboard.html` con el contador. Solo se ve si el perfil tiene `trial_status = in_trial`: hoy nadie.

**Tiene que dar:** entrá al portal con una cuenta de alumno de prueba (o pedile a un alumno que entre): se ve igual que antes, sin ningún aviso nuevo.

## Parte C: mail del día 6

### 5. Terminal: generar el secreto del cron

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiá el valor. Lo vas a pegar en dos lugares (pasos 6 y 9) y en ningún archivo.

### 6. Panel: guardar el secreto

En **Edge Functions → Secrets**, agregá `CRON_SECRET` con ese valor.

### 7. Panel: crear trial-reminders

1. En **Edge Functions**, creá una función nueva con el nombre exacto `trial-reminders`.
2. Pegá completo `supabase/functions/trial-reminders/index.ts`. La línea 2 tiene que decir `Edge Function: trial-reminders`.
3. Deploy, y dejá **Verify JWT en OFF**.

### 8. Consola: sin el secreto no responde

Abrí `https://hbperformance.fit/crossfit.html`, F12 → **Console** (si no te deja pegar, escribí `allow pasting`).

```js
var r = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-reminders', { method: 'POST', body: '{}' }); console.log(r.status, await r.text());
```

**Tiene que dar:** `401 {"ok":false,"error":"No autorizado"}`.

### 9. SQL: el secreto en Vault

En el editor, reemplazá `EL_VALOR` por el secreto del paso 5 **solo en el editor**, corré y no guardes la consulta:

```sql
select vault.create_secret('EL_VALOR', 'trial_reminders_cron');
```

**Tiene que dar:** una fila con un id.

### 10. SQL: la migración

Abrí `supabase/migrations/20261105_trial_aviso.sql`, copiá el archivo completo, pegalo y tocá Run.

**Tiene que dar:** sin errores. Si dice que `pg_cron` no existe o no tenés permiso, andá a **Database → Extensions**, activá `pg_cron` y volvé a correrlo.

### 11. SQL: verificar

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'trial_reminder_sent_at') as columna,
  (select count(*) from cron.job where jobname = 'hb-trial-reminders' and schedule = '0 13 * * *') as job,
  (select count(*) from vault.decrypted_secrets where name = 'trial_reminders_cron') as secreto;
```

**Tiene que dar:** `columna = 1`, `job = 1`, `secreto = 1`.

### 12. SQL: probar el cron a mano

Hace la misma llamada que el job, ahora:

```sql
select net.http_post(
  url := 'https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-reminders',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trial_reminders_cron')),
  body := '{}'::jsonb);
```

Esperá 10 segundos y corré:

```sql
select status_code, content from net._http_response order by created desc limit 1;
```

**Tiene que dar:** `200` y `{"ok":true,"sent":0,"failed":0,"skipped":0}` (hoy no hay nadie en prueba). Si da 401, el secreto de Vault y el de Edge Functions no son iguales: repetí los pasos 6 y 9 con el mismo valor.

## Parte D: cancel-subscription

### 13. Panel: deployar

1. Abrí `cancel-subscription` en **Edge Functions** y pegá completo `supabase/functions/cancel-subscription/index.ts`. Buscá `inTrial`: tiene que aparecer.
2. Deploy. **Verify JWT tiene que seguir en ON** (esta función sí la llama un alumno con sesión). Si estaba en OFF, frená y avisame.

### 14. Consola: responde

```js
var r = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/cancel-subscription', { method: 'POST' }); console.log(r.status);
```

**Tiene que dar:** `401` (sin sesión no deja cancelar).

## Parte E: process-payment (al final)

### 15. SQL: repetir el paso 2 y detectar cruces

Repetí el paso 2 (los dos en 0) y corré `supabase/checks/detectar_cruces.sql`.

**Tiene que dar:** paso 2 en 0 y cruces sin filas.

### 16. Panel: deployar

1. Abrí `process-payment` y pegá completo `supabase/functions/process-payment/index.ts`. Buscá `handleTrialCharge`: tiene que aparecer.
2. Deploy. **Verify JWT tiene que seguir en OFF.** Si estaba en ON, frená y avisame.

### 17. Consola: el webhook responde

```js
var w = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/process-payment', { method: 'POST', body: '{}' }); console.log(w.status, await w.text());
```

**Tiene que dar:** `200 {"ok":true,"skipped":"no-resource-id"}`.

### 18. Control de alumnos actuales

En el próximo cobro normal de un alumno, mirá **process-payment → Logs**.

**Tiene que dar:** `Renovación (cobro recurrente OK)`, sin ningún `PRUEBA` en ese aviso. Si ves `REVISAR PRUEBA: no se pudo leer el perfil de prueba`, avisame (el alumno igual siguió por el camino de siempre).

## Si algo sale mal

- **`process-payment`:** pegá la versión de la pestaña `76c477a` y deployá. Hacelo primero: es lo que usan tus alumnos.
- **`cancel-subscription`:** pegá la versión de la pestaña `4bde149` y deployá.
- **Mail del día 6:** corré `supabase/migrations/20261105_trial_aviso_ROLLBACK.sql` (saca el job) y borrá `trial-reminders`. La columna puede quedar.
- **Portal:** decime y revierto el commit.

## Qué no cubre

Queda para la etapa 8 (prueba real de 1 día): el primer cobro aprobado o rechazado en real, la cancelación por MP y por el perfil durante la prueba, el contador con una prueba real y el mail del día 6 llegando a una casilla.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. No pases el secreto del cron, ids ni mails.
