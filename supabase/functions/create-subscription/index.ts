// ============================================================================
// Edge Function: create-subscription   (Opción B — redirigir al checkout del PLAN)
// ----------------------------------------------------------------------------
// Devuelve el init_point del preapproval_plan del programa. El atleta completa
// email + tarjeta directamente en el checkout de Mercado Pago; MP crea ahí la
// suscripción asociada al plan (y por lo tanto a la app), así dispara el webhook.
//
// Por qué NO se crea la suscripción por API acá (Opción A descartada):
//   `POST /preapproval` con preapproval_plan_id exige `card_token_id` (tarjeta
//   tokenizada en el front con MP.js) → tiraba "card_token_id is required".
//   Redirigir al checkout del plan evita tener que tokenizar en la landing.
//
// La landing la sigue invocando igual: sb.functions.invoke('create-subscription',
// { body: { program, email } }) y redirige a `init_point`. (email ya no se usa acá,
// lo pide MP en el checkout; el INSERT en pending_subscriptions lo hace la landing.)
//
// NO usa MP_ACCESS_TOKEN (no llama a la API de MP). El token se sigue usando en
// `create-plans` y `process-payment` — no lo borres de Secrets.
//
// Deploy: verify_jwt = OFF (endpoint público, la landing no tiene sesión).
//   supabase functions deploy create-subscription --no-verify-jwt
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PROGRAMS = ['crossfit', 'hybrid', 'corredores']
// Formato del checkout de suscripción por plan (Argentina)
const CHECKOUT_BASE = 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id='

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { program } = await req.json()

    if (!program || !PROGRAMS.includes(program)) {
      return json({ ok: false, error: 'Programa inválido.' })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // preapproval_plan del programa (create-plans guardó el id en site_config)
    const planKey = `mp_plan_${program}`
    const { data: cfg } = await admin
      .from('site_config')
      .select('key, value')
      .eq('key', planKey)
    const stored = cfg?.[0]?.value
    if (!stored) {
      return json({ ok: false, error: `No hay preapproval_plan configurado para "${program}" (falta ${planKey} en site_config).` })
    }

    // Si en site_config ya está el init_point completo, lo uso tal cual;
    // si guardaron solo el id del plan, reconstruyo la URL del checkout.
    const initPoint = /^https?:\/\//.test(stored)
      ? stored
      : `${CHECKOUT_BASE}${stored}`

    console.log('checkout program:', program, '→', initPoint)
    return json({ ok: true, init_point: initPoint })

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
