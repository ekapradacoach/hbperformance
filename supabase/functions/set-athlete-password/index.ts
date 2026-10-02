// ============================================================================
// Edge Function: set-athlete-password   (admin-only)
// ----------------------------------------------------------------------------
// Fija una contraseña NUEVA para un alumno, sin depender de ningún link de mail.
// Pensada para destrabar alumnos cuyo invite / recovery de Supabase falla porque
// Gmail/Outlook "prescanean" (consumen) el link antes de que la persona lo abra.
// El admin fija una contraseña temporal y se la pasa a la persona por WhatsApp.
//
// Seguridad: verify_jwt ON + se valida que QUIEN LLAMA es role='admin' (por su JWT,
// mismo patrón que create-athlete), antes de tocar nada. Usa la service role key para
// admin.auth.admin.updateUserById. El userId se resuelve por email desde `profiles`
// (profiles.id = auth.users.id). NO confía en ningún id mandado por el front.
//
// Body: { athlete_email: string, new_password: string }
// Respuesta: { ok: true } | { ok: false, error }
//
// Deploy: verify_jwt = ON (acción autenticada del admin).
//   supabase functions deploy set-athlete-password
//
// Secretos (ya existen a nivel proyecto): SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MIN_PASSWORD_LEN = 8

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
    const { athlete_email, new_password } = await req.json()
    const email = (athlete_email || '').toString().trim()
    const password = (new_password || '').toString()
    if (!email) return json({ ok: false, error: 'Falta el email del alumno.' }, 400)
    if (!password || password.length < MIN_PASSWORD_LEN) {
      return json({ ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.` }, 400)
    }

    // --- Resolver el userId por email desde profiles (profiles.id = auth.users.id) ---
    // Match EXACTO con .eq (la UI manda el email tal cual está guardado en el perfil; ilike
    // trataría un '_' del email como comodín y podría matchear al alumno equivocado).
    const { data: prof, error: profErr } = await adminClient
      .from('profiles').select('id, full_name, email').eq('email', email).maybeSingle()
    if (profErr) return json({ ok: false, error: 'Error buscando al alumno: ' + profErr.message }, 500)
    if (!prof) return json({ ok: false, error: 'No se encontró un alumno con ese email.' }, 404)

    // --- Fijar la contraseña en Supabase Auth ---
    const { error: updErr } = await adminClient.auth.admin.updateUserById(prof.id, { password })
    if (updErr) return json({ ok: false, error: updErr.message }, 400)

    console.log('Contraseña fijada por admin para:', prof.email)
    return json({ ok: true })

  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
