# CONTEXTO.md — Bitácora HB Performance

Registro cronológico de lo que se va haciendo. Entrada nueva arriba o abajo según prefieras
(acá se agrega al final). Cada entrada: fecha, qué se hizo, decisiones/feedback.

---

## Estado actual (resumen rápido)
- **`index.html`** completo y funcional: navbar, hero con slideshow, nosotros, programas (3),
  asesorías (2 coaches), testimonios (3), footer.
- **Tipografía definitiva:** Inter bold (títulos, caja normal) + Playfair Display cursiva (acentos)
  + Inter (cuerpo). Ver `CLAUDE.md`.
- **Hero:** slideshow parallax con crossfade de 8 fotos (`images/img1.jpg` … `img8.jpg`).
  El **orden de aparición = el número del archivo** (el usuario reordena renombrando).
- **Pendiente:** crear sub-páginas enlazadas; reemplazar logo de texto por `logo.png`;
  optimizar peso de imágenes del hero.

---

## Bitácora

### 2026-06-12 — Creación inicial de la landing
- Se creó `index.html` completo según brief: navbar fija + hamburguesa móvil, hero full-viewport,
  secciones nosotros / programas / asesorías / testimonios, footer con aviso WodUp.
- Paleta en `:root` (negro `#0A0A0A` + dorado `#F5A800`). Placeholders grises para imágenes.
- Fade-in con IntersectionObserver, smooth scroll, responsive mobile-first.
- Fuente inicial: Barlow Condensed (títulos) + Inter (cuerpo).

### 2026-06-12 — Iteración de tipografía (varios pasos por feedback)
- ❌ Barlow Condensed no gustó.
- Probado Inter mayúsculas → "textos grandes no quedaban bien".
- Probado Oswald (condensada) → tampoco.
- El "Entrenate con" blanco grande llamaba demasiado la atención.
- ✅ **Decisión final** (a partir de referencia visual del hero de HBLab que envió el usuario):
  - Títulos: **Inter bold, caja normal**, `letter-spacing: -1px`.
  - Acentos: **Playfair Display cursiva** dorada, inline (clase `.accent`).
  - Cuerpo: Inter.
  - Hero rediseñado: **badge pill** arriba ("• Entrenamiento híbrido & coaching online")
    + título "Entrená con *propósito*" (propósito en cursiva dorada inline).
  - Se removió el logo gigante del hero y el antetítulo gris.

### 2026-06-12 — Slideshow parallax en el hero + archivos de registro
- Se reemplazó el fondo de líneas diagonales del hero por un **slideshow de fotos**:
  - 8 imágenes `images/hero-1.jpg` … `hero-8.jpg`, crossfade cada 5s (opacity 1.2s).
  - Overlay oscuro `rgba(0,0,0,0.52)` para legibilidad del texto.
  - **Parallax** en scroll a 0.3x (transform en el contenedor, con `requestAnimationFrame`).
  - **Ken Burns** (zoom 100%→105% en 10s) sobre la slide activa.
  - `object-fit: cover`; `object-position: top center` en impares (hero-1/3/5/7) y
    `center center` en pares (hero-2/4/6/8) para no cortar caras.
  - Sin flechas/dots/controles. Precarga de las 8 imágenes. Respeta `prefers-reduced-motion`.
  - z-index: slideshow 0, overlay 1, contenido 2. Se conservó todo el contenido del hero.
- Se **renombraron** las 8 imágenes existentes en `images/` a `hero-1..8.jpg`.
  - ⚠️ `hero-8.jpg` es en realidad un PNG de ~9.6 MB → conviene optimizar/convertir a JPG.
- Se crearon **`CLAUDE.md`** (guía + reglas) y **`CONTEXTO.md`** (esta bitácora).

### 2026-06-12 — Optimización de imágenes del hero
- Se optimizaron las 8 imágenes con PIL (Python): `convert('RGB')`, `exif_transpose`,
  resize a máx 1920px de ancho, JPEG `quality=82`, `optimize`, `progressive`.
- **`hero-8.jpg`**: de ~9.4 MB (era PNG) a **255 KB**. ✅ Problema de peso resuelto.
- Las demás quedaron entre 115–160 KB. Total del slideshow ahora ~1.1 MB (antes ~10.6 MB).
- Dimensiones resultantes: varias son verticales (853×1280 / 1170×1560 / 1170×2532) → confirma
  que la regla `object-position: top center` en impares ayuda a no cortar caras.

### 2026-06-12 — Calidad de imágenes + esquema de nombres img1..img8
- **Problema detectado:** la optimización anterior se guardó ENCIMA de los originales →
  se perdió detalle (sobre todo el ex `hero-8`). Aprendizaje: **no volver a sobrescribir
  originales**; trabajar sobre copias.
- El usuario volvió a cargar las imágenes en `images/` con el esquema **`img1`…`img8`**
  (decidió manejar el orden renombrando los archivos él mismo → nº de archivo = orden).
- Estado de las fuentes:
  - `img1.jpg`: 4000×2666, 716 KB (alta resolución, se ve nítida). Se unificó extensión a `.jpg`.
  - `img2`–`img8`: baja resolución de origen (853×1280 a 1170×2080). A pantalla completa el
    navegador las agranda → algo borrosas. **Limitación del original**, no de compresión.
- **Decisión:** NO re-comprimir img2–img8 (re-guardar solo agrega pérdida); se dejan en su
  calidad nativa. Para mejorarlas hace falta un original de mayor resolución.
- Se actualizó el markup del slideshow a `img1.jpg`…`img8.jpg`. `object-position`:
  `center` para `img1` (horizontal) y `top center` para `img2`–`img8` (verticales).
- **Regla a futuro:** para reordenar, el usuario renombra los archivos `imgN.jpg`
  (N = posición). El código siempre apunta a `img1`…`img8`.

### 2026-06-12 — Reconocimiento facial para encuadre del hero
- Se usó **OpenCV (Haar cascades:** frontal_default + frontal_alt2 + profileface) para detectar
  caras en cada imagen y calcular el **centroide ponderado por área** → punto focal en %.
- Resultado aplicado como `object-position` inline por imagen (reemplaza las clases pos-top/center):
  - img1 `22% 64%` · img2 `50% 30%`* · img3 `63% 33%` · img4 `56% 64%`
  - img5 `47% 56%` · img6 `50% 30%`* · img7 `50% 20%` · img8 `37% 40%`
  - (*) img2 e img6 sin detección → encuadre seguro centrado-arriba por defecto.
- Si alguna cara queda mal, se ajusta a mano el `object-position` de esa `<img>` (X% horizontal,
  Y% vertical; menor Y = más arriba).

### 2026-06-12 — Reencuadre verificado (desktop + mobile)
- La detección Haar metió falsos positivos → encuadres malos en varias. Se reemplazó por
  **revisión visual**: contact sheet de las 8 fotos + **simulación del recorte real** (object-fit
  cover) para contenedor desktop (~16:9) y mobile (~390×844), iterando hasta que la cara entre.
- **Clave entendida:** el eje que se recorta cambia según el dispositivo.
  - Desktop (ancho) → recorta vertical → manda el **Y%**.
  - Mobile (alto/angosto) → recorta horizontal → manda el **X%**.
  - Por eso cada imagen necesita X% (mobile) **e** Y% (desktop) bien puestos.
- Valores finales aplicados (verificados en ambos):
  img1 `45% 40%` · img2 `55% 26%` · img3 `68% 50%` · img4 `48% 35%` ·
  img5 `45% 28%` · img6 `58% 38%` · img7 `52% 26%` · img8 `50% 26%`.
- En mobile todas se ven bien; en desktop se bajó el Y% de img2/5/7/8 para que no corte la cabeza.

### 2026-06-12 — Preview en celular (verificación real)
- Se agregó `.claude/launch.json` (servidor estático `python -m http.server 5500`) para previsualizar.
- Se verificó el hero en viewport mobile **375×812** con capturas reales de las 8 slides:
  todas ocupan pantalla completa y mantienen a la persona/cara dentro del cuadro. ✅
- Detalle técnico encontrado: el screenshot del preview se cacheaba; se fuerza repaint con
  `window.scrollTo(0,1);scrollTo(0,0)` antes de capturar.
- El usuario aprobó el resultado del hero. **Pendiente:** reemplazar fotos por versiones de
  mayor resolución (Gemini) y luego recalcular `object-position`.

### 2026-06-12 — Logo real (código preparado)
- Navbar y footer ahora usan `<img class="logo-img" src="logo.png">` con **fallback automático**
  al texto "HB *Performance*" vía `onerror` (si el archivo no existe, no queda roto).
- CSS: `.logo-img` alto 38px (navbar) y `.logo-img--footer` 52px, ancho proporcional.
- **PENDIENTE del usuario:** dejar el archivo `logo.png` en la **raíz** del proyecto
  (junto a `index.html`). Ideal: PNG con fondo transparente, alto ≥ 200px.

### 2026-06-12 — Logo integrado (resuelto)
- El usuario subió **`logo.jpg`** (1254×1254, lockup dorado "HB PERFORMANCE" sobre fondo negro).
- Con PIL se generó **`logo.png`**: alpha = max(R,G,B) por pixel (negro→transparente,
  dorado→opaco), recortado al bounding box + 4% de padding. Resultado 1246×1180 (ratio ~1.06).
- Integrado en navbar (`.logo-img` 54px) y footer (`.logo-img--footer` 110px), centrado,
  transparente sobre fondo oscuro. Verificado en preview desktop. ✅
- Como es un lockup casi cuadrado, a alturas chicas "PERFORMANCE" se vuelve ilegible →
  por eso navbar a 54px (no 38). Originales: `logo.jpg` (fuente) + `logo.png` (el que usa la web).
- Fallback al texto sigue activo por si falta el archivo.

### 2026-06-12 — Repaso completo en celular (375×812)
- Se revisaron TODAS las secciones en mobile con capturas reales: hero, menú hamburguesa
  (abre/cierra OK), quiénes somos, programas, asesorías, testimonios (scroll horizontal OK), footer.
- **Resultado: nada roto, todo responsive y bien apilado.** ✅
- Único "pendiente visual": los placeholders grises (fotos de secciones, coaches, avatares) →
  es a propósito, hasta cargar imágenes reales.

### 2026-06-12 — Logo horizontal en navbar (más grande)
- Feedback: el lockup cuadrado se veía chico en la navbar.
- Con PIL se separó `logo.png` en **`logo-hb.png`** (la "HB", 779×485) y **`logo-perf.png`**
  (la palabra PERFORMANCE, 1152×175), detectando el hueco entre ambos por filas de alpha.
- Navbar ahora usa un **lockup horizontal** (`.logo-lockup`, flex): `.logo-hb` a 48px de alto +
  `.logo-perf` a 20px al lado. Más grande y legible. Verificado en desktop y mobile. ✅
- Footer sigue con el lockup completo `logo.png` a 110px (ahí se ve bien grande).
- Archivos de logo en raíz: `logo.jpg` (original), `logo.png` (lockup completo, footer),
  `logo-hb.png` + `logo-perf.png` (navbar). Fallback a texto si faltan.

### 2026-06-12 — "Quiénes somos": animación en vez de fotos (modelo a distancia)
- Decisión: el negocio vende **planes a distancia**, así que NO van fotos del gym físico.
  El usuario pidió una **animación divertida pero profesional de gente entrenando**.
- Se reemplazó la grilla 2×2 de placeholders por una **animación CSS/SVG pura** (`.nosotros-visual`):
  - Silueta de atleta en dorado haciendo **jumping jacks** (grupos `<line>` rotando desde las
    articulaciones con `transform-box: view-box` + `transform-origin` en píxeles del viewBox).
  - Fondo: grilla técnica con máscara radial + 2 **anillos de pulso** (`nvPulse`).
  - **Línea de ECG** (`stroke-dashoffset`) que viaja, y **chips flotantes** Ciencia/Método/Propósito.
  - Respeta `prefers-reduced-motion`. Verificado en desktop y mobile. ✅
- Sin librerías. Pendiente: feedback del usuario / posible variedad de ejercicios.

### 2026-06-12 — Sub-páginas de programas creadas (crossfit / hybrid / fuerza-corredores)
- Se crearon **3 páginas HTML** de detalle de programa, reusando el estilo real del `index.html`
  (colores, fuentes Inter+Playfair, navbar con logo horizontal, footer, botones, fade-in).
  - `crossfit.html` — "CrossFit *Program*" · $45.000/mes (+ USD 40 PayPal exterior) · CTA `#mp-crossfit`.
  - `hybrid.html` — "Hybrid *Evolution*" · incluye cards de **Niveles** (Inicial/Avanzado) y
    "Qué necesitás" · $45.000/mes · CTA `#mp-hybrid`.
  - `fuerza-corredores.html` — "Fuerza para *corredores*" · $40.000/mes · CTA `#mp-corredores`.
- Estructura común: hero corto (badge + título con acento Playfair + subtítulo) con **back-link**
  "← Volver a programas"; layout 2 columnas (izq: 2 placeholders 4:3 "foto programa" sticky en
  desktop / der: descripción + listas con **check dorado** + caja WodUp + caja de precio + CTA
  principal); banda de CTA secundario "¿Tenés dudas? Escribinos" → `#whatsapp`.
- Navbar de las sub-páginas: logo → `index.html`; links → `index.html#programas|#asesorias|#testimonios`.
- Las cards de programas del `index.html` **ya linkeaban** a estos archivos (no hubo que tocar el index).
- Placeholders de precio/CTA: `#mp-*` (Mercado Pago), `#whatsapp` (contacto). Falta enlazar los reales.
- Verificado: las 3 cargan sin errores de consola y con todo el contenido. (Las capturas del
  Browser pane estaban timeouteando, se validó por texto/consola.)
- ⚠️ Tono: directo/motivador estilo Hybrid Evolution. Plataforma = WodUp (iOS + navegador Android).

### 2026-06-12 — Doble botón de pago (MP + PayPal) en las 3 sub-páginas
- En la caja de precio de `crossfit.html`, `hybrid.html` y `fuerza-corredores.html` se reemplazó
  el CTA único por **dos botones lado a lado**:
  - **Botón 1 (Mercado Pago, ARS)** — estilo primario `btn btn-filled` (dorado):
    "Suscribirme — $XX.000 ARS" → `#mp-[programa]`.
  - **Botón 2 (PayPal, USD)** — estilo secundario `btn btn-outline` (borde): "Subscribe — USD XX"
    → `#paypal-[programa]`.
  - Valores: crossfit $45.000/USD 40 · hybrid $45.000/USD 40 · corredores $40.000/USD 35.
- CSS: `.prog-cta` pasó a `display:flex; gap:14px` con `.btn { flex:1 }`; en **≤600px** se apilan
  (`flex-direction:column`). Se unificó el `price-note` a "Suscripción mensual — Mercado Pago (ARS)
  o PayPal (exterior)."
- Verificado por texto en las 3: ambos botones y montos correctos. Placeholders `#mp-*` / `#paypal-*`
  siguen pendientes de enlazar a los links reales.

### 2026-07-18 — Fotos reales en las sub-páginas de programas
- Se reemplazaron los 2 placeholders grises de cada sub-página por `<img>` reales:
  - crossfit: `images/cross-1.jpg` (top center) + `images/cross-2.jpg` (center center).
  - hybrid: `images/hybrid-1.JPEG` (top center) + `images/hybrid-2.JPEG` (center center).
  - corredores: `images/corredores-1.JPEG` (top center) + `images/corredores-2.JPEG` (center center).
- CSS nuevo `.prog-media img`: `width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:8px`.
  Mantiene el diseño responsive (columna sticky en desktop, apilado en ≤900px).
- Se renombró `corredores-2.jpeg` → `corredores-2.JPEG` (unificar extensión; evita link roto en
  hosting case-sensitive).
- Verificado: las 6 imágenes cargan (loaded=true) con su `object-position` correcto.
- ⚠️ **Peso**: `cross-2.jpg` = 21 MB (3723×5584) y `hybrid-1.JPEG` = 12,8 MB (4000×6000) son
  demasiado pesadas para web → conviene optimizar/redimensionar (pendiente OK del usuario para no
  pisar originales).

### 2026-07-18 — Reencuadre de fotos en fuerza-corredores
- Feedback: quedaban descentradas. El `top center` de corredores-1 mostraba casi todo cielo y
  cortaba a la corredora (la persona está en la mitad-baja de la foto).
- Se simuló el recorte 4:3 con varios valores y se ajustó el `object-position`:
  - `corredores-1.JPEG` → **`center 82%`** (cuerpo entero + cabeza, mínimo cielo).
  - `corredores-2.JPEG` → **`center 35%`** (cara con aire arriba, torso y dorsal visibles).

### 2026-07-18 — Hybrid: 1ª foto "alejada" (fondo borroso)
- Feedback: `hybrid-1.JPEG` (4000×6000, plano medio) quedaba con mucho zoom en 4:3 con `cover`.
- Como es muy vertical, para "alejar" hay que mostrarla entera → nuevo patrón **`.prog-photo-fit`**:
  wrapper 4:3 con la misma imagen de fondo **borrosa** (`::before` con `blur(22px) brightness(.5)`,
  `scale(1.15)`) + la foto encima con `object-fit: contain`. Se ve la persona completa, más chica,
  y el cuadro se rellena sin barras negras.
- Solo se aplicó a hybrid-1; hybrid-2 sigue con `cover center center`.
- Patrón reutilizable para cualquier foto vertical que quede muy zoomeada en un cuadro 4:3.

### 2026-07-21 — Fix botón coach en mobile (index)
- En mobile el botón "Quiero esta asesoría →" de las coach-cards partía la flecha a una 2ª línea.
- Fix: `.coach-card .btn` a **todo el ancho** cuando las cards se apilan (≤900px) y en ≤480px
  `font-size:.9rem`, `letter-spacing:.5px`, `padding:14px 12px`, `white-space:nowrap`.
- Verificado a 400px: ambos botones en 1 línea, sin overflow.

### 2026-07-23 — Botón "Ingresar" en el navbar (acceso al portal)
- Se agregó un botón **"Ingresar"** a la derecha de los links del navbar (Programas | Asesorías |
  Testimonios), como último `<li class="nav-login">` dentro de `#navLinks`, que apunta a **`app/login.html`**.
- Estilo `a.btn-ingresar`: borde dorado `#F5A800`, fondo transparente, texto dorado, uppercase (fuente
  display); **hover** → fondo dorado + texto negro `#0A0A0A`.
- **Desktop:** separado del resto de los links por un divisor a la izquierda (`.nav-login`
  `border-left:1px solid rgba(255,255,255,.14)` + `padding-left:28px`).
- **Mobile (≤768px):** sin divisor; el `.nav-login` va centrado como **último item** del menú hamburguesa
  (padding vertical + border-top como los demás items; botón con más padding para el tap). Al estar dentro
  de `#navLinks`, el JS existente (`navLinks.querySelectorAll('a')`) ya le cierra el menú al clickear.
- **Verificado** en el Browser pane por DOM/CSS computado (las capturas timeouteaban por el slideshow del
  hero, como siempre): existe, texto "Ingresar", href `app/login.html`, es el último item; **desktop** (1280)
  → hamburguesa oculta, divisor 1px + padding 28px, borde 2px dorado, bg transparente; **mobile** (375) →
  menú abre, botón centrado (`justify-content:center`), sin divisor, borde dorado, padding 12px 34px;
  regla `:hover` = bg `var(--accent)` + color `#0A0A0A`. Sin errores de consola.

### 2026-07-23 — Footer sin aviso de WodUp
- Se **eliminó** el bloque `.notice-box` del footer de `index.html` (el aviso "📱 Nuestros programas se
  gestionan a través de WodUp… app.wodup.com"), **sin reemplazo**. El footer queda: logo → redes → copyright.
- La caja WodUp de las **sub-páginas de programa** (crossfit/hybrid/fuerza-corredores) NO se tocó — sigue ahí.
- La regla CSS `.notice-box` quedó sin usar (inofensiva); `index.html` parsea OK (`new Function`).

### 2026-07-24 — Checkout con datos previos + página de éxito post-pago
- En `crossfit.html` / `hybrid.html` / `fuerza-corredores.html`, el botón MP "Suscribirme — $XX.000 ARS"
  (`#btn-mp`) **ya NO va directo a Mercado Pago**: ahora abre un **modal** (`#payModal`) que pide nombre,
  email (requeridos) y teléfono (opcional). "Continuar al pago →" valida → **INSERT en
  `pending_subscriptions`** (`full_name, email, phone, program`) → redirige al `mp_link_<prog>` de
  `site_config`. El botón PayPal sigue yendo directo. Modal con CSS propio (`.pay-modal`), estilo landing.
- Nuevo **`pago-exitoso.html`** (raíz): ✅ "¡Gracias por suscribirte!" + aviso del email de activación +
  "revisá spam" + botón "Volver al inicio →" (`index.html`). Centrado, fondo `#0A0A0A`, dorado, favicon.
- La Edge Function `process-payment` (en Supabase, NO en el repo) la actualiza el usuario para buscar el
  `pending_subscriptions` por `program`, crear/activar el user y borrar el pending. Detalle en `app/CLAUDE.md`.
- ⚠️ Pendiente en Supabase: tabla `pending_subscriptions` + policy INSERT público (SQL en `app/CONTEXTO.md`)
  + actualizar `process-payment` + back-URL de MP → `pago-exitoso.html`. Verificado por harness (sin errores).

### 2026-07-23 — Páginas de asesoría sin precio
- En `asesoria-erika.html` y `asesoria-gonza.html` se **eliminó la sección de precio** (`.price-box` con
  "USD 150 / mes" + notas de PayPal/Mercado Pago + eyebrow "Precio"). Se reemplazó por una nota simple
  `.asesoria-nota`: "Las asesorías son personalizadas. El valor se coordina directamente con tu coach."
- Se **mantuvo el botón de WhatsApp** (`.coach-cta`, con el número y mensaje pre-cargado de cada coach).
- Las reglas CSS `.price-box` quedaron sin uso (inofensivas). El valor de la asesoría se coordina 1‑a‑1.

### 2026-07-20 — Páginas de asesorías creadas (erika / gonza)
- Se crearon **`asesoria-erika.html`** y **`asesoria-gonza.html`** con el estilo del sitio (navbar,
  footer, fuentes, botones, fade-in). Con esto **todas las sub-páginas están listas**.
- Estructura: **hero con foto del coach a pantalla** (`coach-erika.png` / `coach-gonza.png` como
  `.coach-hero-bg` cover + `.coach-hero-overlay` gradiente oscuro) con back-link "← Volver", badge,
  título "Asesoría *personalizada*" y subtítulo → intro breve → **Especialidades (acordeón de 3)** →
  **Qué incluye** (lista con emojis dorados) → **Precio** (USD 150/mes + subtexto ARS/PayPal-MP +
  aclaración tipo de cambio) → **CTA WhatsApp** (`btn-filled` ancho).
- **Acordeón:** `.acc-item`/`.acc-header`/`.acc-body`; abre/cierra con `max-height` (JS setea
  `scrollHeight`), **uno abierto a la vez**, ícono "+" que rota a "×". Verificado.
- Links CTA (WhatsApp con mensaje pre-cargado): Erika `wa.me/5491136433379`, Gonza `wa.me/5491122895924`.
- Los botones "Quiero esta asesoría" del index **ya linkeaban** a estas páginas (no hubo que tocar el index).
- ⚠️ Las fotos de coach son recortes verticales con fondo transparente; como hero a pantalla completa
  (cover) se ven a lo ancho con overlay. Erika queda bien con `cover` (`center 18%`).
- **Fix Gonza:** su foto es más alta/angosta (ratio 0.5) → con `cover` se le cortaba la cabeza.
  Se cambió a **`background-size: auto 85%; background-position: center 55%`** (muestra la figura
  entera sobre el fondo oscuro, cara despejada, con aire arriba del navbar). Simulado en Python antes
  de aplicar. En desktop se ve como retrato centrado (más angosto) — aceptable por el look oscuro.

### 2026-07-20 — Testimonios: botón "Ver más"
- Se muestran las **primeras 4** capturas; las 4 restantes (`.testi-more`) ocultas con
  `.testi-wall:not(.expanded) .testi-more { display:none }`.
- Botón `#testiToggle` (`.btn-outline`, en `.testi-more-wrap` centrado) togglea la clase `.expanded`
  del muro y cambia el texto **"Ver más" ↔ "Ver menos"** (+ `aria-expanded`). JS al final del `<script>`.
- Verificado: inicial 4 visibles → click 8 → click 4.

### 2026-07-20 — Testimonios: muro de capturas reales
- Se reemplazó la sección de testimonios (cards de relleno) por un **muro tipo mampostería** con
  8 capturas reales: `images/testimonio-1.JPEG` … `testimonio-8.JPEG` (proporciones variadas 2.54→0.86).
- ⚠️ El pedido decía `.png` pero los archivos están en **`.JPEG`** → se usó la extensión real.
- CSS: `.testi-wall` con **`column-count`** (3 desktop · 2 ≤768px · 1 ≤480px), `column-gap 20px`.
  `.testi-card`: `#1A1A1A`, `border-radius 12px`, `overflow:hidden`, sin padding, `break-inside:avoid`.
  Imagen `width:100%; height:auto` (respeta proporción). Hover: `scale(1.02)` + borde dorado + glow.
- Título "Lo que dice nuestra *comunidad*" + subtítulo "Mensajes reales de atletas que ya entrenan
  con nosotros". Fade-in aplicado al contenedor `.testi-wall` (no a cada card, para no chocar con el
  transform del hover). Imágenes con `loading="lazy"`.
- Verificado por JS: 8 imágenes cargan, columnas 3/2/1 según viewport, fade-in OK (opacity→1).
  Nota: el Browser pane está congelado (no avanza transiciones ni deja screenshotear), pero la lógica
  es correcta (al quitar la transición, opacity salta a 1).

### 2026-07-20 — Cards de programas: portada única (reemplaza .split-photo)
- Se **reemplazó todo el componente `.split-photo`** (2 fotos + diagonal + encuadre por cara) por una
  **sola imagen de portada** por card, prediseñada por el usuario:
  crossfit `card-crossfit.png` · hybrid `card-hybrid.png` · corredores `card-corredores.png`
  (las 3 son 1200×675 = 16:9, ~780 KB).
- CSS nuevo `.program-card .card-cover`: `aspect-ratio 16/9; object-fit:cover; object-position:center`.
  Bordes redondeados arriba salen del `overflow:hidden` + `border-radius` del card. Glow dorado del
  hover intacto (`.program-card:hover`).
- **Mobile (≤768px):** cards más compactas → imagen `height:200px` (aspect auto), `card-body`
  padding `18px 20px`, h3 1.5rem, gap del grid 20px. Se apilan (1 col ya desde ≤900px).
- Se eliminó todo el CSS de `.split-photo`/`.sp-half`/`.split-line` y los inline de encuadre por cara.
  Las fotos sueltas (`cross-*`, `hybrid-*`, `corredores-*`) ya NO se usan en el index (sí en las
  sub-páginas de programa).
- Verificado por JS: desktop 16:9 (362×204), mobile 200px alto, sin errores de consola.

### 2026-07-18 — Cards compuestas: 4º retoque (corredor cara / diagonal)
- Iteración: 158% cortaba por el borde derecho → 150% la diagonal le tapaba la cara ("se ve menos").
- **Clave:** la cara del chico está a la IZQ de su foto; para que quede entera y despejada de la
  diagonal (que en el medio pasa por ~x51%) hay que acercar/correr a la derecha del corte.
- Valor final: corredores-2 **`195% / 0% 18%`** (cara completa, limpia de la diagonal, centrada en su
  mitad, sin quedar tan pegada como el 175% original).

### 2026-07-18 — Cards compuestas: 3º retoque (corredor + anillas)
- Corredor der (corredores-2, el chico): achicado `175%→158%` + cara a la derecha (`0% 16%`).
- Crossfit izq (cross-1, el de las anillas): la cara está al centro de la foto, así que "achicar" y
  "mover a la izq" son opuestos. El usuario eligió **priorizar izquierda** → `118% / 100% 14%`
  (un toque más grande pero la cara bien ubicada a la izquierda).
- Valores actuales: cross-1 `118% 100% 14%` · cross-2 `170% 27% 40%` · hybrid-2 `155% 78% 62%` ·
  hybrid-1 `140% 60% 59%` · corredores-1 `130% 30% 45%` · corredores-2 `158% 0% 16%`.

### 2026-07-18 — Cards compuestas: 2º retoque (zoom out + cara wallball)
- cross ambas menos zoom, chico corredor menos zoom, y se descubrió que **hybrid-2 (izq) SÍ tiene
  cara** (el del wallball de amarillo, mirando la pelota, ~(47%,58%)) → se reencuadró para mostrarla.
- **Valores finales:** Crossfit L cross-1 `105% / 100% 11%` · R cross-2 `170% / 27% 40%` ·
  Hybrid L hybrid-2 `155% / 78% 62%` (cara wallball) · R hybrid-1 `140% / 60% 59%` (sin cambio) ·
  Corredores L corredores-1 `130% / 30% 45%` (sin cambio) · R corredores-2 `175% / 0% 17%`.

### 2026-07-18 — Cards compuestas: retoque de zoom/encuadre (feedback)
- corredor-2 estaba muy cerca → se alejó (230%→200%). cross alejadas 1-2 pts (135→120, 200→185).
  hybrid-1 no mostraba la cara → se ubicó la cara en (67%,55%) y se reencuadró.
- **Valores finales** (bg-size / bg-position):
  - Crossfit: L cross-1 `120% / 136% 13%` · R cross-2 `185% / 29% 40%`.
  - Hybrid: L hybrid-2 `130% / 82% 38%` · R hybrid-1.PNG `140% / 60% 59%` (cara visible).
  - Corredores: L corredores-1 `130% / 30% 45%` · R corredores-2 `200% / -2% 18%` (cara del chico, alejada).

### 2026-07-18 — Cards compuestas: caras detectadas y centradas por mitad
- Pedido: buscar las caras y centrarlas; en corredores la derecha debía ser la **cara del chico** (2402),
  no la señora.
- Detección con OpenCV: cross-1 cara (46,22) · cross-2 (51,41) · corredores-2 **chico (32,23)** + señora
  (77,29) · hybrid-1/hybrid-2/corredores-1 sin cara detectable (encuadre a ojo).
- Se **refactorizó `.split-photo`**: cada mitad pasó de `<img>` a **`<div class="sp-half">` con
  `background-image`**, para poder `background-size` (zoom) + `background-position` (paneo) por cara.
  Con `<img>`+cover no se podía mover una cara centrada al otro lado; con background sí.
- Valores (bg-size / bg-position) calculados por simulación para centrar cada cara en su cuña:
  - Crossfit: L cross-1 `135% / 97% 14%` · R cross-2 `200% / 30% 40%`.
  - Hybrid: L hybrid-2 `130% / 82% 38%` (medball) · R hybrid-1.PNG `140% / 42% 58%` (cara de la mina).
  - Corredores: L corredores-1 `130% / 30% 45%` · R corredores-2 `230% / 3% 19%` (**cara del chico**,
    con zoom 2.3x para traerla de x32% a la mitad derecha).
- ⚠️ El encuadre por cara es para **desktop (16:9)**. En **mobile** las mitades usan `background-size:
  cover; position:center` (con `!important`) — encuadre aproximado, no el fino por cara.

### 2026-07-18 — Ajuste de encuadre de las cards compuestas (focos)
- Feedback: "no enfoco nada" — con `top center` las fotos mostraban pared/cielo/techo, no a la persona.
- Clave del split: en 16:9 la foto (vertical) llena el ancho y se recorta en vertical → **solo importa
  el % vertical** (`object-position: center YY%`); la mitad izq/der la define el `clip-path`.
- Se simularon las cards reales (con diagonal) y se ajustó:
  - Crossfit: `cross-1` `center 15%` (cara del tipo) · `cross-2` `center center`.
  - Corredores: `corredores-1` `center 82%` (la zancada) · `corredores-2` `center 30%` (runner).
  - **Hybrid: se INVIRTIERON las fotos** (el sujeto de hybrid-2 estaba a la izq de su foto y quedaba
    cortado): izq **`hybrid-2` `center 40%`** (lanzamiento de medball) · der **`hybrid-1.PNG` `center 55%`**
    (la mina en el press, con cara visible). Así se ven las dos personas.
- Limitación del efecto: si el sujeto de una foto cae en la mitad que se recorta, no hay % que lo
  traiga; se resuelve eligiendo bien qué foto va a cada lado (por eso el swap en Hybrid).

### 2026-07-18 — Cards de programas (index): imagen compuesta con diagonal
- Se reemplazaron los 3 placeholders de las cards de programas por un componente **`.split-photo`**:
  - Dos fotos lado a lado separadas por una **diagonal dorada** (#F5A800, 3px). El corte se hace con
    `clip-path` (left `polygon(0 0,56% 0,44% 100%,0 100%)` / right complementario, ~12° de inclinación)
    y la línea es un `<svg>` con `<line>` + `vector-effect: non-scaling-stroke` (mantiene 3px).
  - Ambas fotos en **B&N** (`filter: grayscale(100%)`) → **a color al hacer hover en la card**
    (`.program-card:hover .split-photo img`), transición `filter 0.4s`.
  - Aspect **16:9** en desktop (diagonal vertical). En **≤768px** se apilan verticalmente,
    aspect **3:4** y la diagonal pasa a **horizontal** (se togglean `.line-v` / `.line-h`).
  - Fotos por card (izq `top center` / der `center center`):
    crossfit `cross-1.jpg`/`cross-2.jpg` · hybrid `hybrid-1.PNG`/`hybrid-2.JPEG` ·
    corredores `corredores-1.JPEG`/`corredores-2.JPEG`.
- ⚠️ El pedido apuntaba a `hybrid-1.JPEG`, pero ese archivo **ya no existe** (se reemplazó por
  `hybrid-1.PNG` en un cambio anterior). Se usó `hybrid-1.PNG` (el que existe, y más liviano).
- Verificado por JS: las 6 imágenes cargan, clip-paths y grayscale/hover OK en desktop y mobile.

### 2026-07-18 — Hybrid: cards de "Niveles" → opciones de plan
- Se reemplazaron las 2 cards `Inicial` / `Avanzado` por las dos opciones reales de plan
  (mismo estilo `.level-card`, sin tocar CSS):
  - **"Plan 3 días + 1 corrida"** — "Para quienes buscan equilibrio entre fuerza y running".
  - **"Plan 4 días + 1 corrida"** — "Para quienes quieren maximizar el volumen de entrenamiento".
- El rótulo (`eyebrow`) pasó de "Niveles" a **"Elegí tu plan"** (describe mejor las opciones).

### 2026-07-18 — Hybrid-1 reemplazada por PNG (revertido a cover)
- El usuario cambió la foto: `hybrid-1.JPEG` → **`hybrid-1.PNG`** (1206×1608, 3:4, ~397 KB — mucho
  más liviana que la JPEG de 12,8 MB).
- La nueva es una **escena completa** (press de banca en el gym), no un primer plano → ya no hace
  falta el truco de "alejar". Se **revirtió** a `.prog-media img` normal con `object-fit: cover`
  y `object-position: center center` (el press queda bien encuadrado). Se **eliminó** el CSS
  `.prog-photo-fit` (fondo borroso), ahora sin uso.
- ⚠️ Peso pendiente: ya solo queda `cross-2.jpg` = 21 MB para optimizar (hybrid-1 resuelto con la PNG).

### 2026-06-12 — Se eliminó la sección "Quiénes somos"
- Por decisión del usuario se **borró por completo** la sección `#nosotros` (HTML + todo el CSS
  asociado: `.nosotros-grid`, `.nosotros-text`, `.photo-grid` y toda la animación `.nosotros-visual`
  / `.nv-*` / `jj-*`). No se reemplazó por nada.
- También se quitó el link **"Nosotros"** del navbar (apuntaba a `#nosotros`, ya inexistente) y la
  regla residual en el responsive. La página fluye directo: **Hero → Programas**.

### 2026-06-12 — Fotos de coaches (asesorías) integradas
- El usuario subió `images/coach-erika.png` (433×577) y `images/coach-gonza.png` (538×1427),
  ambas **recortes con fondo transparente** (RGBA).
- Se reemplazaron los placeholders por `<img class="coach-photo">` con `object-fit: cover`,
  proporción 3:4 y un **fondo radial sutil** (`#232323`→`#0d0d0d`) detrás del recorte transparente
  para que la persona no quede flotando.
- `object-position`: Erika `50% 15%` (calza casi exacta en 3:4, con `cover`).
- Gonza: imagen muy alta (538×1427); con `cover` se veía demasiado grande/zoom → se cambió a
  **`object-fit: contain` + `object-position: 50% 100%`** (cuerpo completo, alejado, apoyado abajo).
- El usuario recortó la foto de Gonza (ahora 538×1076, ratio 0.5) y quedó pareja con Erika.
  Se ajustó el tamaño con `padding: 16% 11% 0` en el `<img>`. ⚠️ El archivo venía con un espacio
  en el nombre (`coach-gonza .png`) → se renombró a `coach-gonza.png`.
- Verificado en desktop y mobile: caras visibles, cards parejas. ✅
- Nota: `coach-erika.png` es de baja resolución (433px ancho) → en desktop se agranda un poco;
  si se consigue una más grande, mejora la nitidez.
