// ============================================================================
// Edge Function: create-subscription
// ----------------------------------------------------------------------------
// Crea una suscripción (preapproval) en Mercado Pago POR API, asociada a la
// aplicación cuyo MP_ACCESS_TOKEN se usa. Esto es lo que hace que MP dispare el
// webhook a `process-payment` en una venta real (los planes creados desde el
// panel no-code NO quedaban asociados a la app y por eso el webhook nunca llegaba).
//
// La landing la invoca (pública) después de insertar en `pending_subscriptions`,
// y redirige al atleta al `init_point` que esta función devuelve.
//
// Secretos (Supabase → Edge Functions → Secrets) — NUNCA hardcodear:
//   - MP_ACCESS_TOKEN   (token de la app 684615023666257)
//   - SUPABASE_URL
//   - SERVICE_ROLE_KEY
//
// Deploy: con verify_jwt = OFF (endpoint público, la landing no tiene sesión).
//   supabase functions deploy create-subscription --no-verify-jwt
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PROGRAMS = ['crossfit', 'hybrid', 'corredores']
const BACK_URL = 'https://hbperformance.fit/pago-exitoso.html'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { program, email } = await req.json()

    // --- Validaciones mínimas ---
    if (!program || !PROGRAMS.includes(program)) {
      return json({ ok: false, error: 'Programa inválido.' })
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: 'Email inválido.' })
    }

    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_TOKEN) return json({ ok: false, error: 'Falta MP_ACCESS_TOKEN en Secrets.' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // --- preapproval_plan_id del programa (guardado en site_config por create-plans) ---
    const planKey = `mp_plan_${program}`
    const { data: cfg } = await admin
      .from('site_config')
      .select('key, value')
      .eq('key', planKey)
    const planId = cfg?.[0]?.value
    if (!planId) {
      return json({ ok: false, error: `No hay preapproval_plan configurado para "${program}" (falta ${planKey} en site_config).` })
    }

    // --- Crear la suscripción asociada al plan → queda ligada a la app → dispara webhook ---
    // external_reference = program: así `process-payment` sabe qué pending_subscriptions buscar.
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preapproval_plan_id: planId,
        payer_email: email,
        external_reference: program,
        back_url: BACK_URL,
        status: 'pending', // sin card_token → MP devuelve init_point para que el atleta pague
      }),
    })

    const sub = await mpRes.json()

    if (!mpRes.ok) {
      console.error('MP /preapproval error:', mpRes.status, JSON.stringify(sub))
      return json({ ok: false, error: sub?.message || 'Mercado Pago rechazó la creación de la suscripción.' })
    }

    // init_point (prod) / sandbox_init_point (pruebas)
    const initPoint = sub.init_point || sub.sandbox_init_point
    if (!initPoint) {
      console.error('MP /preapproval sin init_point:', JSON.stringify(sub))
      return json({ ok: false, error: 'Mercado Pago no devolvió un link de checkout.' })
    }

    console.log('Preapproval creada:', sub.id, 'program:', program, 'email:', email)
    return json({ ok: true, init_point: initPoint, preapproval_id: sub.id })

  } catch (err) {
    console.error('create-subscription error:', err)
    return json({ ok: false, error: (err as Error).message ?? 'Error inesperado.' })
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
