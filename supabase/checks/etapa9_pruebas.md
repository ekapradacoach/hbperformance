# Etapa 9: planes de prueba de Hybrid y Fuerza para Corredores

Hacé los pasos en orden. Si un resultado no coincide, frená y pasame lo que salió.

**No guardes en este archivo tus alias, ids de planes, ids ni claves: el repo es público.** En los SQL, reemplazá `ID_DEL_PLAN` y `TU_ALIAS` solo en el editor de Supabase.

Qué cambia: el script del plan pide el programa, `start-trial` acepta los tres programas y `prueba.html` muestra Hybrid ($45.000, con la línea de los 3 o 4 días) y Corredores ($40.000). **No se tocan** `process-payment`, `confirm-trial`, `cancel-subscription` ni las landings. **No se cobra nada**: se abre el checkout de cada plan sin suscribirse.

## Parte A: controles previos

### 1. Terminal: simulaciones

Corré cada una desde la raíz del proyecto:

```bash
node supabase/tests/mp-plan-prueba.sim.mjs
```

```bash
node supabase/tests/start-trial.sim.mjs
```

```bash
node supabase/tests/confirm-trial.sim.mjs
```

```bash
node supabase/tests/trial-admin.sim.mjs
```

```bash
node supabase/tests/trial-reminders.sim.mjs
```

```bash
node supabase/tests/process-payment-etapa6.sim.mjs
```

**Tiene que dar**, en la última línea: `11 de 11`, `49 de 49`, `103 de 103`, `42 de 42`, `20 de 20` y `TODO OK`.

### 2. SQL: precios y planes pagos

```sql
select key, value from public.site_config
where key in ('price_hybrid_ars', 'price_corredores_ars', 'mp_plan_hybrid', 'mp_plan_corredores', 'mp_trial_plan_hybrid', 'mp_trial_plan_corredores')
order by key;
```

**Tiene que dar:** `price_hybrid_ars = 45000`, `price_corredores_ars = 40000`, los dos `mp_plan_*` con valor, y **ninguna** fila `mp_trial_plan_*` todavía. Si los precios no son esos, frená: el script compara contra el plan pago y no crea nada si no coinciden.

### 3. Pestaña para volver atrás

Abrí y dejá abierta la versión de `start-trial` deployada hoy (solo CrossFit):

`https://github.com/ekapradacoach/hbperformance/blob/f98cc11/supabase/functions/start-trial/index.ts`

**Tiene que dar:** la línea `const TRIAL_PROGRAMS = ['crossfit']`.

## Parte B: los dos planes

### 4. Terminal: crear el plan de Hybrid

```bash
node supabase/tests/mp-plan-prueba.mjs
```

1. Pegá el Access Token de producción de la cuenta de trabajo (no se ve) y escribí `SI`.
2. Programa: `hybrid`.
3. Opción `1`. Revisá lo que muestra: `Plan pago de Hybrid: $45000 ARS, cada 1 months` y `Precio en site_config: $45000`.
4. Escribí `CREAR`.

**Tiene que dar:** `Plan creado: …` y la verificación con 6 líneas en OK y `REVISAR Plan en site_config: todavía no cargado` (es lo esperado: se carga en el paso 5). Copiá el id del plan. Salí con `0`.

### 5. SQL: cargar el plan de Hybrid

Reemplazá `ID_DEL_PLAN` en el editor:

```sql
insert into public.site_config (key, value) values ('mp_trial_plan_hybrid', 'ID_DEL_PLAN')
on conflict (key) do update set value = excluded.value;
```

### 6. Terminal: verificar Hybrid

Corré el script otra vez, `SI`, programa `hybrid`, opción `2`.

**Tiene que dar:** las 7 líneas en OK, con `Nombre: HB Performance - Hybrid - 7 días gratis` y `Prueba de 7 días`.

### 7. Corredores: repetir los pasos 4 a 6

Con programa `corredores` y la clave `mp_trial_plan_corredores`.

**Tiene que dar:** al crear, `Plan pago de Fuerza para Corredores: $40000` y `Precio en site_config: $40000`; al verificar, las 7 líneas en OK con `HB Performance - Fuerza para Corredores - 7 días gratis`.

Hasta el paso 9 nadie puede usar estos planes: `start-trial` todavía no acepta esos programas.

## Parte C: deploy y publicación

### 8. Panel: deployar start-trial

1. Abrí `start-trial` en **Edge Functions** y pegá completo `supabase/functions/start-trial/index.ts`. Buscá `'hybrid', 'corredores'`: tiene que aparecer.
2. Deploy. **Verify JWT tiene que seguir en OFF.**

### 9. Consola: responde

Abrí `https://hbperformance.fit/crossfit.html` (sin `www`), F12 → **Console** (si no te deja pegar, escribí `allow pasting`).

```js
var ST = 'https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/start-trial';
var r = await fetch(ST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); console.log(r.status, await r.text());
```

**Tiene que dar:** `200 {"ok":false,"error":"No pudimos iniciar tu prueba, escribinos"}`.

### 10. Commit y push (lo hago yo, con tu OK)

Publica `prueba.html` con los tres programas. Esperá unos minutos y recargá con **Ctrl+F5**.

## Parte D: verificar cada programa sin pagar

### 11. Web: las páginas

Abrí cada dirección:

1. `https://hbperformance.fit/prueba.html?programa=hybrid`
2. `https://hbperformance.fit/prueba.html?programa=corredores`
3. `https://hbperformance.fit/prueba.html?programa=crossfit`

**Tiene que dar:**
1. "Probá Hybrid Evolution gratis", **$45.000** en los tres lugares y, en "Qué incluye", la línea "Adentro del portal elegís el plan de 3 o 4 días (más una corrida), y lo podés cambiar cuando quieras."
2. "Probá Fuerza para Corredores gratis", **$40.000** en los tres lugares, sin la línea de Hybrid.
3. CrossFit igual que antes ($45.000, sin la línea de Hybrid).

### 12. Consola: el formulario de cada programa lleva a su plan

En la misma consola del paso 9 (si recargaste, repetí la primera línea del paso 9). Te pide un alias nuevo por programa:

```js
for (var prog of ['hybrid', 'corredores', 'crossfit']) {
  var mail = prompt('Alias nuevo para ' + prog);
  var st = await (await fetch(ST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Prueba Etapa 9', email: mail, phone: '1100000000', program: prog }) })).json();
  console.log(prog, st.ok, st.init_point);
}
```

**Tiene que dar:** las tres con `true` y un `init_point` distinto para cada programa. El de Hybrid termina con el id que cargaste en el paso 5, el de Corredores con el del paso 7 y el de CrossFit con el de siempre.

### 13. Web: abrir los checkouts SIN suscribirte

Copiá cada `init_point` en una pestaña nueva.

**Tiene que dar:** `HB Performance - Hybrid - 7 días gratis` con $45.000 y 7 días gratis; `HB Performance - Fuerza para Corredores - 7 días gratis` con $40.000 y 7 días gratis. **No te suscribas.** Cerrá las pestañas.

### 14. SQL: limpiar

Reemplazá los tres alias en el editor:

```sql
delete from public.pending_subscriptions where is_trial and lower(trim(email)) in (lower(trim('ALIAS_1')), lower(trim('ALIAS_2')), lower(trim('ALIAS_3')));
delete from public.trial_attempts;
select
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.trial_attempts) as intentos;
```

**Tiene que dar:** los dos en `0`.

## Antes del primer link de Hybrid o de Corredores

- [ ] El checklist completo de `supabase/checks/etapa8_lanzamiento.md` (texto legal, botones de la Disposición 954/2025, nadie en prueba, avisos automáticos, funciones iguales al repo).
- [ ] El link: `https://hbperformance.fit/prueba.html?programa=hybrid&utm_source=lanzamiento&utm_medium=whatsapp` (o `programa=corredores`).
- [ ] La primera persona de cada programa, de confianza. Con la primera de **Hybrid**, confirmá que al entrar al portal le aparece la pantalla para elegir 3 o 4 días, que después ve la planificación de ese plan y el aviso de días de prueba.

## Si algo sale mal

- **`start-trial`:** pegá la versión de la pestaña del paso 3 (solo CrossFit) y deployá. Las páginas de Hybrid y Corredores van a dar el error genérico.
- **Un plan quedó mal:** no lo compartas. Borrá su clave con `delete from public.site_config where key = 'mp_trial_plan_hybrid';` (o `_corredores`) y avisame: un plan de MP no se borra, se desactiva desde el panel.

## Qué pasarme

Decime qué pasos dieron lo esperado y copiá lo que salió en los que no. No pases ids de planes, alias ni claves.
