// ============================================================================
// Edge Function: cancel-subscription
// ----------------------------------------------------------------------------
// Cancela la suscripción del atleta LOGUEADO, tanto en Mercado Pago como en la DB.
//  - Identifica al atleta por su JWT (getUser del token) — NO confía en ningún id
//    mandado por el front.
//  - Lee su `profiles.mp_subscription_id`.
//  - MP: GET /preapproval/{id} (para capturar next_payment_date) → PUT { status:
//    'cancelled' }.
//  - Si MP confirma → UPDATE profiles: subscription_status='cancelled' y
//    subscription_end = next_payment_date (último día cubierto por lo ya pagado;
//    fallback: subscription_start + ciclos mensuales hasta la próxima fecha futura).
//  - El corte de acceso al vencer subscription_end NO se hace acá (paso aparte).
//
// Deploy: verify_jwt = ON (acción autenticada del atleta).
//   supabase functions deploy cancel-subscription
//
// Secretos: MP_ACCESS_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MP_API = 'https://api.mercadopago.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_TOKEN) return json({ ok: false, error: 'Configuración del servidor incompleta (falta MP_ACCESS_TOKEN).' }, 500)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // --- Identificar al atleta por su JWT (no por un id del front) ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ ok: false, error: 'No autenticado.' }, 401)

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userErr || !user) return json({ ok: false, error: 'Tu sesión expiró. Volvé a iniciar sesión.' }, 401)

    // --- Perfil ---
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('id, mp_subscription_id, subscription_start, subscription_status, program')
      .eq('id', user.id)
      .maybeSingle()

    if (profErr || !profile) return json({ ok: false, error: 'No se encontró tu perfil.' }, 404)

    if (!profile.mp_subscription_id) {
      return json({ ok: false, error: 'No encontramos una suscripción de Mercado Pago asociada a tu cuenta. Si creés que es un error, escribinos por WhatsApp.' })
    }

    const preapprovalId = profile.mp_subscription_id

    // --- GET de la preapproval ANTES de cancelar (para capturar next_payment_date) ---
    let nextPaymentDate: string | null = null
    let autoRecurring: any = null
    const getRes = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
      headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
    })
    if (getRes.ok) {
      const sub = await getRes.json()
      nextPaymentDate = sub?.next_payment_date ?? null
      autoRecurring = sub?.auto_recurring ?? null
      console.log('preapproval pre-cancel:', preapprovalId, 'status:', sub?.status, 'next_payment_date:', nextPaymentDate)
    } else {
      console.warn('No se pudo GET la preapproval antes de cancelar:', getRes.status)
    }

    // --- Cancelar en Mercado Pago ---
    const putRes = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    const putBody = await putRes.json().catch(() => ({}))

    if (!putRes.ok) {
      console.error('MP cancel error:', putRes.status, JSON.stringify(putBody))
      return json({ ok: false, error: putBody?.message || 'Mercado Pago no pudo procesar la cancelación. Probá de nuevo o escribinos por WhatsApp.' })
    }

    // next_payment_date puede venir también en la respuesta del PUT (si el GET no lo trajo)
    if (!nextPaymentDate) nextPaymentDate = putBody?.next_payment_date ?? null

    // --- subscription_end = último día cubierto (next_payment_date, con fallback) ---
    const subscriptionEnd = computeSubscriptionEnd(nextPaymentDate, profile.subscription_start, autoRecurring)

    // --- Actualizar la DB ---
    const { error: updErr } = await admin
      .from('profiles')
      .update({ subscription_status: 'cancelled', subscription_end: subscriptionEnd })
      .eq('id', profile.id)

    if (updErr) {
      console.error('Error actualizando profiles:', updErr)
      // Ya se canceló en MP; avisamos que la DB no se actualizó
      return json({ ok: false, error: 'Cancelamos en Mercado Pago, pero no pudimos actualizar tu cuenta. Escribinos por WhatsApp así lo corregimos.' })
    }

    console.log('Cancelada OK:', profile.id, 'program:', profile.program, 'subscription_end:', subscriptionEnd)
    return json({ ok: true, subscription_end: subscriptionEnd })

  } catch (err) {
    console.error('cancel-subscription error:', err)
    return json({ ok: false, error: (err as Error).message ?? 'Error inesperado.' }, 500)
  }
})

// subscription_end = fecha del próximo cobro (next_payment_date) → el atleta mantiene
// acceso hasta ahí. Si MP no lo devuelve, se calcula avanzando de a 1 ciclo (mensual
// por defecto) desde subscription_start hasta la primera fecha posterior a hoy.
function computeSubscriptionEnd(nextPaymentDate: string | null, subscriptionStart: string | null, autoRecurring: any): string {
  if (nextPaymentDate) {
    // MP lo manda como ISO con hora/timezone → nos quedamos con YYYY-MM-DD
    return String(nextPaymentDate).slice(0, 10)
  }
  const freq = Number(autoRecurring?.frequency) || 1
  const freqType = autoRecurring?.frequency_type || 'months'
  const start = subscriptionStart ? new Date(`${String(subscriptionStart).slice(0, 10)}T00:00:00Z`) : new Date()
  const today = new Date()
  const d = new Date(start.getTime())
  let guard = 0
  while (d <= today && guard < 240) {
    if (freqType === 'days') d.setUTCDate(d.getUTCDate() + freq)
    else d.setUTCMonth(d.getUTCMonth() + freq)
    guard++
  }
  return d.toISOString().slice(0, 10)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
