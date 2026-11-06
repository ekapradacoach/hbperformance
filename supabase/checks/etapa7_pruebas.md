# Etapa 7: SQL y deploy (admin → Pruebas y aviso diario)

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo mails, claves ni datos reales: el repo es público.**

Esta etapa **no toca** `process-payment`, `confirm-trial` ni `cancel-subscription`. Lo nuevo: la vista 🧪 Pruebas del admin, dos funciones (`trial-admin` y `trial-alerts`), un SQL de permisos y un job diario. La prueba real va con la etapa 8.

## Parte A: controles previos

### 1. Terminal: simulaciones

```bash
node supabase/tests/trial-admin.sim.mjs
```

```bash
node supabase/tests/trial-alerts.sim.mjs
```

**Tiene que dar**, en la última línea: `40 de 40` y `15 de 15`.

### 2. SQL: el secreto del cron sigue en Vault

```sql
select count(*) as secreto from vault.decrypted_secrets where name = 'trial_reminders_cron';
```

**Tiene que dar:** `secreto = 1` (es el de la etapa 6; el aviso diario usa el mismo).

## Parte B: funciones

### 3. Panel: el mail del aviso

En **Edge Functions → Secrets**, agregá `ALERT_EMAIL` con el mail donde querés recibir el aviso diario. No se guarda en ningún archivo ni en `site_config`.

### 4. Panel: crear trial-alerts

1. En **Edge Functions**, creá una función nueva con el nombre exacto `trial-alerts`.
2. Pegá completo `supabase/functions/trial-alerts/index.ts`. La línea 2 tiene que decir `Edge Function: trial-alerts`.
3. Deploy, y dejá **Verify JWT en OFF**.

### 5. Panel: crear trial-admin

1. Creá una función nueva con el nombre exacto `trial-admin`.
2. Pegá completo `supabase/functions/trial-admin/index.ts`. La línea 2 tiene que decir `Edge Function: trial-admin`.
3. Deploy, y dejá **Verify JWT en ON** (la llama el admin con su sesión).

### 6. Consola: las dos responden sin dejar pasar

Abrí `https://hbperformance.fit/crossfit.html`, F12 → **Console** (si no te deja pegar, escribí `allow pasting`).

```js
var a = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-alerts', { method: 'POST', body: '{}' }); console.log('alerts', a.status);
var b = await fetch('https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-admin', { method: 'POST', body: '{}' }); console.log('admin', b.status);
```

**Tiene que dar:** `alerts 401` y `admin 401`.

## Parte C: SQL

### 7. SQL: la migración

Abrí `supabase/migrations/20261106_trial_admin.sql`, copiá el archivo completo, pegalo y tocá Run.

**Tiene que dar:** sin errores.

### 8. SQL: verificar

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'trial_reviews' and column_name in ('review_note', 'resolved_by')) as columnas,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trial_reviews' and policyname = 'Admin lee casos de prueba') as policy,
  has_table_privilege('anon', 'public.trial_reviews', 'select') as anon_lee,
  (select count(*) from cron.job where jobname = 'hb-trial-alerts' and schedule = '0 12 * * *') as job_alertas,
  (select count(*) from cron.job where jobname = 'hb-trial-reminders') as job_dia6;
```

**Tiene que dar:** `columnas = 2`, `policy = 1`, `anon_lee = false`, `job_alertas = 1`, `job_dia6 = 1`.

### 9. SQL: probar el aviso a mano

```sql
select net.http_post(
  url := 'https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/trial-alerts',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trial_reminders_cron')),
  body := '{}'::jsonb);
```

Esperá 10 segundos y corré:

```sql
select status_code, content from net._http_response order by created desc limit 1;
```

**Tiene que dar:** `200` con `"sent":false` y los tres contadores en 0 (hoy no hay nada para revisar). **No te llega ningún mail.** Si da 500, revisá que `ALERT_EMAIL` esté cargado (paso 3).

## Parte D: el admin

### 10. Commit y push (lo hago yo, con tu OK)

Publica `admin/index.html` con la vista 🧪 Pruebas y las etiquetas en Alumnos y Leads. Esperá 2 minutos.

### 11. Web: la vista

Entrá al admin y abrí **🧪 Pruebas**.

**Tiene que dar:**
- Sin el aviso amarillo de "falta correr …sql".
- Tarjetas en 0 o "—", "No hay nada para revisar. 🎉" y "Todavía no hay pruebas." (o las de tus pruebas viejas, si quedó alguna).
- Sin número rojo al lado de "Pruebas" en el menú.

### 12. Web: Alumnos y Leads siguen iguales

**Tiene que dar:** en **Alumnos**, las pestañas de siempre más "🧪 En prueba (0)", y la lista igual que antes. En **Leads**, la lista igual que antes (si hay algún formulario de prueba sin pagar, aparece con la etiqueta "🧪 Prueba").

## Si algo sale mal

- **El admin se ve mal:** decime y revierto el commit. No afecta a los alumnos.
- **Las funciones:** borrá `trial-admin` y `trial-alerts` desde el panel.
- **El SQL:** corré `supabase/migrations/20261106_trial_admin_ROLLBACK.sql` (saca la lectura de casos para admin y el job del aviso; las columnas pueden quedar).

## Qué no cubre

Queda para la etapa 8: un caso real para revisar (alias con la misma cuenta de MP), resolverlo desde el admin (alta, cancelar o marcar resuelto) y recibir el aviso diario real.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. No pases mails, ids ni claves.
