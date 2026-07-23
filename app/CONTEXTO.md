# CONTEXTO.md — HB Performance App

## Estado actual
Proyecto iniciado. Supabase configurado. Arquitectura definida en CLAUDE.md.
Creados `supabase.js` (raíz), `app/login.html` (funcional) y `admin/index.html` (dashboard admin
+ **sección Planificación completa** con editor avanzado: vista día/mes, copiar/pegar días,
**copiar/pegar semana completa**, ejercicios linkeados por bloque y buscador de YouTube integrado
+ **sección Alumnos completa**: tabs/filtros/buscador, tabla y panel lateral de detalle/edición
+ **sección Mensajes completa**: chat en tiempo real (Supabase Realtime) con canales grupales y privados
+ **sección Métricas completa**: ingresos, distribución por programa, evolución 6 meses, top activos y
actividad de chats, con selector de mes
+ **sección Configuración completa**: edita `site_config` (precios, links de pago, WhatsApp) y las 3
landing de programa leen esos valores al cargar).
**El panel admin (`admin/index.html`) está funcionalmente completo** (Dashboard + Planificación +
Alumnos + Mensajes + Métricas + Configuración).
**El portal del atleta (`app/dashboard.html`) está funcionalmente completo:** Inicio, Mi programa
(vista día con checkboxes/comentarios/ejercicios + vista mes), Estadísticas (resumen, adherencia,
historial, logros), Mensajes (chat en tiempo real), **Perfil** (datos personales editables,
suscripción con precio de `site_config`, seguridad + cancelación) y **Comunidad** (feed del programa con
posts, likes, comentarios y realtime).
Pendiente en Supabase: ⚠️ `planning_days.athlete_id` + ⚠️ tabla `exercise_links` + ⚠️ tabla `site_config`
+ ⚠️ columna `messages.channel` + policies/Realtime del chat + **policies RLS del lado atleta**
(SELECT en planning_days/planning_blocks/block_completions/community_posts; INSERT/UPDATE/DELETE en
`block_completions`; UPDATE del propio `profiles`; SELECT/INSERT/UPDATE en `messages` de su canal) +
Edge Functions (`create-athlete` + webhook MP + **`cancel-subscription`**) + ⚠️ tabla `post_likes` +
policies/Realtime de comunidad + ⚠️ tabla **`notifications`** + policies + Realtime (campana de
notificaciones del atleta y del admin) + ⚠️ policies de Storage/tablas **`block_images`** y
**`community_images`** (buckets `block-images` / `community-images`, para las imágenes en comentarios de
bloque y en posts de comunidad). **`set-password.html` ✅ creado**, **notificaciones ✅ codeadas** y
**comentario del atleta en el editor + imágenes en bloques y comunidad ✅ codeadas**; lo pendiente es todo
del lado de Supabase (esquema, RLS, Storage policies, Realtime y Edge Functions).

## ⚠️ Imágenes (Storage) — buckets + tablas + policies
Las tablas **`block_images`** y **`community_images`** y los buckets **`block-images`** y
**`community-images`** ya fueron creados en Supabase (según el usuario). Falta confirmar las **policies**:
- **Buckets públicos** (lectura pública para `getPublicUrl`).
- Storage **INSERT/DELETE** para el atleta en su prefijo (`{uid}/...`): p.ej.
  `bucket_id = 'block-images' AND (storage.foldername(name))[1] = auth.uid()::text` para INSERT/DELETE;
  ídem `community-images`.
- Tabla `block_images`: **SELECT** (atleta ve las de sus completions **+ admin ve todas** vía
  `get_my_role()='admin'`, necesario para el editor de asesorías que muestra las fotos del atleta),
  **INSERT/DELETE** de las propias (`athlete_id = auth.uid()`). Tabla `community_images`: **SELECT**
  (todos los del programa), **INSERT** de las propias (`author_id = auth.uid()`).
El front **degrada en silencio** si falta algo (galerías vacías; al subir/borrar recién ahí avisa por toast).

### ⚠️ Foto de perfil — bucket `avatars` + columna `profiles.avatar_url` (pendiente en Supabase)
Para la foto de perfil del atleta (vista Perfil) hace falta:
1. **Columna nueva** en `profiles`:
   ```sql
   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
   ```
2. **Bucket `avatars`** (crearlo manual en Storage → New bucket → nombre `avatars` → **Public: ON**).
3. **Policies de Storage** (SQL):
   ```sql
   CREATE POLICY "Atleta sube su avatar" ON storage.objects
     FOR INSERT WITH CHECK (
       bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
     );
   CREATE POLICY "Atleta actualiza su avatar" ON storage.objects
     FOR UPDATE USING (
       bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
     );
   CREATE POLICY "Todos ven avatares" ON storage.objects
     FOR SELECT USING (bucket_id = 'avatars');
   ```
El path es `{athlete_id}/avatar.jpg` (fijo, `upsert:true` → sobrescribe). Sin la columna, el `UPDATE`
falla y avisa por toast; sin el bucket/policies, la subida falla y avisa. La UI degrada a iniciales.

## ⚠️ Cambios de esquema pendientes en Supabase
- **`notifications`** (nueva tabla) — notificaciones en tiempo real (campana del dashboard atleta y del
  admin). Correr en el SQL Editor:
  ```sql
  CREATE TABLE public.notifications (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.profiles(id) on delete cascade,
    type text not null,
    title text not null,
    body text,
    read boolean default false,
    link text,
    created_at timestamptz default now()
  );
  ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Usuario ve sus notificaciones" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY "Usuario actualiza sus notificaciones" ON public.notifications
    FOR UPDATE USING (auth.uid() = user_id);
  CREATE POLICY "Admin inserta notificaciones" ON public.notifications
    FOR INSERT WITH CHECK (public.get_my_role() = 'admin');
  CREATE POLICY "Sistema inserta notificaciones" ON public.notifications
    FOR INSERT WITH CHECK (true);

  -- Habilitar Realtime:
  alter publication supabase_realtime add table public.notifications;
  ```
  ⚠️ La policy "Sistema inserta" (`WITH CHECK true`) es la que permite que un atleta cree notifs para el
  admin o para el autor de un post (mensaje/like/comentario). El front degrada en silencio si la tabla no
  existe (la campana queda vacía, nada rompe).
- **`post_likes`** (nueva tabla) — likes de posts de comunidad. Correr en el SQL Editor:
  ```sql
  CREATE TABLE public.post_likes (
    id uuid default gen_random_uuid() primary key,
    post_id uuid references public.community_posts(id) on delete cascade,
    athlete_id uuid references public.profiles(id) on delete cascade,
    created_at timestamptz default now(),
    unique(post_id, athlete_id)
  );
  ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Atleta gestiona sus likes" ON public.post_likes
    FOR ALL USING (athlete_id = auth.uid());
  CREATE POLICY "Todos ven likes" ON public.post_likes
    FOR SELECT USING (true);
  ```
  El front degrada si no existe (los posts muestran 0 likes; dar like recién ahí avisa el error).
  ⚠️ Además: habilitar **Realtime** en `community_posts` y `community_comments`, y policies del atleta
  (SELECT/INSERT en ambas para su programa; DELETE de sus propios `community_posts`).
- **`site_config`** (nueva tabla clave-valor) — usada por admin → Configuración y por las 3 landing de
  programa. Correr en el SQL Editor:
  ```sql
  CREATE TABLE public.site_config (
    key text primary key,
    value text not null,
    updated_at timestamptz default now()
  );
  ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Admin gestiona config" ON public.site_config
    FOR ALL USING (public.get_my_role() = 'admin');
  CREATE POLICY "Público lee config" ON public.site_config
    FOR SELECT USING (true);

  INSERT INTO public.site_config (key, value) VALUES
    ('price_crossfit_ars', '45000'), ('price_crossfit_usd', '40'),
    ('price_hybrid_ars', '45000'),   ('price_hybrid_usd', '40'),
    ('price_corredores_ars', '40000'),('price_corredores_usd', '35'),
    ('price_asesoria_usd', '150'),
    ('mp_link_crossfit', '#'), ('mp_link_hybrid', '#'), ('mp_link_corredores', '#'),
    ('paypal_link_crossfit', '#'), ('paypal_link_hybrid', '#'), ('paypal_link_corredores', '#'),
    ('whatsapp_erika', '5491136433379'), ('whatsapp_gonza', '5491122895924');
  ```
  El front degrada con elegancia si la tabla no existe (admin avisa; landing mantiene sus defaults).
- **`planning_days.athlete_id` uuid (FK profiles.id, nullable)** — necesario para el editor de
  bloques de asesorías 1a1. Grupales dejan `athlete_id` NULL; asesorías lo setean.
- **`exercise_links`** (nueva tabla) — ejercicios linkeados por bloque. Correr en el SQL Editor:
  ```sql
  CREATE TABLE public.exercise_links (
    id uuid default gen_random_uuid() primary key,
    block_id uuid references public.planning_blocks(id) on delete cascade,
    name text not null,
    youtube_url text,
    created_at timestamptz default now()
  );
  ALTER TABLE public.exercise_links ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Admin gestiona exercise_links" ON public.exercise_links
    FOR ALL USING (public.get_my_role() = 'admin');
  CREATE POLICY "Athlete ve exercise_links de su programa" ON public.exercise_links
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.planning_blocks pb
        JOIN public.planning_days pd ON pd.id = pb.day_id
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE pb.id = block_id
        AND (pd.program_slug = p.program OR pd.athlete_id = auth.uid())
      )
    );
  ```
  (`public.get_my_role()` ya existe en el proyecto — confirmado por el usuario 2026-07-21.)
  El front degrada con elegancia si la tabla aún no existe (los chips muestran "Sin ejercicios";
  guardar un ejercicio recién ahí avisa el error).

## ⚠️ Cambios pendientes en Supabase para el CHAT (sección Mensajes)
Correr en el SQL Editor / configurar en el panel:
```sql
-- 1) Columna channel + to_id nullable
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.messages ALTER COLUMN to_id DROP NOT NULL;

-- 2) Policies RLS para canales grupales (admin)
CREATE POLICY "Admin ve todos los mensajes" ON public.messages
  FOR SELECT USING (public.get_my_role() = 'admin');
CREATE POLICY "Admin envía mensajes" ON public.messages
  FOR INSERT WITH CHECK (from_id = auth.uid());
CREATE POLICY "Admin actualiza mensajes" ON public.messages
  FOR UPDATE USING (public.get_my_role() = 'admin');
```
- **Habilitar Realtime** en la tabla `messages`: Supabase → Database → Replication → agregar
  `messages` a la publicación `supabase_realtime`. Sin esto, los mensajes entrantes de otros no
  llegan en vivo (los propios igual se ven porque el front los agrega de forma optimista).
- Nota: cuando se construya el lado del **atleta**, harán falta policies para que cada alumno vea/
  envíe solo en su canal (`channel = su program` o `channel = 'dm_' + su id`). Por ahora solo admin.

## ⚠️ Seguridad — API key de YouTube
- La YouTube Data API v3 key está **hardcodeada en `admin/index.html`** (`const YT_API_KEY`), pública
  en el front (así lo pidió el spec "por ahora"). **Restringirla en Google Cloud** por referrer HTTP
  (dominio del sitio) para que no la reutilicen. Ideal a futuro: moverla a una Edge Function.

## ⚠️ Pendiente (documentado, NO codeado) — cancelación de suscripciones vía MercadoPago
- **Edge Function webhook de MP** que reciba la notificación de cancelación de suscripción y haga
  `UPDATE profiles SET subscription_status='cancelled'` para el `mp_subscription_id` correspondiente
  (ver "Flujo de cancelación" en CLAUDE.md). Hoy la baja se hace **manual** desde la sección Alumnos
  (botón "🚫 Dar de baja"). Falta la automática por webhook.
- **Email automático** al alumno cuando MP notifica la cancelación (avisar que perdió el acceso).
  Se dispararía desde esa misma Edge Function (o un trigger). Aún no implementado.

## ⚠️ Edge Function pendiente de crear/deployar en Supabase
- **`create-athlete`** (`POST /functions/v1/create-athlete`) — el modal "Asignar atleta" ya la llama
  (ver más abajo). Falta implementarla y deployarla. Debe: validar que quien llama es admin (con el
  Bearer del `access_token` que se le manda), crear el usuario en Supabase Auth (Admin API) y su
  fila en `profiles` (role=athlete, program, subscription_status=active), y responder JSON
  `{ ok: true }` o `{ ok: false, error: '<mensaje>' }`. Recibe body JSON
  `{ full_name, email, phone, program }` (program = 'asesoria-erika' | 'asesoria-gonza').
  Esto reemplaza al INSERT directo en `profiles` (que fallaba por la FK id→auth.users).

## Historial
### 2026-07-23
- **3 cambios: sin WodUp en el footer de la landing, comunidad oculta en asesorías, foto de perfil.**
  1. **`index.html`** — se **eliminó el aviso de WodUp** del footer (`.notice-box`), sin reemplazo. (Detalle
     también en el `CONTEXTO.md`/`CLAUDE.md` de la raíz.)
  2. **`app/dashboard.html` — Comunidad oculta para asesorías.** La card de Inicio ahora tiene
     `id="cardComunidad"`; en `loadInicio`, si `IS_ASESORIA` → `display:none` y **no** se llama
     `loadCommunity` (el botón "Ver comunidad →" queda dentro de la card oculta, inaccesible). La vista
     `comunidad` sigue en el código pero no es alcanzable para atletas de asesoría. Los grupales la ven igual.
  3. **`app/dashboard.html` — Foto de perfil.** El avatar de la card Perfil (`#pfAvatar`, 80px) es clickeable
     con overlay **📷 al hover** → input `image/*` (`#avatarInput`, máx **5 MB**, valida tipo y tamaño con
     toast). Sube al bucket **`avatars`** con path fijo **`{athlete_id}/avatar.jpg`** (`upsert:true`,
     `contentType`) → `UPDATE profiles SET avatar_url` (URL pública `getPublicUrl`) → `refreshAvatars()`
     repinta **topbar + card de perfil** al instante (cache-buster `?v=Date.now()` en `avatarSrc`). Helpers
     nuevos: `avatarBust`, `avatarSrc`, `paintAvatar(el, withCamera)`, `refreshAvatars`, `onAvatarSelected`.
     `init`/`loadPerfil`/`savePersonal` ahora usan `paintAvatar`/`refreshAvatars` (antes seteaban
     `textContent = initials(...)`). Si `avatar_url` existe → `<img class="av-img">` (cover, círculo); si no,
     iniciales. Reutiliza `publicUrl`/`flash` ya existentes.
  - **Verificado** en el navegador con 2 harness temporales (fake de Supabase con DB en memoria **+ Storage
    simulado** `upload`/`getPublicUrl` + parser de embed sin regex, ambos borrados; **sin errores de
    consola**):
    - **Grupal (crossfit, sin avatar):** card Comunidad **visible**; avatar arranca en **iniciales "JP"**
      (topbar + perfil, con 📷 en perfil); **subir foto** → Storage `avatars/ath-1/avatar.jpg`
      (`upsert:true`, contentType `image/png`, cacheControl 3600), `profiles.avatar_url` = URL pública
      limpia, topbar y perfil pasan a `<img ...?v=…>` al instante, toast "✓ Foto de perfil actualizada";
      **validación**: >5 MB → "La imagen no puede superar los 5 MB.", no-imagen → "El archivo tiene que ser
      una imagen.", `avatar_url` sin cambios en ambos rechazos.
    - **Asesoría (asesoria-erika, con avatar_url):** card Comunidad **oculta** (`display:none`, botón sin
      `offsetParent`); en la carga el avatar ya muestra la **foto** (`<img>`) en topbar y perfil (sin
      iniciales), con 📷 en el de perfil.
  - `index.html` y `app/dashboard.html` reales pasan `new Function` (syntax OK).
  - ⚠️ Pendiente en Supabase (ver sección Storage arriba): **columna `profiles.avatar_url`** + **bucket
    `avatars` público** + **policies de Storage** (INSERT/UPDATE del atleta en su prefijo + SELECT público).
- **URLs actualizadas al dominio de producción `https://hbperformance.fit`.** El sitio ya tiene dominio real.
  - `app/login.html` (link "¿Olvidaste tu contraseña?") y `app/dashboard.html` (Perfil → "Cambiar
    contraseña"): el `redirectTo` de `resetPasswordForEmail` pasó de `window.location.origin +
    '/app/set-password.html'` a **`'https://hbperformance.fit/app/set-password.html'`** (hardcodeado).
  - `admin/index.html`: la llamada a la Edge Function **`create-athlete`** ahora manda en el body
    `redirectTo: 'https://hbperformance.fit/app/set-password.html'` (con comentario). ⚠️ La **Edge Function
    vive en Supabase, fuera de este repo** — debe leer ese `redirectTo` (o tenerlo hardcodeado) en el
    `inviteUserByEmail`. No se puede cambiar desde estos archivos.
  - `app/set-password.html`: **sin cambios** — no tiene `resetPasswordForEmail` (consume el token del email
    y llama `updateUser`); es el *destino* del redirect, no el emisor.
  - **No había** referencias literales a `localhost`, `file://` ni `127.0.0.1` en ningún archivo (solo esos
    dos `window.location.origin`, ya reemplazados). El resto de URLs `https://` (Google Fonts, CDN de
    Supabase, wa.me, YouTube, WodUp, endpoint de la Edge Function, bucket de Storage) son de producción y
    quedaron igual.
  - Sintaxis verificada (`new Function`) en los 3 archivos editados: OK.
  - ⚠️ Recordatorio: agregar `https://hbperformance.fit/app/set-password.html` a la allowlist de **Redirect
    URLs** en Supabase → Authentication → URL Configuration, o el link del email será rechazado.
- **Fotos del atleta en el editor de bloques del admin (`admin/index.html`).** En la sección
  `.athlete-comment` (asesorías), además del texto del comentario ahora se muestran las **imágenes que el
  atleta subió al bloque**. `attachAthleteComments` ahora también pide el `id` de cada `block_completions`
  y consulta **`block_images`** (`.in('completion_id', [...])`), adjuntando `athleteComment.images`
  (`[{path, url}]`, URL = `BLOCK_IMG_BASE + storage_path`, base pública del bucket `block-images`).
  `athleteCommentHtml` renderiza, **después del texto**, una fila de **miniaturas 80px** (`.ac-img`)
  clickeables. `wireBlock` engancha el click de cada miniatura → **`openBlockImageModal(url)`** que abre el
  nuevo modal **`#modalBlockImg`** (mismo sistema `modal-backdrop`/`openModal`/`closeModal`; el `src` se
  limpia al cerrar, tanto por la ✕ como por click en el backdrop). **Decisión**: la sección aparece si hay
  **comentario O fotos** — si el atleta subió fotos sin escribir texto, igual se ven (label + miniaturas,
  sin `.ac-text`); si no hay ni comentario ni fotos, no se muestra nada extra ("Si no hay imágenes, no
  mostrar nada extra"). Degrada en silencio si `block_images` no está (console.warn, sin romper).
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + parser de embed sin regex +
    seed con 1 bloque con comentario+2 fotos y 1 bloque **sin texto pero con 1 foto**, ya borrado; **sin
    errores de consola**): entrar al editor de la asesoría de "Lucía Fernández" → b7 muestra el texto "Me
    sentí muy bien hoy" + **2 miniaturas** con la URL pública correcta; b8 muestra la sección **sin
    `.ac-text` pero con 1 miniatura**; click en miniatura → modal con el `src` correcto (`…/b7/foto2.jpg`),
    cerrar con ✕ → cerrado + `src` limpiado; reabrir (`…/b8/foto3.jpg`) y cerrar por backdrop. El
    `admin/index.html` real pasa `new Function` (syntax OK).
  - ⚠️ Pendiente en Supabase: **SELECT en `block_images` para el admin** (p.ej. `get_my_role()='admin'`)
    para que el editor pueda leer las fotos del atleta; el bucket `block-images` ya es público.
- **Botón "Ingresar" en el navbar de la landing (`index.html`, raíz) → `app/login.html`.** Acceso
  público al portal, a la derecha de los links (Programas | Asesorías | Testimonios) como último
  `<li class="nav-login">` de `#navLinks`. Estilo `a.btn-ingresar`: borde dorado `#F5A800`, fondo
  transparente, texto dorado; hover → fondo dorado + texto negro. Desktop: separado por un divisor
  (`border-left` + `padding-left`). Mobile (≤768px): sin divisor, centrado como último item del menú
  hamburguesa (el JS existente ya le cierra el menú al clickear). Verificado por DOM/CSS en desktop
  (1280) y mobile (375), sin errores de consola. (Detalle completo en el `CONTEXTO.md` de la raíz.)
- **🔧 Fix de la lógica de RACHA en Estadísticas (`app/dashboard.html`, `computeStreaks`).**
  **Antes**: la racha usaba `statsActiveDays` (días sueltos con ≥1 completion, por `completed_at`), sin
  mirar la planificación → un día sin planificación en el que el atleta no completaba nada **cortaba** la
  racha incorrectamente. **Ahora**: la racha se calcula sobre `statsPerDate` (días con planificación):
  - Solo cuentan los días **evaluables** = con planificación cargada (`total > 0`) y `<= hoy`.
  - Días **sin planificación** → se ignoran (no cortan ni suman; se saltan).
  - Día planificado + **≥1 bloque completado** (`completed > 0`) → suma. Día planificado + **0** → corta.
  - Consecutividad sobre la **secuencia de días planificados** (los huecos sin plan no rompen la cadena).
  - *Racha actual*: desde el día evaluable más reciente hacia atrás, con **gracia para hoy** (si hoy está
    planificado pero aún sin completar, no corta). *Mejor racha*: corrida más larga en todo el historial.
  - Un solo cambio en `computeStreaks()` (interfaz `{current, best}` intacta) corrige las **3** superficies:
    card "Racha actual", card "Mejor racha" y badge "Racha de 7 días" (usa `best >= 7`). No se tocaron los
    otros usos de `statsActiveDays` (badge "30 sesiones", card "Sesiones", que son días con actividad).
  - **Verificado** con tests unitarios en Node (réplica exacta de la función, 8 escenarios, todos PASS):
    el ejemplo del spec (Lun 3/2✅, Mar sin plan, Mié 2/0❌, Jue 3/3✅=hoy → actual 1, mejor 1), hueco sin
    plan que no corta, gracia de hoy (planificado 0 hecho → no corta), hoy sin plan, planned+0 en el medio
    que corta, racha de 7 con gracia de hoy (→7), sin planificación (0/0) y todo sin completar (0/0).
    `new Function` sobre el `<script>` real: sintaxis OK.
- **3 features nuevas: comentario del atleta en el editor admin + imágenes en comentarios de bloque +
  imágenes en posts de comunidad.**
- **Feature 1 — Admin ve el comentario del atleta (`admin/index.html`, editor de asesorías):**
  `attachAthleteComments(blocks)` (se llama en `loadBlocks`, solo si `editorCtx.athleteId`) trae
  `block_completions.comment/completed_at` del atleta con embed `athlete:profiles!athlete_id(full_name)`
  y lo adjunta como `b.athleteComment`. `athleteCommentHtml(b)` renderiza, **debajo del contenido de cada
  bloque**, la sección solo-lectura `.athlete-comment` (fondo #0D0D0D, borde-izq dorado): "💬 Comentario
  del atleta:" + texto gris claro + "— {nombre} · {fecha}" (`fmtDate`). En programas grupales no aparece.
- **Feature 2 — Imágenes en comentarios de bloque (`app/dashboard.html`, Mi programa):** hasta 5 por
  bloque. En el editor de comentario, botón "📷 Agregar fotos" (input global `#blockImgInput`,
  `image/*` múltiple) → previews 80px (`.cmt-prev`) con × para quitar (`blockImgCtx`, `b._pendingFiles`,
  object URLs revocadas). Al **Guardar**: se asegura la completion, luego `uploadImages('block-images',
  '{athlete_id}/{block_id}', files)` (Storage) + INSERT en `block_images` (`completion_id, athlete_id,
  storage_path`). Las subidas se muestran en `.pb-imgs` (miniaturas `.pb-img` clickeables → **modal de
  imagen** `#imgModal`, con × `.pb-img-x` para borrar = Storage `.remove` + DELETE tabla). `loadProgramaDay`
  carga las imágenes por `completion_id`. Límite 5 (uploaded+pending) con toast si se supera.
- **Feature 3 — Imágenes en posts de comunidad (`app/dashboard.html`, Comunidad):** hasta 5 por post. En
  el modal de nueva publicación, "📷 Agregar fotos" (`#npImgInput`) → previews `#npPreview` con × (estado
  `npPendingFiles`/`npPrevUrls`). Al **Publicar**: INSERT `community_posts` → `uploadImages(
  'community-images', '{author_id}/{post_id}', files)` + INSERT `community_images` → `data.images` se
  prepende con el post. `loadComFeed` y `onNewPost` (realtime) cargan las imágenes por `post_id`.
  `postCardHtml` las muestra en `.com-imgs` (grilla `repeat(min(3,n),1fr)`) → click abre el modal de imagen.
- **Helpers compartidos** (`app/dashboard.html`): `publicUrl(bucket,path)` (getPublicUrl), `safeFileName`
  (timestamp+rand+ext), `uploadImages(bucket,prefix,files)`, y **modal de imagen** `#imgModal`
  (`openImageModal`/`closeImageModal`). Todo degrada en silencio si falta bucket/tabla (toast al fallar).
- **🐛 Bug preexistente corregido**: había **dos** `function commentHtml` en `dashboard.html` (una para el
  comentario de bloque, otra para el comentario de comunidad); la segunda **pisaba** a la primera, así que
  la sección de comentario del bloque renderizaba el markup equivocado. Se renombró la de comunidad a
  **`comCommentHtml`** (y sus 2 usos). Ahora cada una funciona.
- **Verificado** en el navegador con 2 harness temporales (fake de Supabase con DB en memoria **+ Storage
  simulado** (`upload`/`remove`/`getPublicUrl`) + embeds `!fk`, ya borrados; **sin errores de consola**):
  - **Dashboard**: Mi programa — el comentario del bloque ahora renderiza bien ("Me costó el último set"),
    galería con 1 imagen previa; abrir editor → "Agregar fotos" → 2 previews → Guardar → galería 3, DB
    `block_images` 3, Storage 2 subidas bajo `ath-1/b1/...`; click miniatura → modal (src del bucket);
    eliminar × → galería 3→2 + DB 3→2; tope de 5 (con 2 subidas, agregar 6 → 3 previews + toast "Solo podés
    agregar 3…"). Comunidad — feed con post de 1 imagen (grilla) + click → modal; nueva publicación con 2
    fotos → post prepend con 2 imágenes, DB `community_images` 3, Storage 2.
  - **Admin**: entrar al editor de la asesoría de "Lucía Fernández" → el bloque muestra `.athlete-comment`
    solo-lectura: "💬 Comentario del atleta:" + "Terminé cansada pero contenta 💪" + "— Lucía Fernández ·
    23/07/2026" (nombre resuelto por embed). Sin campos editables en la sección.
  - Ambos archivos reales pasan `new Function` (syntax OK). ⚠️ Pendiente en Supabase: policies de Storage
    y de las tablas `block_images`/`community_images` (ver sección arriba).

### 2026-07-22
- **Sistema de notificaciones en tiempo real (campana 🔔) en `app/dashboard.html` + `admin/index.html`.**
  Nueva tabla `notifications` (SQL arriba). Mismo componente y estética en los dos portales.
  - **UI**: campana en la topbar (dashboard: entre nombre y avatar, reestructuré el lado derecho a
    `.topbar-right` con nombre + campana + avatar; admin: en `.topbar-right` junto al "Hola, [nombre] 👋").
    Badge rojo con count de no leídas (`.notif-badge`, oculto si 0, animación `pop` al entrar una nueva).
    Dropdown `.notif-dd` (320px, máx 400px scroll, `#1A1A1A`/borde `#333`/radius 12px, sombra) con header
    "Marcar todas como leídas" + lista. Cada `.notif-item`: ícono por tipo + título + body + fecha relativa
    (`fmtRelative`; se agregó ese helper al admin, que no lo tenía); **no leída = fondo `#222`**. Vacío →
    "No tenés notificaciones nuevas". Cierra al clickear fuera (listener global con `.notif-wrap` guard).
  - **JS común** (`loadNotifs`/`renderNotifs`/`updateNotifBadge`/`prependNotif`/`onNotifItemClick`/
    `markAllNotifsRead`/`subscribeNotifs`/`notify`): en `init()` carga las 30 últimas del usuario y se
    suscribe. **Realtime**: `sb.channel('notifs_'+uid).on(postgres_changes INSERT, filter user_id=eq.uid)`
    → `prependNotif` (dedupe por id + badge). Click en notif → `UPDATE read=true` (por id) + `notifNavigate`
    (mapea el `link` a `showView`: dashboard `#programa/#mensajes/#comunidad`; admin `#mensajes/#alumnos`).
    "Marcar todas" → `UPDATE read=true WHERE user_id=uid AND read=false`. `notify(userIds, payload)` inserta
    una fila por destinatario y **degrada en silencio** si la tabla no existe (console.warn, no rompe).
  - **5 disparadores**:
    1. **message** — `sendChatMessage` (atleta) → `notify(getAdminIds(), …)`; `sendMessage` (admin) →
       `notifyChannelAthletes(canal)` (`dm_<id>` → ese atleta; slug grupal → todos los `athlete` del programa).
    2. **planning** — `enterPrograma` → `maybeNotifyTodayPlanning` (si hoy hay sesión con bloques y no se
       avisó hoy — dedupe consultando `notifications` por `type='planning'` + `created_at>=hoy`). Optimista
       (prepend del row insertado, realtime deduplica).
    3. **like** — en `toggleLike`, al insertar el like (post ajeno) → `notify(p.author_id, …)`.
    4. **comment** — en `sendComment` (post ajeno) → `notify(p.author_id, …)`.
    5. **new_athlete** — en el handler de "Asignar atleta", tras `result.ok` → `notify(getAdminIds(), …)`.
  - **Verificado** con dos harness temporales (fake de Supabase con DB en memoria + **Realtime simulado** +
    `fetch` stub para `create-athlete`, ambos borrados; **sin errores de consola**):
    - **Dashboard** (atleta ath-1, 2 no leídas + 1 leída seed): badge "2", 3 items, íconos correctos
      (💬 message primero), fecha "hace 5 min", dropdown abre/cierra; click en no leída → navega a
      `view-mensajes` + badge 2→1 + `read=true` en DB; realtime INSERT → badge 1→2 + item prepend arriba;
      "Marcar todas" → badge oculto + 0 no leídas + DB 0 + botón disabled; click afuera cierra; **enviar
      chat** → notif `message` creada para adm-1 (title "Nuevo mensaje de Juan Pérez", body, link #mensajes).
    - **Admin** (adm-1, 1 no leída seed): badge "1", ícono 👤 new_athlete, click → navega a `view-alumnos`
      + badge oculto; realtime INSERT → badge vuelve a 1; **Asignar atleta** (fetch stub ok, coach Gonza) →
      notif `new_athlete` para adm-1 ("Pedro Díaz se unió a Asesoría Gonza", link #alumnos); **enviar mensaje**
      al canal grupal `crossfit` → notifs `message` para **ambos** atletas del programa (ath-1, ath-2).
  - Los archivos reales (`admin/index.html` y `app/dashboard.html`) pasan `new Function` (syntax OK) y sin
    stub redirigen al login (guard OK). ⚠️ Pendiente en Supabase: crear `notifications` + policies + **Realtime**.

- **Creado `app/set-password.html` — activación de cuenta del atleta nuevo** (misma identidad visual
  que `login.html`: #0A0A0A / card #1A1A1A / #F5A800 / Inter + Playfair; logo `../logo.png` con
  fallback a texto; CDN Supabase + `../supabase.js`).
  - **Una sola card con 4 estados** (`.state` + `showState()`): (1) **cargando** (spinner grande +
    "Un momento… / Verificando tu invitación"); (2) **formulario** ("Activá tu *cuenta*" + subtítulo,
    campos "Nueva contraseña" con hint "Mínimo 8 caracteres" + "Repetir contraseña", botón dorado
    "ACTIVAR CUENTA", bloques de error rojo / éxito verde); (3) **link inválido/expirado** (⚠️ +
    "Este link ya fue usado o expiró. Contactá a tu coach." + botón WhatsApp outline dorado a
    `wa.me/5491136433379`, target _blank); (4) **éxito** (✅ "¡Bienvenido/a!" + "Tu cuenta está activa.
    Redirigiendo…").
  - **Detección del token** (`detectInvite`): `getSession()` (Supabase parsea el hash solo via
    `detectSessionInUrl`) → si hay sesión, muestra el form; si no, **parseo manual del hash**
    `#access_token=...&refresh_token=...` con `sb.auth.setSession(...)`, y si el hash trae
    `error`/`error_description` → estado inválido; si en ~4 s no hubo sesión ni token → estado inválido.
    Además escucha `sb.auth.onAuthStateChange` (marca listo si llega una sesión). Guard `resolved`
    para no resolver dos veces.
  - **Crear contraseña** (submit): valida `length >= 8` y coincidencia (error rojo si no), botón con
    spinner + "Activando…", `await sb.auth.updateUser({ password })`. Si error de sesión/JWT/token
    expirado → estado inválido; otro error → mensaje rojo y rehabilita el botón. Si OK → mensaje verde
    "¡Cuenta activada! Redirigiendo…" + estado éxito → `window.location.href='dashboard.html'` a los 2 s.
  - **No necesita tablas nuevas** (usa solo Supabase Auth). Cierra el flujo de alta: `create-athlete`
    manda el invite → este page crea la contraseña → `dashboard.html`. También es el `redirectTo` de
    "Cambiar contraseña" (Perfil) y "¿Olvidaste tu contraseña?" (login).
  - **Verificado en el navegador** (file://, sin token; sin errores de consola): CDN + `supabase.js`
    cargan (`sb` disponible); sin token en la URL el page arranca en "cargando" y cae a **inválido** a
    los 4 s (heading "Link no válido", WhatsApp `https://wa.me/5491136433379` target _blank);
    **formulario** → validación de longitud ("La contraseña debe tener al menos 8 caracteres.") y de
    coincidencia ("Las contraseñas no coinciden."); **éxito** (stub de `updateUser` OK) → mensaje verde
    inline + estado ✅ + redirect a `dashboard.html` programado a 2 s. (Los screenshots del pane
    timeouteaban por la animación del spinner; se verificó todo con JS/estado del DOM.)

### 2026-07-21
- Proyecto Supabase creado (hb-performance, São Paulo)
- CLAUDE.md redactado con arquitectura completa
- **Creado `supabase.js`** en la raíz: expone cliente global `sb` con la URL + publishable key.
  Requiere que el CDN de Supabase se cargue ANTES (usa `supabase.createClient`).
- **Creado `app/login.html`**: página de login con identidad visual de la landing
  (fondo #0A0A0A, card #1A1A1A, acento #F5A800, Inter + Playfair Display).
  - Logo `../logo.png` centrado con fallback a texto "HB *Performance*".
  - Card: título "Accedé a tu *portal*", campos email + contraseña, botón dorado "Ingresar",
    link "¿Olvidaste tu contraseña?", bloque de error en rojo. Responsive y centrado vertical/horizontal.
  - JS: incluye CDN `@supabase/supabase-js@2` + `../supabase.js`.
    Login vía `sb.auth.signInWithPassword()` → lee `profiles.role` → admin va a `../admin/index.html`,
    athlete a `dashboard.html`. Al cargar chequea sesión activa (`sb.auth.getSession()`) y redirige.
    "Olvidaste tu contraseña" usa `sb.auth.resetPasswordForEmail()` → `set-password.html`.
  - Verificado en navegador (servido por HTTP local): render OK, sin errores de consola
    (CDN + supabase.js cargan bien) y el path de error muestra "Email o contraseña incorrectos."
- **Creado `admin/index.html`**: panel de administración (Erika y Gonza), estilo de la landing
  (fondo #0A0A0A, cards #1A1A1A, acento #F5A800, Inter + Playfair).
  - **Layout sidebar fija + main.** Sidebar (250px) con logo `../logo.png` (fallback a texto),
    nav: 📊 Dashboard (activo) · 📅 Planificación · 👥 Alumnos · 💬 Mensajes · 📈 Métricas, y botón
    "Cerrar sesión" abajo. En ≤860px la sidebar se oculta y aparece hamburguesa (☰) con overlay.
    Links nav → `planificacion.html`, `alumnos.html`, `mensajes.html`, `metricas.html` (aún no creados).
  - **Dashboard (vista por defecto):** 4 cards de resumen — Total alumnos (count profiles role=athlete),
    Alumnos activos (subscription_status=active + % del total), Por programa (breakdown con labels lindos),
    Mensajes sin leer (count messages to_id=admin, read=false). Debajo: tabla de los 5 alumnos más
    recientes (Nombre, Email, Programa, Suscripción con badge de color, Registro con fecha es-AR).
  - **JS:** CDN Supabase + `../supabase.js`. Guard en `init()`: `getSession()` → sin sesión o
    role≠admin ⇒ `location.replace('../app/login.html')`. Carga datos reales con queries `count`
    (head:true) y `.order().limit(5)`. Salida escapada con `esc()`. Logout: `sb.auth.signOut()` → login.
  - Verificado en navegador (HTTP local, sin sesión): el guard redirige correctamente a login,
    sin errores de consola. La vista logueada (cards+tabla) no se pudo renderizar aún: faltan
    cuenta admin y tablas en Supabase. El código degrada a 0 / estados vacíos si no hay datos.
- **`admin/index.html` — Sección Planificación (SPA dentro del panel)**:
  - **Nav ahora es SPA:** los links "Dashboard" y "Planificación" (con `data-view`) cambian de
    vista dentro de la misma página (`showView()`), sin recargar. Alumnos/Mensajes/Métricas siguen
    como links a sus páginas (aún no creadas). El título del topbar se actualiza por vista.
  - **Vista Planificación — pasos internos** (`showPlanStep`): `home` → `programas`/`asesorias` → `editor`.
    - **Home:** dos botones grandes (cards con hover dorado): 📅 Programas · 👤 Asesorías.
    - **Programas:** header con "+ Crear programa" (modal: nombre + descripción → `INSERT programs`,
      slug = `slugify(nombre)` sin acentos/espacios; maneja duplicado 23505). Lista `SELECT * FROM
      programs`. Cada item: nombre + descripción + "📅 Planificar" (abre editor grupal) + "🗑️ Eliminar"
      (confirm → DELETE). 
    - **Asesorías:** header con "+ Asignar atleta" (modal: nombre, email, teléfono opc., coach
      Erika/Gonza → `INSERT profiles` role=athlete, program=`asesoria-erika|gonza`, status=active).
      Lista `SELECT profiles WHERE program IN (asesoria-erika,asesoria-gonza)`. Item: nombre, email,
      programa + badge estado + "📅 Planificar" (editor personal) + "🗑️ Eliminar".
  - **Editor de bloques (compartido grupos/asesorías)** `editorCtx = {programSlug, athleteId,
    title, subtitle, returnStep}`:
    - Header: título + subtítulo + selector de fecha (default hoy, `todayStr()` en local) + "← Volver".
    - `loadDay()`: busca `planning_days` por program_slug+date (+ athlete_id si es asesoría). Grupales
      NO filtran por athlete_id (así funcionan aunque la columna no exista todavía). `ensureDay()`
      crea el día lazy al agregar el primer bloque (con `created_by` = admin; athlete_id si aplica).
    - Bloques (`planning_blocks`, ordenados por `order`): card #1A1A1A borde-izq dorado. Título
      editable inline (dorado), textarea auto-resize (fondo #0D0D0D), campo URL YouTube → extrae
      video ID (`ytId`, soporta watch?v=, youtu.be, shorts, embed) y muestra iframe embed responsive.
      Botones ↑ ↓ (swap `order` + persist) · 🗑️ (confirm → DELETE). Colapsar/expandir clickeando el
      header (respeta clicks en título/acciones). **Guardado automático con debounce 1s** (`scheduleSave`
      → UPDATE), con indicador por bloque (Editando…/Guardando…/Guardado ✓/Error).
  - **Verificado en navegador** con un harness temporal (`_verify_tmp.html`, ya borrado) que
    stubbea Supabase para saltar el guard: sin errores de consola; probado end-to-end vía JS —
    render del dashboard, switch de vistas, sub-vistas programas/asesorías con datos, modales +
    validación (nombre vacío muestra error), apertura de editor (título/subtítulo/fecha correctos),
    agregar bloque, auto-resize del textarea (creció a 121px), embed de YouTube (watch?v= y youtu.be),
    colapsar/expandir, indicador de guardado, reordenar (↓) y eliminar bloque (2→1). El archivo real
    `index.html` cargado sin stub redirige bien a login (guard OK) y no arroja errores de parseo.
- **`admin/index.html` — "Asignar atleta" ahora usa la Edge Function `create-athlete`** (antes hacía
  `INSERT` directo en `profiles`, que rompía por la FK `id → auth.users`):
  - El handler hace `fetch` POST a `https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/create-athlete`
    con headers `Content-Type: application/json` y `Authorization: Bearer <access_token de la sesión>`
    (obtenido con `sb.auth.getSession()`), y body `{ full_name, email, phone, program }`
    (program = `coach.slug`, o sea `asesoria-erika` / `asesoria-gonza`).
  - Lee `result = await response.json()`: si `!result.ok` muestra `result.error` en el bloque de error
    del modal (y lo deja abierto); si ok, cierra el modal y recarga la lista (`loadAthletes()`).
  - **Loader en el botón "Asignar"** mientras procesa: se deshabilita y muestra spinner CSS
    (`.spinner`, keyframes `spin`) + "Asignando…". Se restaura en `finally` (label "Asignar").
  - `try/catch/finally` para manejar errores de red (muestra "Error de red…") y siempre restaurar
    el botón. La validación previa (nombre/email vacíos) sigue igual y evita la llamada.
  - **Verificado** con harness temporal (stub de Supabase + de `fetch`, ya borrado): caso OK →
    URL/method/headers/body correctos (Bearer con el token de sesión, program=asesoria-gonza),
    loader visible durante la llamada, modal cerrado y botón restaurado; caso error (`ok:false`) →
    muestra `result.error`, modal queda abierto, botón restaurado; validación de nombre vacío no
    dispara fetch. Sin errores de consola.
    (Nota: el `</script>` dentro de strings JS del harness debe escaparse como `<\/script>` o el
    parser HTML corta el script; se documenta por si se rearma el harness.)
- **`admin/index.html` — Editor de planificación mejorado (4 features, grupos + asesorías)**:
  - **1. Vista día / Vista mes.** Toggle `.view-toggle` (`setEditorMode`). Vista mes = calendario
    Lun-Dom (`renderMonth`) con navegación ← → (`shiftMonth`), punto dorado en días con planificación
    (`loadMonth`: `SELECT date FROM planning_days` por program_slug + rango del mes [+ athlete_id]).
    Click en un día → `goToDay` (vista día con esa fecha). Marca "hoy" con borde dorado.
  - **2. Copiar / pegar día (memoria).** `copiedDay` global (bloques + ejercicios). Barra de día:
    "📋 Copiar día" / "📌 Pegar día" (este último aparece solo si hay algo copiado). En vista mes, cada
    celda con planificación tiene ⋮ y también click derecho → menú `#dayCtxMenu` (Copiar / Pegar en
    este día). `pasteIntoDate` hace `ensureDayForDate` + INSERT de bloques nuevos (orden al final) +
    INSERT de sus `exercise_links`. Refactor: `dayFilter`/`findDay`/`ensureDayForDate` trabajan con
    cualquier fecha (antes atados al date input).
  - **3. Ejercicios linkeados por bloque** (tabla `exercise_links`). Se **reemplazó** el campo YouTube
    por bloque por una sección "Ejercicios": chips `[🎥 nombre ×]`; "+ Agregar ejercicio" abre mini-panel
    inline (nombre + URL + "🔍 Buscar en YouTube" + "Guardar ejercicio"). Guardar → INSERT; click en chip
    → modal con embed (`ytEmbedHtml`, se frena el video al cerrar); × → DELETE. Se cargan con
    `attachExercises` (un `.in('block_id',...)` por día) y se copian al duplicar días.
  - **4. Buscador de YouTube** (`#modalYtSearch`, `runYtSearch`): GET a YouTube Data API v3
    (`part=snippet&type=video&maxResults=8`), grilla 2 col con thumbnail/título/canal + spinner +
    mensaje si no hay resultados. "Usar este video" completa la URL (`watch?v=ID`) y el nombre si está
    vacío, y cierra el modal. `YT_API_KEY` hardcodeada (ver nota de seguridad arriba).
  - **Verificado** con harness temporal (`_verify_tmp.html`, ya borrado) con un **fake de Supabase con
    DB en memoria** + stub de la YouTube API; probado end-to-end vía JS, sin errores de consola:
    agregar bloque, sección ejercicios (sin el viejo campo YT), abrir mini-panel, buscar en YT (2 cards
    con título/canal), "Usar este video" (rellena URL + autocompleta nombre), guardar ejercicio (chip +
    fila en `exercise_links`), abrir embed del chip (iframe correcto, se limpia al cerrar), copiar día
    (toast + botón pegar aparece) y pegar en otra fecha (bloques + ejercicios duplicados en la DB),
    vista mes (título "Agosto/Julio 2026", puntos en días planificados, alineación de semana correcta:
    1/jul/2026 = miércoles → 2 celdas vacías), navegación de meses, click en día → vista día, y menú
    contextual (⋮ en día con plan; click derecho en día vacío ofrece solo Pegar; pegar crea el día y
    aparece el punto). El `index.html` real (sin stub) parsea OK y el guard redirige a login.
- **`admin/index.html` — Copiar / pegar SEMANA completa en la vista mes**:
  - El **calendario se reestructuró** a grilla de 8 columnas: un *gutter* de semana a la izquierda de
    cada fila (`grid-template-columns: 30px repeat(7,1fr)`; 22px en mobile). Cada gutter tiene un
    botón ⋮ (`.week-menu-btn`, `data-weekmon` = lunes de esa semana). `renderMonth` ahora arma los
    slots (vacíos + días), los completa hasta múltiplo de 7 y los parte en semanas; el lunes de cada
    fila se calcula con `addDaysStr(primerDíaDeLaFila, -índice)` (helper nuevo, seguro contra timezone).
  - **Menú de semana** `#weekCtxMenu` (misma estética `.day-ctx-menu`): "📋 Copiar semana" (siempre) y
    "📌 Pegar semana aquí" (solo si hay `copiedWeek`). `openWeekMenu`/`openDayMenu` se cierran mutuamente;
    el listener global de "click afuera" cierra ambos.
  - **`copiedWeek`** (memoria, se pierde al recargar) = `{ days:[{offset:0..6, blocks:[...]}] }`.
    `copyWeek(weekMon)` recorre Lun..Dom, y por cada día con bloques snapshotea bloques + ejercicios
    (reusa `snapshotFromBlocks`/`attachExercises`). Salta los días vacíos.
  - `pasteWeekInto(destMon)`: para cada día copiado calcula `destDate = addDaysStr(destMon, offset)`
    (mantiene la **correspondencia Lun→Lun, Mar→Mar…**). Si **algún** día destino ya tiene bloques,
    abre el modal **`#modalPasteMode`** ("¿Reemplazar o agregar?") vía `askPasteMode()` (Promise que
    resuelve `'replace'|'add'|null`). `replace` → borra los bloques del día destino (el `on delete
    cascade` de `exercise_links` limpia los ejercicios) y luego inserta; `add` → inserta al final del
    `order` existente. Cancelar no toca nada. Al terminar refresca el calendario (`loadMonth`).
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria, ya borrado; sin errores de
    consola): gutters con los lunes correctos (jun29/jul06/13/20/27), copiar semana (3 días/4 bloques),
    pegar en semana vacía siguiente → días creados con correspondencia exacta (Lun→27, Mié→29, Vie→31;
    martes queda vacío) y bloques+ejercicios duplicados en la DB; pegar sobre semana ocupada → modal:
    **Agregar** (2→4 bloques), **Reemplazar** (4→2), **Cancelar** (sin cambios). Regresión OK: el menú de
    día sigue funcionando, cierre mutuo de menús, click afuera cierra, y click en día → vista día. El
    `index.html` real (sin stub) parsea OK y el guard redirige a login.
- **`admin/index.html` — Sección ALUMNOS** (vista SPA `#view-alumnos`; el link del sidebar pasó de
  `href="alumnos.html"` a `data-view="alumnos"`; `showView('alumnos')` llama `loadAlumnos()`):
  - **Header** con título "Alumnos" + buscador (`#alSearch`) que filtra por nombre o email en tiempo
    real (sobre el array en memoria). En mobile el buscador va full-width.
  - **Tabs de estado** (`#alTabs`): Activos / Inactivos / Todos, cada uno con su count entre
    paréntesis (calculado del array total). Activo = `subscription_status='active'`; Inactivo =
    `cancelled` o `pending`. Debajo, **filtro por programa** (select: Todos / Crossfit / Hybrid /
    Corredores / Asesoría Erika / Asesoría Gonza). Filtros y buscador operan en memoria.
  - **Tabla** (`SELECT * FROM profiles WHERE role='athlete' ORDER BY created_at DESC`): Nombre, Email,
    Teléfono, Programa (badge de color por programa: crossfit azul #1a3a5c, hybrid verde #1a3a2a,
    corredores naranja #3a2a1a, erika púrpura #2a1a3a, gonza rosa #3a1a2a), Estado (badge Activo=verde
    / Cancelado=**gris** / Pendiente=amarillo — labels masculinos, clases `.st-badge`), Tipo (badge
    "Programa" o "Asesoría"; asesoría = `program IN (asesoria-erika, asesoria-gonza)`), Inicio, y
    Acciones "👁️ Ver" (+ "🚫 Dar de baja" en asesorías activas).
  - **Panel lateral slide-in** (`#sidePanel`, 420px desktop / full-width mobile, overlay + transición
    0.3s): nombre + email, badges (programa/estado/tipo), datos (teléfono, fecha inicio, fecha
    vencimiento, ID suscripción MP si tiene), **últimos 3 días con planificación** (query
    `planning_days` por program_slug [+ athlete_id si asesoría]), y botones: "📅 Ir a planificación"
    (`goToAthletePlanning` → cambia a la vista Planificación y abre el editor del atleta: `athleteId`
    seteado si es asesoría, `null` si es programa grupal), "✏️ Editar" (form inline: nombre, teléfono,
    subscription_status → UPDATE), "🚫 Dar de baja manual" (solo asesoría activa → confirm → UPDATE
    status='cancelled'), "🗑️ Eliminar" (solo si status='cancelled' → confirm "…se eliminarán
    permanentemente." → DELETE profiles, cascade), y "❌ Cerrar".
  - **Fix de fechas:** las columnas DATE (`subscription_start`/`end`) se muestran con `fmtDayOnly`
    (parsea el string 'YYYY-MM-DD' sin pasar por `new Date` UTC) para evitar el desfase de -1 día que
    tenía `fmtDate` en fechas sin hora.
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria, ya borrado; sin errores
    de consola): counts (3 activos / 2 inactivos / 5 total), tabs, filtro por programa y búsqueda por
    nombre y por email; panel con badges/datos/recientes correctos y botones según estado; editar
    (guarda en DB + refresca tabla y panel), dar de baja (active→cancelled, aparece Eliminar),
    eliminar (borra de la DB y cierra panel), "Ir a planificación" (abre editor con el título/subtítulo
    correctos, athleteId según tipo). Mobile: panel full-width, tabla con scroll horizontal, buscador
    full-width. El `index.html` real (sin stub) parsea OK y el guard redirige a login.
- **`admin/index.html` — Sección MENSAJES (chat en tiempo real con Supabase Realtime)** (vista SPA
  `#view-mensajes`; el link del sidebar pasó de `href="mensajes.html"` a `data-view="mensajes"`;
  `showView('mensajes')` llama `loadMensajes()` y al salir hace `unsubscribeRealtime()`):
  - **Layout 2 columnas.** Izquierda (280px, fondo #111111): sección **Programas** (canales grupales,
    `SELECT * FROM programs ORDER BY name`, ícono 👥, `channel = slug`) y sección **Asesorías**
    (`SELECT profiles WHERE program IN (asesoria-erika,asesoria-gonza) AND subscription_status='active'`,
    ícono 👤 + badge de coach Erika/Gonza, `channel = 'dm_' + athlete_id`). Cada canal con badge de
    no leídos. Canal activo: fondo #1A1A1A + borde izq dorado. Derecha (fondo #0D0D0D): ventana de chat.
  - **Ventana de chat:** header con nombre + subtítulo ("Chat grupal · N miembros" contando
    `profiles` del programa, o "Asesoría Erika · email"), área de mensajes (scroll, nuevos abajo),
    input + botón Enviar + Enter para enviar. Cada mensaje: avatar con iniciales, nombre, texto, hora.
    **Míos (admin) a la derecha en dorado**, ajenos a la izquierda en gris (`.msg-row.mine`).
  - **Cargar mensajes:** `select('..., sender:profiles!from_id(full_name, role)').eq('channel',X)
    .order('created_at', desc).limit(50)` y se invierte → los 50 más recientes en orden cronológico.
  - **Enviar:** `INSERT messages (from_id=admin, channel, content)` (sin `to_id`). Se agrega de forma
    **optimista** y el evento realtime se **deduplica por id** (`renderedIds`), así funciona tenga o no
    Realtime habilitado.
  - **Realtime:** al abrir un canal, `sb.channel('chat_'+canal).on('postgres_changes', {event:INSERT,
    table:messages, filter:channel=eq.X}, appendMessage).subscribe()`. Al cambiar de canal o salir de
    la vista → `sb.removeChannel(...)`.
  - **Marcar leído:** al abrir un canal, `UPDATE messages SET read=true WHERE channel=X AND
    from_id!=admin AND read=false` → limpia el badge. Un mensaje entrante en el canal abierto se marca
    leído al vuelo.
  - **Responsive:** en ≤860px la lista de canales ocupa toda la pantalla; al elegir un canal el layout
    hace slide a la ventana de chat (clase `.chat-open`) con botón "←" para volver. Al (re)entrar a la
    vista se resetea el estado (sin canal activo, se ve el placeholder / la lista).
  - **Colateral:** el modelo pasó de `to_id` a `channel`. Se actualizó la card "Mensajes sin leer" del
    dashboard: ahora cuenta `read=false AND from_id != admin` (antes filtraba por `to_id`), y su
    subtítulo dice "De alumnos". Se guarda `CURRENT_ADMIN_NAME` en `init()` para las burbujas propias.
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + **Realtime simulado** +
    embed `!from_id` + `.neq`, ya borrado; sin errores de consola): listas de canales (programas +
    solo asesorías activas, Sofía cancelada excluida) con badges de no leídos (crossfit=1, dm_a2=1);
    abrir canal grupal (header "Chat grupal · 1 miembro", mensajes con alineación propia/ajena,
    avatares con iniciales, marcar leído + badge a 0); enviar (DB +1, DOM +1 sin duplicar por dedupe,
    input limpio, burbuja dorada a la derecha); mensaje entrante por realtime (aparece a la izquierda +
    se marca leído); cambio de canal (unsubscribe del anterior, subtítulo "Asesoría Erika · email");
    salir de la vista → unsubscribe total; mobile (canales full-width, slide a chat, botón volver,
    reset al reentrar). El `index.html` real (sin stub) parsea OK y el guard redirige a login.
- **`admin/index.html` — Sección MÉTRICAS** (vista SPA `#view-metricas`; el link del sidebar pasó de
  `href="metricas.html"` a `data-view="metricas"`; `showView('metricas')` llama `loadMetricas()`):
  - **Header** con título + **selector `<input type="month">`** (`#metMonth`, default mes actual). Al
    cambiar → `loadMetricas()` recalcula todo. Separadores por sección con título en dorado
    (`.met-section-title`, borde superior).
  - **Sección 1 — Ingresos** (3 cards estilo dashboard): precios hardcodeados en `PRICES`
    (crossfit/hybrid $45.000, corredores $40.000 ARS; asesorías USD 150). Ingresos ARS = Σ activos por
    su precio ARS; Ingresos USD idem USD; Alumnos activos = count. (Se calculan sobre los **activos
    actuales** — no hay histórico de estado por mes, así que el selector no cambia esta sección.)
  - **Sección 2 — Distribución por programa:** barras CSS horizontales (`.met-bars`/`.bar-*`, relleno
    dorado) con % de alumnos activos por programa, ordenadas desc. Sin librerías.
  - **Sección 3 — Evolución 6 meses:** tabla Mes | Altas | Bajas | Total activos. Altas = profiles
    creados ese mes (`created_at` en `[inicio, siguiente)`); **Bajas = N/D** (no hay fecha de baja aún,
    badge gris + nota al pie); Total activos = activos hoy creados hasta el cierre de ese mes. La
    ventana de 6 meses termina en el mes seleccionado.
  - **Sección 4 — Top 5 activos:** `block_completions` con embed `athlete:profiles!athlete_id(...)`,
    agrupado en JS por atleta → Nombre | Programa (badge) | Bloques completados | Último acceso.
    ⚠️ El spec pedía "último created_at" pero `block_completions` tiene **`completed_at`** (no
    `created_at`): el front usa `completed_at || created_at` (select `*`), así funciona con el esquema
    real. Es all-time (no depende del mes).
  - **Sección 5 — Actividad de chats:** `messages` del mes (`gte(inicio).lt(siguiente)`) agrupado por
    `channel`, top-3 con barra CSS (relativa al máximo). Nombre de canal: programa (`👥 label`) o DM
    (`💬 nombre` resolviendo el athlete_id).
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + embeds `!fk` + `.lt`, ya
    borrado; sin errores de consola): ingresos ($130.000 ARS / USD 300 / 5 activos con el seed),
    distribución (5 programas 20% c/u), evolución (altas y total activos acumulado correctos por mes,
    bajas N/D), top-5 (Lucía 5 / Juan 3 / Ana 1 con último acceso y badges), actividad de chats
    (CrossFit 4=100%, DM Ana 3=75%, Hybrid 2=50%; excluye mensajes de otro mes). Cambiar el mes
    recalcula evolución y chats (junio → 1 chat; febrero → "sin actividad"); ingresos quedan sobre
    activos actuales. Mobile: cards en 1 columna, barras sin overflow, tabla con scroll, selector
    full-width. El `index.html` real (sin stub) parsea OK y el guard redirige a login.
- **`admin/index.html` — Sección CONFIGURACIÓN** (vista SPA `#view-config`, ⚙️ en el sidebar;
  `showView('config')` → `loadConfig()`) + **integración con las 3 landing de programa**:
  - **3 cards oscuras** (`.cfg-card`, título dorado): **Precios** (ARS+USD por crossfit/hybrid/
    corredores, USD para asesorías), **Links de pago** (MP + PayPal por programa grupal), **Contacto**
    (WhatsApp Erika/Gonza con prefijo visual "+54"). Inputs fondo #1A1A1A, borde dorado al focus.
  - **Guardar** por sección → `sb.from('site_config').upsert(rows, {onConflict:'key'})` (incluye
    `updated_at`). Feedback: el botón pasa a **"✓ Guardado"** (verde) 2s y se restaura. `loadConfig`
    llena los inputs desde `site_config`.
  - **WhatsApp:** se guarda el número completo con código de país (54…); en el input se muestra **sin**
    el 54 (`stripCC`) y al guardar se re-agrega (`addCC`, normaliza para no duplicar el 54).
  - **Landing (`crossfit.html` / `hybrid.html` / `fuerza-corredores.html`):** se agregaron ids
    (`#precio-ars`, `#precio-usd`, `#btn-mp`, `#btn-paypal`, `#btn-whatsapp`) y un `<script>` al pie que
    incluye el CDN de Supabase + `supabase.js` (raíz) y, al cargar, lee `site_config` y setea precios
    (con `toLocaleString('es-AR')`, preservando el `<span class="per">`), hrefs de MP/PayPal, texto de
    los botones, y WhatsApp (`https://wa.me/${whatsapp_erika}`). Todo en try/catch: si Supabase no
    responde, quedan los valores por defecto del HTML (la landing sigue funcionando offline).
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + `upsert`, ya borrado; sin
    errores de consola): admin carga los 15 valores (WhatsApp sin el 54, "+54" visible), guarda precios/
    links/contacto (upsert sin duplicar filas — quedan 15; whatsapp '91155559999' → '5491155559999';
    botón "✓ Guardado" y revert a los 2s). Landing (crossfit con config stub): precios "$50.000 / mes" /
    "USD 48 / mes", botones con href y texto de config, WhatsApp `wa.me/549…`. Carga real de las 3
    landing sin stub: sin errores, mantienen defaults (crossfit 45k/40, corredores 40k/35). El
    `admin/index.html` real parsea OK y el guard redirige a login.
- **Creado `app/dashboard.html` — portal del atleta** (mismo estilo: #0A0A0A / #F5A800 / Inter +
  Playfair). SPA sin sidebar:
  - **Topbar fija** (logo `../logo.png` con fallback a texto + nombre del atleta + avatar con iniciales,
    clickeable → tab Perfil). **Tabs de navegación**: fijas abajo en mobile (`.tabbar` fixed bottom,
    ícono sobre label), **sticky arriba bajo la topbar en desktop** (≥768px, en fila, centradas
    max-width 820). Tabs: Inicio / Mi programa / Estadísticas / Mensajes / Perfil (SPA `showView`).
  - **Guard** (`init`): `getSession()` → sin sesión → `login.html`; `profiles WHERE id=uid` (single);
    si `role='admin'` → `../admin/index.html`; si atleta guarda `ATHLETE` e `IS_ASESORIA`.
  - **Vista Inicio** (única desarrollada): saludo "Hola, [nombre] 👋"; card **HOY** (borde-izq dorado
    3px): fecha larga + programa + nº de bloques del día (`planning_days` de hoy vía `dayScope` +
    count de `planning_blocks`) con botón "Ver planificación de hoy →" (va a Mi programa), o "No hay
    sesión cargada para hoy 💤"; card **Tu semana** (7 círculos Lun-Dom, 36px: check dorado si hay ≥1
    `block_completions` ese día del atleta en la semana, borde dorado punteado = hoy); card **Próximos
    días** (3 `planning_days` futuros + count de bloques, una sola query `.in('day_id',...)`); card
    **Comunidad** (último `community_posts` del programa + botón que hoy hace un toast "próximamente"
    porque `comunidad.html` no existe aún).
  - `dayScope`: grupal filtra `program_slug`; asesoría además `athlete_id` (igual criterio que el admin).
    Las 4 vistas restantes son placeholders "Cargando…".
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria, ya borrado; sin errores de
    consola): saludo/nombre/avatar (JP), card HOY en sus dos ramas (con planificación → "Tenés 3 bloques"
    + botón; sin planificación → mensaje 💤), círculos de semana (días completados con check, hoy con
    borde punteado), próximos días (jue/sáb/mar con su nº de bloques), comunidad (preview del último post),
    navegación entre tabs y a Perfil (topbar + botón), toast de comunidad. Responsive: tabbar fija abajo
    en mobile (main con padding-bottom 96px) y sticky arriba en desktop (1100px). El `dashboard.html`
    real (sin stub) redirige a `login.html` sin sesión (guard OK) y no arroja errores de parseo.
  - ⚠️ Necesita **policies RLS del lado atleta** para leer planning_days/blocks/completions/community;
    sin ellas las cards muestran estados vacíos (degrada bien).
- **`app/dashboard.html` — Vista "Mi programa" completa** (tab 📅):
  - **Toggle Vista día / Vista mes** (`.view-toggle`, `setProgMode`). Al entrar al tab (`showView`
    → `enterPrograma`) carga la vista activa. `progDate` arranca en hoy; el botón "Ver planificación
    de hoy" de Inicio lo resetea a hoy antes de ir al tab.
  - **Vista día:** barra con ← → (`addDaysStr`) + label de fecha (`prettyLong`) + botón "Hoy".
    `loadProgramaDay`: `dayScope(planning_days).eq('date', progDate)` → si no hay, "No hay sesión para
    este día 💤"; si hay, `planning_blocks order by "order"` + `block_completions` del atleta
    (`.in('block_id', ids)`) + `exercise_links` (degrada si la tabla no existe). Se arma `progBlocks`
    con `.completion` y `.exercises`.
  - **Bloque** (card borde-izq dorado): título dorado + **checkbox custom "Completado"** (círculo 26px,
    relleno dorado + ✓ al completar). `toggleBlock` optimista: check → INSERT `block_completions`
    (athlete_id, block_id, completed_at=now()) `.select().single()`; uncheck → DELETE por
    athlete_id+block_id; revierte la UI si falla. Contenido `white-space:pre-line`. **Ejercicios**: chips
    `[🎥 nombre]` (delegación de eventos) → **modal de video** (`openVideo`/`ytId`, iframe 16:9, se limpia
    al cerrar). **Comentario** (`block_completions.comment`): "💬 Comentar" / "✏️ Editar" → textarea inline
    (Guardar/Cancelar). `saveComment`: si no hay completion, la crea (marca completado); si hay, UPDATE.
    Bloque completado: opacity 0.7 + título tachado. Todo con delegación en `#progBlocks`.
  - **Vista mes** (`loadProgramaMonth`/`renderProgMonth`): calendario Lun-Dom con nav ← →
    (`shiftProgMonth`). Carga `planning_days` del mes + cuenta bloques por día + completions del atleta →
    por día calcula total/completados. Colores: **verde #1a3a1a = todo completo** (completed>=total>0),
    **amarillo #3a3a1a = algunos** (completed>0), punto dorado = con planificación, borde punteado = hoy.
    Click en día → vista día de esa fecha.
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria, ya borrado; sin errores de
    consola): render de 3 bloques (uno completado con comentario + "Editar", otro con 2 chips de
    ejercicio + "Comentar", contenido con saltos de línea); **tildar** (INSERT + card done), **destildar**
    (DELETE + comentario desaparece), **comentar** un bloque sin completion (crea la completion, marca
    tildado, guarda el texto), **chip → modal** con `embed/<id>` correcto (se limpia al cerrar), nav de
    día (← → + "Hoy") y **día vacío** ("No hay sesión para este día 💤"); **vista mes** (título "julio
    2026", hoy=partial+borde punteado, ayer=full/verde, +2=partial/amarillo, dot) y click en día → vista
    día. Mobile: cards full-width, checkbox 26px, sin overflow. El `dashboard.html` real redirige a login
    sin sesión (guard OK) y no arroja errores de parseo.
  - ⚠️ RLS atleta necesaria: SELECT en planning_days/planning_blocks/exercise_links + INSERT/UPDATE/DELETE
    en `block_completions` (solo las propias, `athlete_id = auth.uid()`).
- **`app/dashboard.html` — Vista "Estadísticas" completa** (tab 📊):
  - **Header** con título "Mis estadísticas" + **selector de período** segmentado (Esta semana / Este
    mes / Últimos 3 meses). El período **solo afecta las 2 primeras cards** (sesiones/bloques); racha,
    adherencia (semana actual), historial (14 días) y logros (todo el historial) son fijos.
  - **Carga de datos** (`loadStatsData`, se re-consulta al entrar al tab): (1) TODAS las
    `block_completions` del atleta (`block_id, completed_at`) → `statsActiveDays` (por completed_at) +
    set de bloques completados; (2) `planning_blocks` con embed **`planning_days!inner(date,
    program_slug, athlete_id)`** filtrando por `program_slug` (+ `athlete_id` si asesoría) → `statsPerDate`
    = por fecha { total, completed }. El embed evita un `.in('day_id', [...])` gigante.
  - **Sección 1 (4 cards):** Sesiones (días distintos con ≥1 completion en el período), Bloques (count en
    período), Racha actual (`computeStreaks`: desde hoy hacia atrás sobre `statsActiveDays`, con gracia si
    hoy aún no entrenó), Mejor racha (corrida consecutiva más larga histórica).
  - **Sección 2 — Adherencia semanal:** 7 barras verticales CSS (Lun-Dom, track 120px) con % de bloques
    completados por día (`completed/total`); "–" si ese día no tiene plan. Llenado animado 0.5s vía
    **`setTimeout`** (NO `requestAnimationFrame`: se pausa en pestañas de fondo → las barras quedaban en 0).
  - **Sección 3 — Historial:** últimos 14 días planificados ≤ hoy (desc): fecha ("Lun 20 Jul"), programa,
    "X/Y bloques" + mini-barra de progreso, ícono ✅ (todo) / 🟡 (algo) / ⭕ (nada).
  - **Sección 4 — Logros (4 badges 64px):** 🔥 Primera sesión (≥1 completion), 💪 Semana perfecta (alguna
    semana Lun-Dom con todos los bloques completos), 🏆 Racha de 7 días (mejor racha ≥7), ⚡ 30 sesiones
    (`statsActiveDays.size ≥ 30`). Desbloqueado = dorado; bloqueado = gris + 🔒. Todo sobre el historial.
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + soporte del embed
    `!inner`, ya borrado; sin errores de consola): con un seed que arma una semana perfecta anterior
    (racha de 7) + la semana actual → cards (semana: 3 sesiones/5 bloques; mes: 10/12), racha actual 3 /
    mejor 7; adherencia lun 100 / mar 33 / mié(hoy) 100 / jue 0 / resto "–" con alturas animadas
    (100/33/100/0…); historial 10 filas con íconos y barras correctos; logros: Primera/Semana perfecta/
    Racha 7 desbloqueados, 30 sesiones bloqueado; el selector recalcula solo las 2 cards. Mobile: cards
    2×2, badges 4-en-fila (56px), sin overflow. El `dashboard.html` real redirige a login sin sesión y no
    arroja errores de parseo. (Nota: se corrigió el uso de `requestAnimationFrame` → `setTimeout` porque
    rAF no dispara en pestañas en segundo plano.)
  - ⚠️ Además de la RLS ya mencionada, el embed `planning_days!inner` requiere que exista la FK
    `planning_blocks.day_id → planning_days.id` (ya en el esquema).
- **`app/dashboard.html` — Vista "Mensajes" completa** (tab 💬): chat en tiempo real de **un solo canal**
  (sin lista de canales — el atleta entra directo):
  - `athleteChannel()`: grupal → `ATHLETE.program` (crossfit/hybrid/corredores); asesoría → `'dm_'+ATHLETE.id`.
  - **Header** (`setChatHeader`): grupal → "Chat {programa}" + "N miembros" (count profiles del programa,
    role=athlete); asesoría → "Chat con {COACH_NAMES[program]}" + "Asesoría privada".
  - **Mensajes:** `select('..., sender:profiles!from_id(full_name, role)').eq('channel', X).order(desc).
    limit(50)` invertido a cronológico. Burbujas: propias (from_id=ATHLETE.id) a la derecha en dorado,
    ajenas a la izquierda en #1A1A1A; avatar con iniciales + nombre + hora (`fmtTime`); si el emisor es
    `role='admin'` → badge dorado **"Coach"**. Scroll automático al fondo.
  - **Enviar:** `INSERT messages (from_id, channel, content)` `.select().single()` + append **optimista**
    con **dedupe por id** (`chatRenderedIds`) → funciona con o sin Realtime. Enter (sin shift) o botón.
  - **Realtime** (`subscribeChat`): `sb.channel('chat_'+canal).on('postgres_changes', {INSERT, table:messages,
    filter:channel=eq.X}, appendChatMessage).subscribe()`. `showView` hace `unsubscribeChat()` al salir de
    la vista (y `enterMensajes()` al entrar).
  - **Marcar leído** (`markChatRead`): `UPDATE read=true WHERE channel=X AND from_id != ATHLETE.id AND
    read=false`, al abrir y al recibir un entrante con el canal abierto.
  - **Layout:** la vista usa `position:fixed` entre la topbar (top:56) y la tabbar (bottom:64 mobile /
    top+51 y bottom:0 en desktop), max-width 820 centrada; el área de mensajes scrollea internamente.
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + **Realtime simulado** + embed
    `!from_id` + `.neq`, ya borrado; sin errores de consola): **grupal** → header "Chat CrossFit / 3
    miembros", 3 mensajes (coach con badge Coach a la izq, propio a la der dorado, otro atleta a la izq),
    marca leídos (m1/m3), realtime suscrito; enviar (DB +1, DOM +1 sin duplicar, input limpio, burbuja
    dorada a la derecha); entrante por realtime (aparece a la izq con badge Coach + se marca leído); salir
    → unsubscribe. **Asesoría** (program=asesoria-erika) → canal `dm_ath-1`, header "Chat con Erika Prada /
    Asesoría privada", mensajes solo de ese canal privado, enviar OK. Layout: input justo arriba de la
    tabbar, mensajes scrolleables. El `dashboard.html` real redirige a login sin sesión y no arroja errores.
  - ⚠️ RLS/Realtime de `messages` para el atleta (ver nota arriba) es imprescindible para producción.
- **`app/dashboard.html` — Vista "Perfil" completa** (tab 👤): 3 cards.
  - **Datos personales:** avatar 80px con iniciales (fondo dorado). Vista/edición conmutables
    (`renderPersonalView` / `renderPersonalEdit`): nombre + teléfono editables (inputs fondo #0D0D0D borde
    dorado), email **solo lectura**. "✏️ Editar datos" → inputs; "Guardar" (`savePersonal`) valida nombre
    no vacío y hace `UPDATE profiles SET full_name, phone WHERE id=uid`; al ok actualiza el objeto
    `ATHLETE`, la topbar (nombre + avatar), el avatar del perfil y el saludo de Inicio, vuelve a vista y
    muestra toast **"✓ Datos actualizados"**.
  - **Mi suscripción** (`renderSubscription`): badge de programa (colores del admin, `progKey`) + badge de
    estado (`st-active`/`pending`/`cancelled` = Activo/Pendiente/Cancelado). Filas: fecha de inicio y
    (si existe) vencimiento con `fmtDayOnly` (sin desfase TZ), y **precio leído de `site_config`**
    (`priceLabel`: grupal → `price_{prog}_ars` "$X / mes"; asesoría → `price_asesoria_usd` "USD X / mes").
    Texto informativo por estado (activo/cancelado/pendiente). Si cancelado → botón "Volver a suscribirme"
    a `PROGRAM_LANDING[program]` (crossfit/hybrid/fuerza-corredores/asesoria-erika/asesoria-gonza .html).
  - **Seguridad:** "Cambiar contraseña" → `sb.auth.resetPasswordForEmail(email, {redirectTo: origin +
    '/app/set-password.html'})` + toast "Te enviamos un email…"; "Cerrar sesión" (`pf-logout`, outline
    rojo al hover) → `sb.auth.signOut()` → `location.replace('login.html')`.
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + `resetPasswordForEmail`, ya
    borrado; sin errores de consola): estado **active** → avatar JP, datos correctos, suscripción con badge
    CrossFit + Activo, inicio 01/06/2026, venc. 01/12/2026, precio "$45.000 / mes" (de site_config), info
    "se renueva automáticamente", sin botón volver; **editar** (nombre vacío da error; guardar actualiza DB
    + topbar/avatar/saludo + toast); **cambiar contraseña** (resetPasswordForEmail con el email + redirectTo
    correcto + toast); estado **cancelled** → badge gris + info "está cancelada… Contactanos" + botón
    "Volver a suscribirme" → `../crossfit.html`; **cerrar sesión** → signOut + redirige a `login.html`.
    Mobile: avatar 80px, cards full-width, sin overflow. El `dashboard.html` real redirige a login sin
    sesión y no arroja errores de parseo.
  - ⚠️ Necesita policy RLS de **UPDATE del propio `profiles`** (`id = auth.uid()`) para guardar los datos.
- **`app/dashboard.html` — Perfil → botón "Cancelar suscripción"** (solo si `subscription_status='active'`):
  - Botón `.pf-cancel-btn` (outline rojo, pequeño) al pie de la card de suscripción → abre modal de
    confirmación `#cancelModal` ("¿Cancelar tu suscripción?" + texto de advertencia + "Volver" / "Sí,
    cancelar" en rojo). Cierra por "Volver" o clickeando el fondo.
  - Al confirmar (`confirmCancel`): muestra "Procesando cancelación…" (spinner) y a los ~1.2s cambia a un
    mensaje amigable ("Cancelación no disponible aún… escribinos a WhatsApp") con botón **WhatsApp**
    (`wa.me/5491136433379`, target=_blank) + "Cerrar". **NO cambia `subscription_status`** (no hay baja
    real todavía). Hay un comentario `// TODO:` con los 3 pasos para integrar MP (Edge Function
    `cancel-subscription` con `mp_subscription_id` → MP API → webhook actualiza el estado).
  - **Verificado** con harness temporal (fake de Supabase, ya borrado; sin errores de consola): con
    estado **active** el botón aparece; abre el modal (título/texto/botones correctos); "Volver" y click
    en el fondo cierran; "Sí, cancelar" → "Procesando cancelación…" con spinner → mensaje final + botón
    WhatsApp a `https://wa.me/5491136433379` (target _blank) + "Cerrar"; el estado en la DB queda `active`.
    Con estado **cancelled/pending** el botón NO aparece (y en cancelled sigue estando "Volver a
    suscribirme"). El `dashboard.html` real redirige a login sin sesión y no arroja errores de parseo.
  - ⚠️ Pendiente: **Edge Function `cancel-subscription`** (recibe `mp_subscription_id`, cancela en MP; el
    webhook de MP luego pone `subscription_status='cancelled'`). Ver TODO en el código.
- **`app/dashboard.html` — Vista "Comunidad" completa** (reemplaza el toast "próximamente"). NO es un tab:
  se entra desde el botón "Ver comunidad →" de Inicio (`showView('comunidad')`), con "← Volver" en el header.
  - **Feed por programa** (`community_posts WHERE program_slug = ATHLETE.program ORDER BY created_at DESC
    LIMIT 20`, embed `author:profiles!author_id(full_name, role)`). Cada post (card #1A1A1A): avatar +
    nombre + badge **"Coach"** si `role='admin'` + **fecha relativa** (`fmtRelative`: "hace 2 horas",
    "ayer", "hace 3 días"…), texto `pre-line`, acciones: **👍 likes** (botón dorado si likeó, count),
    **💬 count**, **"Ver comentarios"** (toggle), y **🗑️ Eliminar SOLO en los propios** (`author_id=uid`).
  - **Likes** → tabla nueva **`post_likes`** (SQL arriba). Al cargar: `SELECT post_id, athlete_id FROM
    post_likes WHERE post_id IN (...)` → cuenta por post + set de los míos. Toggle **optimista** (INSERT/
    DELETE, revierte si falla) con animación scale (1→1.35→1). Degrada si la tabla no existe.
  - **Comentarios:** "Ver comentarios" expande sección (fondo #111) con lista (`community_comments` embed
    autor) + input inline → INSERT optimista (dedupe por id). Contador se actualiza.
  - **Nueva publicación:** botón "+ Nueva publicación" → modal `#npModal` (textarea) → INSERT
    `community_posts` → se **prepende** al feed con fade-in (optimista + dedupe).
  - **Realtime** (`subscribeComunidad`): canal `community_<programa>` (INSERT community_posts filter
    `program_slug=eq.X`) → prepende posts nuevos; canal `community_comments_rt` (INSERT community_comments,
    sin filtro, se filtra en cliente por post del feed) → agrega el comentario si su post está expandido.
    Ambos con dedupe por id y se desuscriben al salir de la vista (en `showView`).
  - **Verificado** con harness temporal (fake de Supabase con DB en memoria + **Realtime simulado** + embed
    `author` + `post_likes`, ya borrado; sin errores de consola): feed de 3 posts ordenado desc (coach con
    badge, propio con 🗑️, like dorado donde ya likeó, counts correctos, fechas relativas "hace 5 min/1
    hora/3 horas"); abrir comentarios (muestra el existente) + comentar (count 1→2, aparece, en DB);
    like/unlike de otro post (count 1↔2, INSERT/DELETE en `post_likes`); nueva publicación por modal
    (prepende con fade-in, sin duplicar por dedupe); realtime de post nuevo (aparece arriba) y de comentario
    (se agrega al post expandido, con badge Coach, count 2→3); eliminar post propio (fuera del DOM + DB);
    "Volver" desuscribe ambos canales. Mobile: posts full-width, botón "+ Nueva publicación" full-width,
    sin overflow. El `dashboard.html` real redirige a login sin sesión y no arroja errores de parseo.
  - ⚠️ Requiere en Supabase: tabla `post_likes` + Realtime en `community_posts`/`community_comments` +
    policies del atleta (SELECT/INSERT en posts/comments de su programa; DELETE de sus propios posts).
- Próximo paso: correr en Supabase todos los pendientes (esquema **+ `post_likes`** + policies RLS
  atleta/admin + Realtime de messages/community) + Edge Functions (`create-athlete` + webhook MP +
  `cancel-subscription`) + `set-password.html`. **Con la comunidad, el portal del atleta queda completo.**
