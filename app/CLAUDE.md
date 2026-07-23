# CLAUDE.md — HB Performance App

> Leer este archivo completo antes de tocar cualquier código.
> Para historial detallado ver `CONTEXTO.md`.

## Qué es el proyecto
Portal web para atletas y admins de HB Performance.
Atletas acceden a su planificación diaria, estadísticas y comunidad.
Admins (Erika y Gonza) cargan planificaciones, gestionan alumnos y ven métricas.
Sin framework — HTML estático + CSS embebido + vanilla JS + Supabase.

## Stack
- HTML estático, CSS en `<style>`, JS en `<script>` — sin npm, sin build
- Supabase JS v2 via CDN: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- Cliente global `sb` expuesto por `supabase.js` (incluir SIEMPRE antes de cualquier script)
- No hay backend propio — todo via Supabase PostgREST + Auth + Storage + Edge Functions

## Supabase
| Campo | Valor |
|-------|-------|
| Project URL | `https://frjlafrgdcbomdnentbe.supabase.co` |
| Publishable key | `sb_publishable_fx4VccMrxdC3j8ObKnxX7A_GSNoai80` |

`supabase.js` (en la raíz del proyecto, NO dentro de `app/`) ya está creado y expone el
cliente global `sb`. Cargar SIEMPRE el CDN de Supabase antes que `supabase.js`.

## Estructura de archivos
HB Performance/
├── index.html
├── crossfit.html
├── hybrid.html
├── fuerza-corredores.html
├── asesoria-erika.html
├── asesoria-gonza.html
├── supabase.js
├── app/
│   ├── login.html            ← ✅ creado (login funcional con Supabase Auth)
│   ├── set-password.html     ← ✅ activación de cuenta (invite/recovery → crea contraseña → dashboard)
│   ├── dashboard.html        ← ✅ portal del atleta (SPA: Inicio + placeholders programa/estadísticas/mensajes/perfil)
│   ├── programa.html
│   ├── perfil.html
│   ├── estadisticas.html
│   └── comunidad.html
├── admin/
│   ├── index.html            ← ✅ dashboard + sección Planificación (SPA: programas, asesorías, editor de bloques)
│   ├── alumnos.html
│   ├── mensajes.html
│   └── metricas.html
└── images/

Nota: la "Planificación" NO es una página aparte — vive dentro de `admin/index.html` como vista SPA
(links del sidebar con `data-view` cambian de vista sin recargar). No existe `planificacion.html`.
Lo mismo con **Alumnos**: es la vista `#view-alumnos` dentro de `admin/index.html` (no existe
`alumnos.html`). Gestión de alumnos: tabs Activos/Inactivos/Todos + filtro por programa + buscador,
tabla, y **panel lateral slide-in** con ver/editar/dar de baja/eliminar e "Ir a planificación".
Idem **Mensajes**: vista `#view-mensajes` (no existe `mensajes.html`). Chat en tiempo real (Supabase
Realtime): columna izq de canales (Programas = chat grupal por slug; Asesorías = chat privado
`dm_<athlete_id>`), columna der con la conversación. Los mensajes se guardan en `messages.channel`.
Idem **Métricas**: vista `#view-metricas` (no existe `metricas.html`). Selector de mes + 5 secciones:
ingresos (cards, precios hardcodeados en `PRICES`), distribución de alumnos por programa (barras CSS),
evolución 6 meses (altas/bajas/total; bajas = N/D), top-5 activos (block_completions), y actividad de
chats del mes (top-3 canales, barras). Barras CSS puras, sin librerías.
Idem **Configuración**: vista `#view-config` (⚙️ en el sidebar). Edita la tabla `site_config`
(precios por programa, links MP/PayPal, WhatsApp Erika/Gonza). Guardar → `upsert(onConflict:'key')` con
feedback "✓ Guardado". Las **3 landing de programa** (`crossfit/hybrid/fuerza-corredores.html`) leen
`site_config` al cargar (via CDN Supabase + `supabase.js` en la raíz) y actualizan precios (`#precio-ars`,
`#precio-usd`) y botones (`#btn-mp`, `#btn-paypal`, `#btn-whatsapp`). Si Supabase no responde, quedan
los valores por defecto del HTML (try/catch silencioso). ⚠️ El WhatsApp de las 3 landing grupales usa
`whatsapp_erika` (ajustable). Nota: Métricas todavía usa su `PRICES` hardcodeado, no `site_config`.

**Portal del atleta** (`app/dashboard.html`): SPA con topbar fija (logo + nombre/avatar) y navegación
por tabs — **abajo fija en mobile, arriba (sticky) en desktop** (breakpoint 768px): 🏠 Inicio · 📅 Mi
programa · 📊 Estadísticas · 💬 Mensajes · 👤 Perfil. Guard: `getSession()` → sin sesión va a `login.html`;
si `role='admin'` → `../admin/index.html`; si atleta, carga su `profile`. Filtro de `planning_days`
como en admin: grupal filtra por `program_slug`; asesoría además por `athlete_id` (`dayScope`).
- Vista **Inicio**: saludo, card **HOY** (fecha + programa + nº de bloques del día o "no hay sesión" +
  botón a Mi programa), card **Tu semana** (7 círculos Lun-Dom), **Próximos días** (3 futuros con
  planificación), **Comunidad** (último `community_posts`; botón "Ver comunidad →" abre la vista Comunidad).
- Vista **Mi programa** (✅ desarrollada): toggle **Vista día / Vista mes**. *Día*: barra con ← →
  fecha + botón "Hoy"; si no hay planificación "No hay sesión para este día 💤"; si hay, lista de
  bloques. Cada bloque = card borde-izq dorado con: título dorado + **checkbox custom "Completado"**
  (INSERT/DELETE en `block_completions`, optimista; carga tildado si ya existe), contenido
  `white-space:pre-line`, sección **Ejercicios** (chips desde `exercise_links`; click → modal con embed
  YouTube), y **comentario** (💬 Comentar / ✏️ Editar → `block_completions.comment`; comentar crea la
  completion si no existía, marcando el bloque completado). **Fotos en el comentario** (hasta 5): en el
  editor de comentario, botón "📷 Agregar fotos" (input múltiple `image/*`) → preview de miniaturas 80px
  con × para quitar antes de guardar; al guardar sube al bucket **`block-images`**
  (`{athlete_id}/{block_id}/{filename}`) + INSERT en `block_images`. Las ya subidas se muestran como
  miniaturas (`.pb-img`) clickeables → modal de imagen, cada una con × para eliminar (Storage + tabla).
  Bloque completado: opacity 0.7 + título tachado. *Mes*: calendario Lun-Dom con nav ← →; punto dorado = con planificación, **fondo verde
  #1a3a1a = todo completo, amarillo #3a3a1a = algunos**, borde dorado punteado = hoy; click en día → vista día.
- Vista **Estadísticas** (✅ desarrollada): selector de período (Esta semana / Este mes / Últimos 3
  meses — solo afecta las 2 primeras cards). **4 cards**: Sesiones completadas (días con ≥1 completion
  en el período), Bloques completados (count en el período), Racha actual y Mejor racha. **Racha
  basada en la planificación** (`computeStreaks`, corregido 2026-07-23): solo cuentan los días
  **evaluables** = con planificación cargada para el atleta (`statsPerDate[ds].total > 0`); los días
  **sin planificación se ignoran** (no cortan ni suman, se saltan). Un día planificado con ≥1 bloque
  completado **suma**; un día planificado con 0 completados **corta**. La consecutividad es sobre la
  secuencia de días planificados (los huecos sin plan no rompen la cadena). *Racha actual*: desde el
  día evaluable más reciente hacia atrás, con **gracia para hoy** (si hoy está planificado pero aún sin
  completar, no corta). *Mejor racha*: corrida más larga en todo el historial. El badge "Racha de 7
  días" usa esta misma `best`. **Adherencia
  semanal**: 7 barras verticales CSS (Lun-Dom) con % de bloques completados por día. **Historial**:
  últimos 14 días planificados (fecha + programa + "X/Y bloques" con mini-barra + ✅/🟡/⭕). **Logros**:
  4 badges (Primera sesión, Semana perfecta, Racha de 7 días, 30 sesiones) — dorado desbloqueado / gris
  con candado bloqueado (calculados sobre TODO el historial). Datos: 1 query de `block_completions` del
  atleta (todo el historial) + 1 de `planning_blocks` con embed `planning_days!inner(date,program_slug,
  athlete_id)` filtrando por scope (evita `.in()` gigante). Las barras animan con `setTimeout` (no
  `requestAnimationFrame`, que se pausa en pestañas en 2º plano).
- Vista **Mensajes** (✅ desarrollada): el atleta ve **un solo canal** (sin lista): grupal → `channel =
  su program` ("Chat CrossFit" + "N miembros"); asesoría → `channel = 'dm_' + auth.uid()` ("Chat con
  Erika/Gonza Prada/Gonda" + "Asesoría privada"). Mensajes (últimos 50, orden cronológico) con avatar +
  nombre + hora; los propios a la derecha en dorado, ajenos a la izquierda; los del admin llevan badge
  **"Coach"**. Input + Enter/botón para enviar (INSERT optimista + dedupe por id). **Realtime** (`sb.channel
  ('chat_'+canal).on(postgres_changes INSERT filter channel=eq.X)`), se desuscribe al salir de la vista.
  Marca leídos al abrir (`UPDATE read=true WHERE channel=X AND from_id != uid AND read=false`). La vista
  usa `position:fixed` entre topbar y tabbar (el área de mensajes scrollea internamente).
- Vista **Perfil** (✅ desarrollada): 3 cards. **Datos personales** (avatar 80px con iniciales; nombre +
  teléfono editables, email solo lectura; "✏️ Editar datos" → inputs con borde dorado → "Guardar"
  `UPDATE profiles`; feedback toast "✓ Datos actualizados"; refresca topbar/avatar/saludo). **Mi
  suscripción** (badge de programa con colores del admin + badge de estado Activo/Cancelado/Pendiente;
  fecha inicio/vencimiento; **precio leído de `site_config`** según programa — "$45.000 / mes" o "USD 150
  / mes"; texto informativo según estado; si cancelado → botón "Volver a suscribirme" al landing del
  programa; si **activo** → botón "Cancelar suscripción" (outline rojo) que abre un modal de confirmación
  → "Sí, cancelar" muestra "Procesando…" y luego un mensaje amigable de que la cancelación automática aún
  no está disponible + botón de WhatsApp `wa.me/5491136433379`. ⚠️ La cancelación NO cambia el estado
  todavía (hay un TODO para integrar la Edge Function `cancel-subscription` + MP webhook)). **Seguridad**
  ("Cambiar contraseña" → `resetPasswordForEmail` + toast; "Cerrar sesión" → `signOut` → `login.html`,
  botón outline rojo al hover).
- Vista **Comunidad** (✅ desarrollada): NO es un tab — se entra desde el botón "Ver comunidad →" de la
  card Comunidad de Inicio (`showView('comunidad')`), con "← Volver" en el header. **Feed del programa
  del atleta** (`community_posts WHERE program_slug = su programa ORDER BY created_at DESC LIMIT 20`, join
  autor). Cada post: avatar + nombre + badge "Coach" si admin + fecha relativa (`fmtRelative`), texto
  `pre-line`, acciones **👍 likes (toggle → tabla `post_likes`, optimista, botón dorado si likeó + anim
  scale) · 💬 count · "Ver comentarios"** (expande sección con lista + input inline → INSERT
  `community_comments`), y **🗑️ Eliminar solo en los posts propios**. Los posts con **imágenes** las
  muestran en una grilla (máx 3 columnas, `.com-imgs`) debajo del texto; click en una → modal de imagen.
  Botón **"+ Nueva publicación"** → modal con textarea **+ "📷 Agregar fotos" (hasta 5)** (preview con ×);
  al publicar → INSERT `community_posts` → sube las fotos al bucket **`community-images`**
  (`{author_id}/{post_id}/{filename}`) + INSERT en `community_images` → se prepende al feed. **Realtime**: nuevos posts (filter
  `program_slug=eq.X`) se prependen; nuevos comentarios se agregan a su post si está expandido (dedupe por
  id; se desuscribe al salir). Fade-in en posts/comentarios nuevos.
**El portal del atleta (`app/dashboard.html`) está funcionalmente completo** (Inicio + Mi programa +
Estadísticas + Mensajes + Perfil + Comunidad).
⚠️ Requiere policies RLS del lado atleta: **SELECT** en planning_days/blocks/exercise_links/community_posts;
**INSERT/UPDATE/DELETE** en `block_completions` (propias); **UPDATE** de su propio `profiles` (Perfil);
para el chat, **SELECT/INSERT/UPDATE** en `messages` limitado a su canal (`channel = su program` o
`'dm_'+auth.uid()`) + Realtime en `messages`; y para la comunidad, **SELECT/INSERT** en `community_posts`
y `community_comments` de su programa + **DELETE** de los propios posts + `post_likes` (FOR ALL propios) +
Realtime en `community_posts` y `community_comments`. Si faltan, las vistas degradan a estados vacíos /
avisan el error.

Alta de atleta (asesorías): el modal "Asignar atleta" NO hace INSERT directo en `profiles`. Llama a
la **Edge Function `create-athlete`** (`POST /functions/v1/create-athlete`, Bearer = access_token del
admin, body `{ full_name, email, phone, program }`) que crea el user en Auth + el profile y responde
`{ ok }` o `{ ok:false, error }`. ⚠️ Falta implementar/deployar esa function (ver CONTEXTO.md).

**Activación de cuenta (`app/set-password.html`)**: página a la que llega el atleta nuevo desde el link
de invitación/recuperación del email (`create-athlete` genera el invite; también la usa "Cambiar
contraseña" y "¿Olvidaste tu contraseña?" con `redirectTo` a esta página). Misma identidad visual que
`login.html`. Tiene **4 estados** en una sola card: (1) **cargando** — spinner + "Verificando tu
invitación" mientras detecta el token; (2) **formulario** — "Activá tu *cuenta*" + 2 campos (nueva
contraseña / repetir, mín. 8) + botón dorado "ACTIVAR CUENTA", valida coincidencia y longitud (error en
rojo); (3) **link inválido/expirado** — ⚠️ + "Este link ya fue usado o expiró" + botón WhatsApp
`wa.me/5491136433379`; (4) **éxito** — ✅ mensaje verde "¡Cuenta activada! Redirigiendo…" → `dashboard.html`
a los 2 s. **Detección del token** (`detectInvite`): `getSession()` (Supabase parsea el hash con
`detectSessionInUrl`) → si no, parseo manual del hash `#access_token=...` (`setSession`) y detección de
`error`/`error_description` en el hash → si nada aparece en ~4 s, estado inválido. También escucha
`onAuthStateChange` (marca listo si llega sesión). Crear contraseña: `sb.auth.updateUser({ password })`;
si el error es de sesión/JWT expirada → estado inválido. No requiere tablas nuevas (usa solo Auth).

**Entrada al portal desde la landing:** el navbar de `index.html` (raíz) tiene un botón **"Ingresar"**
(`a.btn-ingresar`, último item de `#navLinks`) que apunta a **`app/login.html`**. Es el acceso público
al portal (borde dorado, hover relleno; en mobile va como último item del menú hamburguesa). Ver detalle
en el `CLAUDE.md`/`CONTEXTO.md` de la raíz.

Editor de planificación (dentro de `admin/index.html`, para grupos y asesorías) — 4 features:
1. **Vista día / Vista mes** (toggle). La vista mes es un calendario (Lun-Dom) con navegación ← →;
   los días con planificación llevan punto dorado; click en un día → vista día con esa fecha.
2. **Copiar / pegar día** (solo en memoria, se pierde al recargar): botones en la barra de día y
   menú contextual (⋮ / click derecho) en las celdas del calendario. Copia bloques + ejercicios.
2b. **Copiar / pegar semana** (memoria): en la vista mes cada fila tiene un gutter a la izquierda con
   ⋮ → "📋 Copiar semana" / "📌 Pegar semana aquí". Pegar respeta la correspondencia de días
   (Lun→Lun…). Si algún día destino ya tiene bloques, pregunta "¿Reemplazar o agregar?".
3. **Ejercicios linkeados por bloque** → tabla `exercise_links` (reemplaza el viejo campo YouTube por
   bloque). Chips por ejercicio; click → modal con embed; × → borrar.
4. **Buscador de YouTube** integrado (YouTube Data API v3) dentro del mini-panel de ejercicio.
   ⚠️ La API key está **hardcodeada en el JS del front** (`YT_API_KEY`, pública) — restringirla por
   dominio en Google Cloud; idealmente moverla a una Edge Function más adelante.
5. **Comentario + fotos del atleta (solo lectura)** — cuando el editor es de una **asesoría**
   (`editorCtx.athleteId` seteado), debajo del contenido de cada bloque se muestra lo que dejó el atleta
   en ese bloque. `attachAthleteComments` trae `block_completions` (con `id` + embed
   `athlete:profiles!athlete_id(full_name)`) y, por cada completion, sus **`block_images`**
   (`.in('completion_id', ...)`). Sección `.athlete-comment` (fondo #0D0D0D, borde-izq dorado):
   "💬 Comentario del atleta:" + texto gris claro (si hay comentario) + **fila de miniaturas 80px**
   (`.ac-img`, URL pública `…/storage/v1/object/public/block-images/{storage_path}`) clickeables → **modal
   de imagen** `#modalBlockImg` (`openBlockImageModal`; limpia el `src` al cerrar) + "— {nombre} · {fecha}".
   La sección aparece si hay **comentario O fotos** (si el atleta subió fotos sin texto, igual se ven; si no
   hay ni comentario ni fotos, no se muestra nada). El admin NO edita nada acá. Degrada en silencio si
   `block_images` no está disponible (SELECT admin requerido en Supabase).

## Base de datos — tablas

### profiles
id uuid (FK auth.users)
full_name text
email text
phone text
role text ('admin' | 'athlete')
program text ('crossfit' | 'hybrid' | 'corredores' | 'asesoria-erika' | 'asesoria-gonza')
subscription_start date
subscription_end date
subscription_status text ('active' | 'cancelled' | 'pending')
mp_subscription_id text
created_at timestamptz

### programs
id uuid
slug text
name text
description text

### planning_days
id uuid
program_slug text
date date
athlete_id uuid (FK profiles.id, nullable)  ← ⚠️ AGREGAR en Supabase. NULL = programa grupal; seteado = asesoría 1a1
created_by uuid (FK profiles.id)
created_at timestamptz

### planning_blocks
id uuid
day_id uuid (FK planning_days.id)
title text
order int
content text
youtube_url text   ← legacy: ya NO se edita desde la UI (reemplazado por exercise_links). La columna sigue existiendo y se copia al duplicar días.
created_at timestamptz

### exercise_links   ← ✅ ejercicios linkeados por bloque (múltiples por bloque)
id uuid (default gen_random_uuid())
block_id uuid (FK planning_blocks.id, on delete cascade)
name text (not null)
youtube_url text
created_at timestamptz (default now())
RLS: admin FOR ALL vía public.get_my_role()='admin'; athlete SELECT si el bloque pertenece a su programa/asesoría.

### block_completions
id uuid
athlete_id uuid (FK profiles.id)
block_id uuid (FK planning_blocks.id)
completed_at timestamptz
comment text

### site_config   ← ✅ config editable del sitio (precios, links de pago, WhatsApp). Clave-valor.
key text (primary key)   — p.ej. price_crossfit_ars, mp_link_hybrid, whatsapp_erika
value text (not null)
updated_at timestamptz (default now())
RLS: admin FOR ALL (get_my_role()='admin'); **público SELECT** (las landing lo leen sin auth).
Se edita desde admin → Configuración (upsert). ⚠️ Crear en Supabase (SQL en CONTEXTO.md).

### community_posts
id uuid
program_slug text
author_id uuid (FK profiles.id)
content text
created_at timestamptz

### community_comments
id uuid
post_id uuid (FK community_posts.id)
author_id uuid (FK profiles.id)
content text
created_at timestamptz

### block_images   ← ✅ imágenes adjuntas al comentario de un bloque (portal atleta)
id uuid (default gen_random_uuid())
completion_id uuid (FK block_completions.id)
athlete_id uuid (FK profiles.id)
storage_path text   — path en el bucket **`block-images`**: `{athlete_id}/{block_id}/{filename}`
created_at timestamptz
Bucket Storage **`block-images`** (público). Máx 5 por bloque. Ya creada en Supabase (según el usuario).
⚠️ Requiere policies de Storage/tabla para que el atleta suba/borre las suyas (ver CONTEXTO.md).

### community_images   ← ✅ imágenes de un post de comunidad
id uuid (default gen_random_uuid())
post_id uuid (FK community_posts.id)
author_id uuid (FK profiles.id)
storage_path text   — path en el bucket **`community-images`**: `{author_id}/{post_id}/{filename}`
created_at timestamptz
Bucket Storage **`community-images`** (público). Máx 5 por post. Ya creada en Supabase (según el usuario).
⚠️ Requiere policies de Storage/tabla para que el atleta suba las suyas (ver CONTEXTO.md).

### post_likes   ← ✅ likes de posts de comunidad (toggle por atleta)
id uuid (default gen_random_uuid())
post_id uuid (FK community_posts.id, on delete cascade)
athlete_id uuid (FK profiles.id, on delete cascade)
created_at timestamptz (default now())
unique(post_id, athlete_id)
RLS: atleta FOR ALL de sus likes (athlete_id = auth.uid()); todos SELECT. ⚠️ Crear en Supabase (SQL en CONTEXTO.md).

### messages
id uuid
from_id uuid (FK profiles.id)
to_id uuid (FK profiles.id, **nullable** — el chat usa `channel`, ya no `to_id`)
channel text   ← ⚠️ AGREGAR en Supabase. Chat grupal: slug del programa ('crossfit'…). Chat privado asesoría: 'dm_' + athlete_id
content text
read boolean default false
created_at timestamptz
⚠️ Habilitar **Realtime** en la tabla `messages` (Supabase → Database → Replication) para que el chat
en vivo funcione. Ver policies RLS nuevas en CONTEXTO.md.

### notifications   ← ✅ notificaciones en tiempo real (campana en dashboard atleta + admin)
id uuid (default gen_random_uuid())
user_id uuid (FK profiles.id, on delete cascade)   — destinatario
type text (not null)   — 'message' | 'planning' | 'like' | 'comment' | 'new_athlete'
title text (not null)
body text
read boolean (default false)
link text   — hash de destino: '#mensajes' | '#programa' | '#comunidad' | '#alumnos'
created_at timestamptz (default now())
RLS: usuario SELECT/UPDATE de las suyas (auth.uid()=user_id); INSERT admin (get_my_role()='admin')
**y** "sistema" (WITH CHECK true → cualquiera autenticado puede crear notifs para otro usuario, necesario
para que el atleta avise al admin/autor). ⚠️ Crear tabla + habilitar **Realtime** (SQL en CONTEXTO.md).

## Sistema de notificaciones (campana 🔔 — `app/dashboard.html` + `admin/index.html`)
Idéntico en ambos portales. **Campana en la topbar** (dashboard: entre nombre y avatar; admin: junto al
"Hola, [nombre] 👋") con **badge rojo** de no leídas (oculto si 0). Click → **dropdown** (320px, máx 400px
con scroll, `#1A1A1A`/borde `#333`/`border-radius:12px`, cierra al clickear fuera): header con "Marcar todas
como leídas", lista de notifs (ícono por tipo + título + body + fecha relativa; **no leída con fondo `#222`**),
y "No tenés notificaciones nuevas" si está vacía. Click en una notif → marca leída (`UPDATE read=true`) +
navega a su `link` (`showView`). **Íconos:** message 💬 · planning 📅 · like 👍 · comment 💬 · new_athlete 👤.
- **Carga**: `loadNotifs()` (SELECT de las 30 últimas del usuario) + `subscribeNotifs()` en `init()`.
- **Realtime**: `sb.channel('notifs_'+uid).on(INSERT, filter user_id=eq.uid)` → `prependNotif` (dedupe por id,
  incrementa badge con animación). La tabla degrada en silencio si no existe (dropdown vacío, sin romper).
- **Helper `notify(userIds, {type,title,body,link})`**: inserta una fila por destinatario (no lanza).
- **Cuándo se crean** (5 disparadores):
  1. **message** — atleta envía chat → notif para **todos los admins** (`getAdminIds`); admin envía chat →
     notif para el/los atleta(s) del canal (`notifyChannelAthletes`: `dm_<id>` → ese atleta; slug grupal →
     todos los `athlete` del programa). title "Nuevo mensaje de [nombre]", body 60 chars, link `#mensajes`.
  2. **planning** (solo atleta) — al entrar a "Mi programa" (`maybeNotifyTodayPlanning`), si hoy tiene sesión
     con bloques y no se avisó hoy (dedupe consultando la propia tabla por `type='planning'` + `created_at>=hoy`)
     → notif para el atleta. title "¡Tenés sesión para hoy!", body "…[N] bloques…", link `#programa`.
  3. **like** — al dar 👍 a un post ajeno → notif para el autor. body 40 chars del post, link `#comunidad`.
  4. **comment** — al comentar un post ajeno → notif para el autor. body 60 chars, link `#comunidad`.
  5. **new_athlete** (solo admins) — al crear atleta OK (`create-athlete`) → notif para **todos los admins**.
     body "[nombre] se unió a [programa]", link `#alumnos`.

## Roles
- admin → acceso total
- athlete → acceso solo a su programa

## Flujo de alta de atleta
1. Atleta compra suscripción en la landing (MP o PayPal)
2. Edge Function process-payment recibe webhook de MP
3. Crea usuario en Supabase Auth → envía email con link a app/set-password.html
4. Atleta crea contraseña → accede a app/dashboard.html
5. Ve planificación de su programa automáticamente

## Flujo de cancelación
1. MP webhook notifica cancelación
2. Edge Function actualiza profiles.subscription_status = 'cancelled'
3. Atleta pierde acceso (RLS lo bloquea)

## Identidad visual
Misma que la landing:
- Fondo: #0A0A0A · Cards: #1A1A1A · Acento: #F5A800
- Inter (cuerpo) + Playfair Display cursiva (acentos)

## Reglas técnicas
- Mobile-first, totalmente responsive
- RLS activo en todas las tablas
- Atleta solo ve datos de su programa
- Admin ve todo
- supabase.js siempre primero en los scripts

## Cómo trabajar
1. Leer CONTEXTO.md para estado actual
2. Respetar identidad visual de la landing
3. Actualizar CONTEXTO.md al finalizar cada tarea
