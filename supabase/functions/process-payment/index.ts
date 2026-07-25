// ============================================================================
// Edge Function: process-payment   (webhook de Mercado Pago)
// ----------------------------------------------------------------------------
// Recibe el webhook de MP cuando una SUSCRIPCIÓN (preapproval) cambia de estado.
// Con status 'authorized' → busca el atleta en `pending_subscriptions` por
// `program` (= external_reference), crea/activa el usuario y borra el pending.
//
// ⚠️ Requiere que la suscripción se haya creado POR API (Edge Function
// `create-subscription`) para que MP realmente dispare este webhook. Los planes
// del panel no-code NO quedan asociados a la app y por eso el webhook no llegaba.
//
// Cambios 2026-07-25 (parseo del payload real, sin tocar la lógica de alta):
//  - Resuelve bien el id de la preapproval según el tipo de evento:
//      · subscription_preapproval        → data.id ES la preapproval
//      · subscription_authorized_payment → data.id es un authorized_payment →
//        se consulta /authorized_payments/{id} para sacar su preapproval_id
//      · payment / otros topics          → se ignoran (no son alta por suscripción)
//  - Tolera body JSON y también IPN por querystring (?type=&id=).
//  - .maybeSingle() en los lookups para no tirar error cuando no hay fila.
//
// Cambio 2026-07-26 (identificar el programa de forma robusta):
//  - Los preapproval_plan NO tienen external_reference seteado, así que no se puede
//    confiar en ese campo. Ahora el `program` se deriva del `preapproval_plan_id` de
//    la suscripción, mapeándolo contra site_config (mp_plan_crossfit/_hybrid/_corredores).
//    external_reference se usa solo como respaldo/validación. Se eliminó el fallback
//    peligroso a 'crossfit' (mandaba todo a crossfit si no había external_reference).
//
// Secretos: MP_ACCESS_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MP_API = 'https://api.mercadopago.com'
const PROGRAMS = ['crossfit', 'hybrid', 'corredores']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )
    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')

    // --- Parseo robusto: body JSON y/o querystring (IPN) ---
    let body: any = {}
    try { body = await req.json() } catch (_) { /* puede venir sin body (IPN) */ }
    const url = new URL(req.url)
    const qpType = url.searchParams.get('type') || url.searchParams.get('topic') || ''
    const qpId = url.searchParams.get('id') || url.searchParams.get('data.id') || ''

    console.log('MP Webhook:', req.method, 'body:', JSON.stringify(body), 'qs:', url.search)

    const type = String(body?.type || body?.topic || qpType || '')
    const action = String(body?.action || '')
    const resourceId = body?.data?.id || body?.id || qpId

    if (!resourceId) {
      return json({ ok: true, skipped: 'no-resource-id' })
    }

    // --- Resolver el ID de la preapproval según el tipo de evento ---
    let preapprovalId: string | null = null

    if (type.includes('preapproval')) {
      // subscription_preapproval / preapproval → data.id ES la preapproval
      preapprovalId = String(resourceId)
    } else if (type.includes('authorized_payment')) {
      // subscription_authorized_payment → data.id es un authorized_payment
      const apRes = await fetch(`${MP_API}/authorized_payments/${resourceId}`, {
        headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
      })
      const ap = await apRes.json()
      preapprovalId = ap?.preapproval_id ? String(ap.preapproval_id) : null
      if (!preapprovalId) {
        console.log('authorized_payment sin preapproval_id → skip:', JSON.stringify(ap))
        return json({ ok: true, skipped: 'no-preapproval-in-authorized-payment' })
      }
    } else {
      // payment u otros topics → no aplican al alta por suscripción
      console.log('Evento ignorado:', type, action)
      return json({ ok: true, skipped: `ignored-type:${type}` })
    }

    // --- Traer la preapproval y su estado ---
    const mpResponse = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
      headers: { 'Authorization': `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' }
    })
    const subscription = await mpResponse.json()
    console.log('MP Preapproval:', JSON.stringify(subscription))

    if (!mpResponse.ok) {
      console.error('No se pudo traer la preapproval:', mpResponse.status, JSON.stringify(subscription))
      return json({ ok: false, error: 'No se pudo obtener la preapproval' }, 502)
    }

    const status = subscription.status
    const mpSubscriptionId = subscription.id
    const externalReference = subscription.external_reference

    if (status === 'pending') {
      return json({ ok: true, status: 'pending_ignored' })
    }

    if (status === 'cancelled') {
      await adminClient
        .from('profiles')
        .update({ subscription_status: 'cancelled' })
        .eq('mp_subscription_id', mpSubscriptionId)
      return json({ ok: true, status: 'cancelled' })
    }

    if (status === 'authorized') {
      // Programa: fuente de verdad = preapproval_plan_id mapeado contra site_config.
      // external_reference solo como respaldo/validación (los planes no lo tienen seteado).
      const program = await resolveProgram(adminClient, subscription)
      if (!program) {
        console.error('No se pudo determinar el program. plan_id:',
          subscription.preapproval_plan_id, 'external_reference:', externalReference)
        return json({ ok: false, error: 'No se pudo determinar el programa de la suscripción' }, 422)
      }

      // Buscar datos del atleta en pending_subscriptions (el más reciente del programa)
      const { data: pending } = await adminClient
        .from('pending_subscriptions')
        .select('*')
        .eq('program', program)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!pending) {
        console.error('No pending subscription para program:', program)
        return json({ ok: false, error: 'No pending subscription data found' }, 404)
      }

      const { email, full_name, phone } = pending

      // ¿El usuario ya existe?
      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('id, subscription_status')
        .eq('email', email)
        .maybeSingle()

      if (existingProfile) {
        await adminClient
          .from('profiles')
          .update({
            subscription_status: 'active',
            mp_subscription_id: mpSubscriptionId,
            subscription_start: new Date().toISOString().split('T')[0]
          })
          .eq('email', email)
      } else {
        // Crear usuario nuevo con invite (email para set-password)
        const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
          redirectTo: 'https://hbperformance.fit/app/set-password.html',
          data: { full_name }
        })

        if (inviteError) {
          console.error('Error inviting user:', inviteError)
          return json({ ok: false, error: inviteError.message }, 500)
        }

        await adminClient.from('profiles').insert({
          id: inviteData.user.id,
          full_name,
          email,
          phone: phone || null,
          role: 'athlete',
          program,
          subscription_status: 'active',
          mp_subscription_id: mpSubscriptionId,
          subscription_start: new Date().toISOString().split('T')[0]
        })
      }

      // Limpiar pending_subscriptions (también actúa de guard de idempotencia)
      await adminClient
        .from('pending_subscriptions')
        .delete()
        .eq('id', pending.id)

      console.log('User created/activated:', email)
    }

    return json({ ok: true })

  } catch (err) {
    console.error('Error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Si en site_config quedó guardado el init_point completo en vez del id pelado,
// extrae el preapproval_plan_id de la URL; si ya es el id, lo devuelve tal cual.
function extractPlanId(value: string): string {
  const m = /preapproval_plan_id=([^&\s]+)/.exec(value ?? '')
  return m ? m[1] : String(value ?? '')
}

// Determina el `program` de una suscripción de forma robusta:
//  1) mapeando su preapproval_plan_id contra site_config (mp_plan_<program>) → fuente de verdad
//  2) external_reference como respaldo (solo si es un program válido) y como validación
async function resolveProgram(adminClient: any, subscription: any): Promise<string | null> {
  const externalReference = subscription?.external_reference ?? null
  const planId = subscription?.preapproval_plan_id ? String(subscription.preapproval_plan_id) : null

  // Mapa plan_id → program desde site_config
  let programByPlan: string | null = null
  if (planId) {
    const keys = PROGRAMS.map((p) => `mp_plan_${p}`)
    const { data: cfgRows } = await adminClient
      .from('site_config')
      .select('key, value')
      .in('key', keys)
    for (const r of (cfgRows ?? [])) {
      if (extractPlanId(r.value) === planId) {
        programByPlan = r.key.replace('mp_plan_', '')
        break
      }
    }
  }

  // external_reference solo si es un program conocido
  const refValid = externalReference && PROGRAMS.includes(externalReference) ? externalReference : null

  // Validación: si el plan_id resuelve un program y external_reference existe pero difiere, avisar
  if (programByPlan && refValid && programByPlan !== refValid) {
    console.warn(`external_reference="${refValid}" != program por plan_id="${programByPlan}" → uso el del plan_id`)
  }
  if (externalReference && !refValid) {
    console.warn(`external_reference="${externalReference}" no es un program válido → se ignora`)
  }

  // Fuente de verdad: plan_id; respaldo: external_reference válido
  return programByPlan ?? refValid
}
