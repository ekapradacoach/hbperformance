// ============================================================================
// Edge Function: create-athlete
// ----------------------------------------------------------------------------
// Alta MANUAL de atleta desde el admin (modal "Asignar atleta"). Valida que quien
// llama es admin (por su JWT), crea el usuario en Supabase Auth con **invite**
// (manda el email para que cree su contraseña) e inserta su fila en `profiles`.
//
// Sirve para asesorías y para los 3 programas grupales (crossfit/hybrid/corredores)
// cuando el pago se hace por fuera de MP (transferencia, efectivo, etc.).
//
// Cambio 2026-07-27: acepta y setea `subscription_end` ("pagado hasta"),
//   `custom_price` (precio manual) y `hybrid_variant` ('3'|'4', solo si program=hybrid).
//   El invite se manda SIEMPRE (ya era así, para cualquier programa).
//
// Secretos: SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROGRAMS = ['crossfit', 'hybrid', 'corredores', 'asesoria-erika', 'asesoria-gonza']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: profile } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const {
      full_name, email, phone, program,
      subscription_end, custom_price, hybrid_variant,
      redirectTo
    } = await req.json()

    if (!full_name || !email || !program) {
      return new Response(JSON.stringify({ error: 'Faltan datos requeridos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (!PROGRAMS.includes(program)) {
      return new Response(JSON.stringify({ error: 'Programa inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Invitar usuario — crea el usuario en Auth Y manda el email de invitación (SIEMPRE)
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo || 'https://hbperformance.fit/app/set-password.html',
      data: { full_name }
    })

    if (inviteError) {
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Normalizar campos nuevos
    const priceNum = (custom_price !== null && custom_price !== undefined && custom_price !== '')
      ? Number(custom_price) : null
    const variant = (program === 'hybrid' && (hybrid_variant === '3' || hybrid_variant === '4'))
      ? String(hybrid_variant) : null

    // Crear perfil con el ID del usuario recién creado
    const { error: profileError } = await adminClient
      .from('profiles')
      .insert({
        id: inviteData.user.id,
        full_name,
        email,
        phone: phone || null,
        role: 'athlete',
        program,
        subscription_status: 'active',
        subscription_start: new Date().toISOString().split('T')[0],
        subscription_end: subscription_end || null,   // "pagado hasta"
        custom_price: (priceNum !== null && !isNaN(priceNum)) ? priceNum : null,
        hybrid_variant: variant
      })

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ ok: true, user_id: inviteData.user.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
