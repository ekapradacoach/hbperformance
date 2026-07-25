// ============================================================================
// Edge Function: create-plans   (uso ÚNICO / one-off)
// ----------------------------------------------------------------------------
// Crea los 3 preapproval_plan de Mercado Pago POR API (uno por programa), con el
// precio mensual de `site_config`, y guarda los IDs resultantes en `site_config`
// bajo las claves mp_plan_crossfit / mp_plan_hybrid / mp_plan_corredores.
//
// Crear los planes por API es lo que los deja asociados a la app (a diferencia de
// los del panel no-code). Después `create-subscription` usa esos IDs.
//
// Cómo correrla: deploy con verify_jwt OFF, invocala UNA vez (curl o el tester del
// dashboard) y revisá el JSON devuelto (trae los preapproval_plan_id). Después
// podés borrar/deshabilitar esta función. También quedan guardados en site_config.
//   supabase functions deploy create-plans --no-verify-jwt
//   curl -X POST https://frjlafrgdcbomdnentbe.supabase.co/functions/v1/create-plans
//
// Secretos: MP_ACCESS_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BACK_URL = 'https://hbperformance.fit/pago-exitoso.html'

// program → { razón visible, clave de precio ARS en site_config }
const PLANS = [
  { slug: 'crossfit',   reason: 'HB Performance — CrossFit',              priceKey: 'price_crossfit_ars' },
  { slug: 'hybrid',     reason: 'HB Performance — Hybrid Evolution',      priceKey: 'price_hybrid_ars' },
  { slug: 'corredores', reason: 'HB Performance — Fuerza para Corredores', priceKey: 'price_corredores_ars' },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_TOKEN) return json({ ok: false, error: 'Falta MP_ACCESS_TOKEN en Secrets.' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Precios desde site_config
    const { data: cfgRows } = await admin.from('site_config').select('key, value')
    const config: Record<string, string> = Object.fromEntries((cfgRows ?? []).map((r) => [r.key, r.value]))

    const results: unknown[] = []

    for (const p of PLANS) {
      const amount = Number(config[p.priceKey])
      if (!amount || isNaN(amount)) {
        results.push({ program: p.slug, error: `precio inválido en site_config (${p.priceKey})` })
        continue
      }

      const mpRes = await fetch('https://api.mercadopago.com/preapproval_plan', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: p.reason,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: amount,
            currency_id: 'ARS',
          },
          back_url: BACK_URL,
        }),
      })

      const plan = await mpRes.json()
      if (!mpRes.ok) {
        console.error(`MP /preapproval_plan error (${p.slug}):`, JSON.stringify(plan))
        results.push({ program: p.slug, error: plan?.message || 'MP error', raw: plan })
        continue
      }

      // Guardar el id en site_config para que create-subscription lo lea
      await admin.from('site_config').upsert(
        { key: `mp_plan_${p.slug}`, value: plan.id },
        { onConflict: 'key' }
      )

      results.push({ program: p.slug, preapproval_plan_id: plan.id, init_point: plan.init_point })
    }

    return json({ ok: true, results })

  } catch (err) {
    console.error('create-plans error:', err)
    return json({ ok: false, error: (err as Error).message ?? 'Error inesperado.' })
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
