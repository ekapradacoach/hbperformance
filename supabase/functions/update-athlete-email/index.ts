// ============================================================================
// Edge Function: update-athlete-email   (admin-only)
// ----------------------------------------------------------------------------
// Corrige el email de un alumno (ej. typo "gmail.con" al pagar) en los DOS lugares
// donde vive: Supabase Auth (auth.users) y `profiles.email`. Opcionalmente reenvía
// el mail de ingreso al email corregido.
//
// Seguridad: verify_jwt ON + se valida que QUIEN LLAMA es role='admin' (por su JWT,
// mismo patrón que set-athlete-password), antes de tocar nada. El userId se resuelve
// por old_email desde `profiles` (profiles.id = auth.users.id). NO confía en ids del front.
//
// Consistencia: primero Auth, después profiles. Si profiles falla, se REVIERTE el email
// en Auth para no dejar las dos tablas desincronizadas.
//
// Mail de ingreso (resend_invite=true): se usa un RECOVERY link, no un invite.
//   inviteUserByEmail falla si el usuario ya existe y está confirmado (y acá lo dejamos
//   confirmado con email_confirm:true). El recovery link sirve igual para un alumno que
//   todavía no activó su cuenta: set-password.html lee el access_token del hash, sea de
//   invite o de recovery. Se genera con admin.generateLink({type:'recovery'}) y se manda
//   con Resend (mismo remitente que process-payment) con texto de "activá tu cuenta".
//   Si Resend no está configurado o falla → fallback a resetPasswordForEmail (mail
//   estándar de Supabase Auth).
//
// Body: { old_email: string, new_email: string, resend_invite?: boolean }
// Respuesta: { ok: true, mail?: 'resend'|'supabase'|'none', mail_error?: string } | { ok: false, error }
//
// Deploy: verify_jwt = ON (acción autenticada del admin).
//   supabase functions deploy update-athlete-email
//
// Secretos (ya existen a nivel proyecto): SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// RESEND_API_KEY (opcional: sin ella se usa el mail estándar de Supabase).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const REDIRECT_TO = 'https://hbperformance.fit/app/set-password.html'
// Formato razonable: algo@algo.tld (tld de 2+ letras), sin espacios.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'No autorizado' }, 401)

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // --- Verificar que QUIEN LLAMA es admin (por su JWT, no por nada del body) ---
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'No autorizado' }, 401)
    const { data: caller } = await userClient
      .from('profiles').select('role').eq('id', user.id).single()
    if (!caller || caller.role !== 'admin') return json({ ok: false, error: 'No autorizado' }, 403)

    // --- Datos ---
    const { old_email, new_email, resend_invite } = await req.json()
    const oldEmail = (old_email || '').toString().trim()
    const newEmail = (new_email || '').toString().trim().toLowerCase()
    if (!oldEmail) return json({ ok: false, error: 'Falta el email actual del alumno.' }, 400)
    if (!newEmail || !EMAIL_RE.test(newEmail)) {
      return json({ ok: false, error: 'El email nuevo no tiene un formato válido.' }, 400)
    }
    if (newEmail === oldEmail.toLowerCase()) {
      return json({ ok: false, error: 'El email nuevo es igual al actual.' }, 400)
    }

    // --- Resolver el alumno por old_email (match EXACTO: la UI manda el email tal cual está guardado) ---
    const { data: prof, error: profErr } = await adminClient
      .from('profiles').select('id, full_name, email').eq('email', oldEmail).maybeSingle()
    if (profErr) return json({ ok: false, error: 'Error buscando al alumno: ' + profErr.message }, 500)
    if (!prof) return json({ ok: false, error: 'No se encontró un alumno con ese email.' }, 404)

    // --- El email nuevo no puede estar en uso (profiles ni auth.users), comparando sin mayúsculas ---
    const { data: profRows, error: dupErr } = await adminClient
      .from('profiles').select('id, email').ilike('email', escapeLike(newEmail))
    if (dupErr) return json({ ok: false, error: 'Error verificando el email: ' + dupErr.message }, 500)
    if ((profRows ?? []).some((r: any) => r.id !== prof.id && (r.email || '').toLowerCase() === newEmail)) {
      return json({ ok: false, error: 'Ya existe otro alumno con ese email.' }, 409)
    }
    const authDup = await findAuthUserByEmail(adminClient, newEmail)
    if (authDup.error) return json({ ok: false, error: 'Error verificando el email: ' + authDup.error }, 500)
    if (authDup.id && authDup.id !== prof.id) {
      return json({ ok: false, error: 'Ya existe un usuario con ese email.' }, 409)
    }

    // --- Email anterior en Auth (para revertir exactamente lo que había) ---
    const { data: authUser, error: getErr } = await adminClient.auth.admin.getUserById(prof.id)
    if (getErr || !authUser?.user) {
      return json({ ok: false, error: 'No se encontró el usuario en Auth: ' + (getErr?.message || 'sin datos') }, 404)
    }
    const prevAuthEmail = authUser.user.email || oldEmail

    // --- 1) Auth ---
    const { error: authUpdErr } = await adminClient.auth.admin.updateUserById(prof.id, {
      email: newEmail,
      email_confirm: true
    })
    if (authUpdErr) return json({ ok: false, error: 'No se pudo cambiar el email en Auth: ' + authUpdErr.message }, 400)

    // --- 2) profiles (si falla → revertir Auth) ---
    const { data: updRows, error: profUpdErr } = await adminClient
      .from('profiles').update({ email: newEmail }).eq('id', prof.id).select('id')
    if (profUpdErr || !updRows || updRows.length === 0) {
      const { error: revertErr } = await adminClient.auth.admin.updateUserById(prof.id, { email: prevAuthEmail })
      const why = profUpdErr ? profUpdErr.message : '0 filas actualizadas'
      console.error('update-athlete-email: falló profiles (' + why + ') → revert Auth',
        revertErr ? 'FALLÓ: ' + revertErr.message : 'OK', '| user:', prof.id)
      return json({
        ok: false,
        error: 'No se pudo actualizar el perfil (' + why + '). ' +
          (revertErr ? '⚠️ Tampoco se pudo revertir Auth: ' + revertErr.message : 'No se cambió nada.')
      }, 500)
    }

    console.log('Email de alumno corregido por admin:', oldEmail, '→', newEmail, '| user:', prof.id)

    // --- 3) Mail de ingreso (opcional). El cambio de email YA quedó hecho: si el mail falla, ok:true + mail_error ---
    if (!resend_invite) return json({ ok: true, mail: 'none' })
    const mail = await sendAccessMail(adminClient, newEmail, prof.full_name)
    return json({ ok: true, ...mail })

  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

// Busca un usuario de Auth por email (case-insensitive). supabase-js no trae getUserByEmail →
// se recorre listUsers paginado (el proyecto tiene pocos usuarios; tope de 20 páginas = 20.000).
async function findAuthUserByEmail(adminClient: any, email: string): Promise<{ id?: string, error?: string }> {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { error: error.message }
    const users = data?.users ?? []
    const hit = users.find((u: any) => (u.email || '').toLowerCase() === target)
    if (hit) return { id: hit.id }
    if (users.length < 1000) return {}
  }
  return {}
}

// Reenvía el mail de ingreso con un RECOVERY link (ver cabecera: invite falla con usuarios existentes).
// Vía principal: generateLink + Resend (mail propio, "activá tu cuenta"). Fallback: resetPasswordForEmail.
async function sendAccessMail(adminClient: any, email: string, fullName: string | null):
  Promise<{ mail: 'resend' | 'supabase' | 'none', mail_error?: string }> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (RESEND_API_KEY) {
    try {
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'recovery', email, options: { redirectTo: REDIRECT_TO }
      })
      const link = data?.properties?.action_link
      if (error || !link) throw new Error(error?.message || 'generateLink sin action_link')
      const firstName = fullName ? String(fullName).split(' ')[0] : ''
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'HB Performance <noreply@hbperformance.fit>',
          to: email,
          subject: 'Activá tu cuenta de HB Performance',
          html: `<p>¡Hola${firstName ? ' ' + escHtml(firstName) : ''}!</p>
<p>Ya podés entrar a tu portal de <strong>HB Performance</strong>. Tocá el botón para crear tu contraseña:</p>
<p><a href="${link}" style="display:inline-block;background:#F5A800;color:#0A0A0A;padding:12px 22px;border-radius:8px;font-weight:700;text-decoration:none;">Crear mi contraseña</a></p>
<p>Tu usuario es este email: <strong>${escHtml(email)}</strong>.</p>
<p style="color:#888;font-size:13px;">El link es de un solo uso. Si no funciona, escribinos por WhatsApp y te ayudamos.</p>
<p style="color:#888;font-size:13px;">💡 Si no ves nuestros mails en tu bandeja de entrada, revisá la carpeta de <strong>spam</strong> o "promociones".</p>
<p>— El equipo de HB Performance</p>`
        })
      })
      if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text().catch(() => '')))
      console.log('Mail de ingreso (recovery vía Resend) enviado a:', email)
      return { mail: 'resend' }
    } catch (err) {
      console.warn('Mail de ingreso vía Resend falló → fallback a Supabase:', (err as Error).message)
    }
  }
  // Fallback: mail estándar de Supabase Auth (plantilla "Reset Password").
  const anon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_TO })
  if (error) {
    console.error('Mail de ingreso (resetPasswordForEmail) falló:', error.message)
    return { mail: 'none', mail_error: error.message }
  }
  console.log('Mail de ingreso (recovery estándar de Supabase) enviado a:', email)
  return { mail: 'supabase' }
}

// Escapa % y _ para usar el email en un ilike como match literal (case-insensitive).
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function escHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
