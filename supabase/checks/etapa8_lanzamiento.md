# Etapa 8: lanzamiento controlado de la semana de prueba (CrossFit)

Reemplaza la prueba con cuentas N1 y N2: en vez de cuentas de prueba, **3 a 5 personas reales de confianza** hacen la semana gratis de verdad, con su propia cuenta de Mercado Pago.

**No guardes en este archivo ni en el repo nombres, mails, teléfonos, ids ni claves: el repo es público.** El seguimiento de cada persona llevalo en una nota privada (o mirá 🧪 Pruebas, que ya las lista). En los SQL, reemplazá `MAIL_PERSONA` solo en el editor de Supabase.

## Parte A: checklist antes de mandar el primer link

Todo tiene que dar lo esperado. Si algo no da, no mandes el link.

### A1. Revisión legal hecha y texto cargado

- [ ] Tu contador o abogado revisó el texto del cobro automático y el botón de arrepentimiento (Ley 24.240).
- [ ] Están definidos y cargados los **botones de arrepentimiento y de baja que exige la Disposición 954/2025** (texto, dónde van y qué hacen), según la consulta legal.
- [ ] Me pasaste el texto aprobado. Yo lo cargo en el lugar previsto de `prueba.html` (bloque `LEGAL`, hoy oculto) y, si piden cambios, también en la casilla y en la página de regreso. Lo revisás en local y, con tu OK, hago commit y push.
- [ ] En `https://hbperformance.fit/prueba.html?programa=crossfit` (sin `www`) se ve el texto legal arriba de la casilla del cobro.

### A2. Plan de prueba en 7 días

```bash
node supabase/tests/mp-plan-prueba.mjs
```

Pegá el Access Token de producción (no se ve), elegí la opción **2 (Verificar)**.

- [ ] Las 7 líneas en OK, incluida `Prueba de 7 días`.

### A3. Simulaciones

Corré cada una desde la raíz del proyecto:

```bash
node supabase/tests/confirm-trial.sim.mjs
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

```bash
node supabase/tests/start-trial.sim.mjs
```

```bash
node supabase/tests/cancel-subscription-etapa6.sim.mjs
```

```bash
node supabase/tests/trial-reminders.sim.mjs
```

```bash
node supabase/tests/trial-admin.sim.mjs
```

```bash
node supabase/tests/trial-alerts.sim.mjs
```

- [ ] Últimas líneas: `103 de 103`, `52 de 52`, `21 de 21`, `TODO OK`, `49 de 49`, `10 de 10`, `20 de 20`, `42 de 42`, `15 de 15` (números después de la etapa 9).

### A4. Nadie en prueba y nada pendiente

```sql
select
  (select count(*) from public.profiles where trial_status is not null) as perfiles_con_prueba,
  (select count(*) from public.trial_reviews where resolved_at is null) as casos_abiertos,
  (select count(*) from public.pending_subscriptions where is_trial) as pendings_de_prueba,
  (select count(*) from public.site_config where key = 'price_crossfit_ars' and value = '45000') as precio_ok;
```

- [ ] `perfiles_con_prueba = 0`, `casos_abiertos = 0`, `pendings_de_prueba = 0`, `precio_ok = 1`.

Si queda algo de pruebas viejas, pasámelo antes de borrar.

### A5. Los avisos automáticos funcionan

```sql
select j.jobname, d.status, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname in ('hb-trial-reminders', 'hb-trial-alerts')
order by d.start_time desc
limit 6;
```

- [ ] Hay corridas de los dos jobs en los últimos días, con `status = succeeded`.

Después, corré a mano el aviso diario (es el paso 9 de `etapa7_pruebas.md`) y mirá la respuesta:

- [ ] `200` con `"sent":false` y los contadores en 0.

### A6. Funciones deployadas = las del repo

En **Edge Functions**, abrí cada una y buscá (Ctrl+F) la palabra indicada:

- [ ] `confirm-trial` → `registerPaidCharge`
- [ ] `process-payment` → `handleTrialCharge`
- [ ] `cancel-subscription` → `inTrial`
- [ ] `trial-reminders` → `trial_reminder_sent_at`
- [ ] `trial-admin` → `closeCase`
- [ ] `trial-alerts` → `pagos_despues_del_corte`
- [ ] `start-trial` → `No pudimos iniciar tu prueba`

### A7. Renovaciones de los alumnos

- [ ] Paso 18 de la etapa 6: en una renovación real de un alumno, el log de `process-payment` dijo `Renovación (cobro recurrente OK)`, sin `PRUEBA`.

### A8. El link y lo que le decís a cada persona

Link (cambiá `lanzamiento` si querés distinguir tandas):

`https://hbperformance.fit/prueba.html?programa=crossfit&utm_source=lanzamiento&utm_medium=whatsapp`

Antes de mandarlo, contale a cada persona:

- Son 7 días gratis. Si no cancela, el día 7 Mercado Pago cobra **$45.000** y sigue cada mes.
- Puede cancelar cuando quiera desde **Perfil → Cancelar suscripción** en el portal, o en Mercado Pago → Suscripciones.
- Tiene que usar **su propio mail** (ahí le llega el acceso) y **una cuenta de Mercado Pago que nunca haya usado esta prueba**. Si la cuenta ya la usó, MP cobra la primera cuota en el momento.
- Si al volver de Mercado Pago ve **"Recibimos tu suscripción"**, que te avise: lo resolvés vos desde el admin.

Mandá los links de a uno o dos por día, así cada alta la seguís con calma.

## Parte B: qué mirar con cada persona

### Día 0: el día que se suscribe

**Pedile** que te avise qué vio al volver de Mercado Pago.

| Qué | Dónde | Tiene que dar |
|---|---|---|
| Alta | Lo que vio la persona | "¡Listo, ya arrancaste!" |
| Prueba en curso | Admin → **🧪 Pruebas** → tabla | Su fila con "En prueba · quedan 7 días" (o 6, según la hora) |
| Nada para revisar | Admin → **🧪 Pruebas** → "Para revisar" | Vacío, sin número rojo en el menú |
| Alumno | Admin → **Alumnos** → "🧪 En prueba" | Su fila con "En prueba · termina dd/mm" |
| Invitación | La persona | Le llegó un solo mail para crear la contraseña (puede tardar 5 minutos; spam) |
| Portal | La persona | Entra; en Inicio ve "Te quedan 7 días de prueba (termina el dd/mm)"; en Perfil, "Semana de prueba" y "Fin de la prueba" |

SQL, solo si algo no cierra:

```sql
select trial_status, trial_started_at, trial_ends_at, subscription_status, access_from,
  payer_id is not null as tiene_payer, mp_subscription_id is not null as tiene_suscripcion
from public.profiles where lower(trim(email)) = lower(trim('MAIL_PERSONA'));
```

Tiene que dar: `in_trial`, `trial_ends_at` unos 7 días después, `active`, `access_from` el lunes de esa semana, `true`, `true`.

### Día 6 (o día 7 temprano, si se suscribió de noche): el mail del aviso

El job manda el mail a las 10:00 cuando a la prueba le quedan menos de 36 horas.

| Qué | Dónde | Tiene que dar |
|---|---|---|
| Mail | La persona | "Tu semana gratis está por terminar", con la fecha, $45.000 y cómo cancelar |
| Registro | Admin → **🧪 Pruebas** → columna "Mail día 6" | ✅ con la fecha |
| Portal | La persona | "Te queda 1 día de prueba" u "Hoy es tu último día de prueba" |

### Día 7-8: el resultado

El primer cobro sale a la hora en que termina la prueba (la misma hora del día 0, una semana después). Mirá unas horas después.

**Si siguió (lo normal):**

| Qué | Dónde | Tiene que dar |
|---|---|---|
| Estado | Admin → **🧪 Pruebas** | "Siguió"; tarjetas "Siguieron" y "Conversión" actualizadas |
| Pago | Admin → **💰 Pagos** | $45.000, MP, alta nueva |
| Log | Edge Functions → `process-payment` → Logs | `Prueba convertida: primer cobro aprobado` |
| Portal | La persona | Sin el aviso de prueba; Perfil "Activo · se renueva automáticamente" |

```sql
select p.trial_status, p.trial_resolved_at, p.subscription_status,
  (select string_agg(pay.type || ' ' || pay.amount, ', ') from public.payments pay where pay.athlete_id = p.id) as pagos
from public.profiles p where lower(trim(p.email)) = lower(trim('MAIL_PERSONA'));
```

Tiene que dar: `converted`, una fecha, `active`, `alta_nueva 45000` (uno solo).

**Si canceló durante la prueba:** 🧪 Pruebas "Canceló"; Perfil "Cancelada. Seguís con acceso hasta el dd/mm" (el día de fin); no hay cobro; al día siguiente del fin ve "Tu suscripción venció".

**Si el cobro fue rechazado:** 🧪 Pruebas "Cobro rechazado"; el acceso se cortó en el momento; la suscripción figura cancelada en MP; no le llegó el mail de "cobro fallido". Escribile: si quiere seguir, se suscribe desde `crossfit.html` (la prueba ya la usó).

**Si a las 24 horas del fin sigue "En prueba" sin cobro:** aparece en "Para revisar" y en el aviso diario. Ver la Parte C.

## Parte C: qué hacer si algo sale mal

### Al suscribirse

| Qué pasó | Qué hacer |
|---|---|
| Ve "Recibimos tu suscripción" | 🧪 Pruebas → "Para revisar" → **Revisar**. El cuadro muestra qué dice MP. Si se puede, **Dar el alta** eligiendo su formulario (va como prueba o como alta paga según lo que hizo MP). Si no, escribile y, si no corresponde, **Cancelar en MP**. Cerralo con una nota. |
| "Ese mail ya tiene cuenta" al dar el alta | Es alguien que ya fue alumno: no es un alta de prueba. Cancelá su suscripción de prueba en MP (desde el cuadro) y reactivalo como siempre (Alumnos → Registrar pago con "Reactivar"), si corresponde cobrarle. |
| MP le cobró al suscribirse (su cuenta ya usó la prueba) | Es el caso de la 5b: entra como alumno pago y ve "Ya habías usado tu semana gratis". Si no quería pagar: devolvé el cobro (cuenta de trabajo → Actividad → Devolver dinero), cancelá la suscripción en MP y dalo de baja en Alumnos. |
| No le llegó la invitación | Alumnos → su panel → **Fijar contraseña temporal** (se la pasás por WhatsApp), o **✏️ Editar email** si lo escribió mal. |
| La página da un error rojo con WhatsApp | Escribile; mirá los logs de `start-trial`. No se creó nada, puede reintentar. |

### Durante la semana

| Qué pasó | Qué hacer |
|---|---|
| Quiere cancelar y no puede | Desde tu cuenta de trabajo de MP, cancelá su suscripción. Queda con acceso hasta el fin de la prueba y no se cobra. |
| Pide la baja con devolución (arrepentimiento) | Si ya se cobró: devolvé el cobro, cancelá la suscripción en MP y dalo de baja en Alumnos. |

### En el primer cobro

| Qué pasó | Qué hacer |
|---|---|
| "Para revisar": la prueba terminó y el cobro no llegó | Mirá su suscripción en tu panel de MP. Si MP todavía no cobró, esperá (MP puede tardar o reintentar). Si MP muestra el cobro aprobado y acá no figura, pasame los logs de `process-payment` de ese momento. |
| "Para revisar": pagó después del corte por cobro rechazado | No se reactiva solo. Decidí: o le devolvés el pago, o lo reactivás a mano (Alumnos → Registrar pago con "Reactivar") y le pedís que se suscriba de nuevo desde `crossfit.html`, porque su suscripción quedó cancelada. |
| Un convertido cancela después desde **Mercado Pago** (no desde el perfil) | Queda `cancelled` sin fecha de fin y no se le corta el acceso (pendiente ALTA de la bitácora). Cargale a mano la fecha de fin real desde el admin, como hiciste con los 2 alumnos. |

### Si hay que frenar todo

1. No mandes más links.
2. Si querés que nadie más pueda suscribirse a la prueba: en tu panel de MP, **desactivá el plan de prueba**. Las suscripciones en curso siguen funcionando.
3. Si una función empieza a fallar, volvé a su versión anterior desde GitHub (pegala y deployá):
   - `process-payment` antes de la prueba: `76c477a` (pierde el manejo del primer cobro de las pruebas en curso: avisame antes).
   - `confirm-trial` antes de la 5b: `76c477a`.
   - `cancel-subscription` antes de la etapa 6: `4bde149`.

## Parte D: etapa 9 — Hybrid y Fuerza para Corredores

Para cuando quieras ofrecer la prueba en esos programas. **Hace falta código (chico) y un deploy**, así que va con propuesta y aprobación como las otras etapas:

1. **Script del plan:** `mp-plan-prueba.mjs` hoy crea solo el de CrossFit. Hay que dejarlo elegir el programa y crear `HB Performance - Hybrid - 7 días gratis` ($45.000) y `HB Performance - Fuerza para Corredores - 7 días gratis` ($40.000), con la misma página de regreso, y verificarlos.
2. **site_config:** cargar los ids en `mp_trial_plan_hybrid` y `mp_trial_plan_corredores`.
3. **start-trial:** sumar `hybrid` y `corredores` a su lista de programas (hoy solo `crossfit`) y deployar.
4. **prueba.html:** sumar los dos programas (nombre, página de vuelta y clave de precio). Los links quedan `?programa=hybrid` y `?programa=corredores`.
5. **Ya están listos** (no cambian): `confirm-trial`, `process-payment`, `trial-admin`, `trial-reminders`, el portal y el admin ya reconocen los tres programas y usan el precio de cada uno.
6. **Hybrid:** al entrar al portal por primera vez, la persona elige plan de 3 o 4 días, como cualquier alumno de Hybrid.
7. **Simulaciones:** casos de Hybrid y Corredores (precio de Corredores en el alta paga y en el mail del día 6).
8. **Antes de abrir:** el mismo checklist de la Parte A para cada plan, y una o dos personas de confianza por programa.
9. **Abrir al público** (los tres programas): agregar el botón "Probá 7 días gratis" en `crossfit.html`, `hybrid.html` y `fuerza-corredores.html`, y sacar el `noindex` de las páginas de prueba. Es una decisión aparte, después de ver cómo anduvo el lanzamiento controlado.
