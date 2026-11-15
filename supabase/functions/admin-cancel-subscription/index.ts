// ============================================================================
// Edge Function: admin-cancel-subscription   (admin-only)
// ----------------------------------------------------------------------------
// "Dar de baja" desde el admin, con cancelación en Mercado Pago (finanzas, etapa 0, 2026-11-15).
// Antes, "Dar de baja" solo cambiaba el perfil y la suscripción de MP seguía cobrando.
//
//  - Verifica que QUIEN LLAMA es role='admin' (por su JWT, como set-athlete-password). No confía en el body para eso.
//  - Lee el perfil del alumno (athlete_id). Rechaza: admins, perfiles sin suscripción de MP y semanas de prueba en
//    curso (trial_status = 'in_trial': esas se resuelven desde 🧪 Pruebas).
//  - MP: GET /preapproval/{id}. Si no está cancelada → PUT { status: 'cancelled' } (como cancel-subscription).
//  - RECIÉN si MP canceló (o ya estaba cancelada) → UPDATE profiles: subscription_status='cancelled' + subscription_end
//    (la fecha que eligió el admin). Si MP falla, el perfil no se toca.
//  - Repetirla no hace daño: si ya está cancelada en MP, no la vuelve a cancelar y solo guarda la baja.
//  - Después MP manda el aviso de cancelación: process-payment ve la fecha ya cargada y no la pisa.
//  Logs sin mails ni nombres.
//
// Body: { athlete_id: string, subscription_end: 'YYYY-MM-DD' }
// Respuesta: { ok: true, mp: 'cancelled' | 'already_cancelled', subscription_end }
//          | { ok: false, error, mp_cancelled?: true }   (mp_cancelled: MP ya canceló pero no se guardó la baja)
//
// Deploy: verify_jwt = ON.   supabase functions deploy admin-cancel-subscription
// Secretos (ya existen): MP_ACCESS_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY.
// Prueba: node supabase/tests/admin-cancel-subscription.sim.mjs
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
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

  try {
    const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_TOKEN) return json({ ok: false, error: 'Configuración del servidor incompleta (falta MP_ACCESS_TOKEN).' }, 500)

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '')

    // --- Quien llama tiene que ser admin ---
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ ok: false, error: 'No autorizado' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userErr || !user) return json({ ok: false, error: 'Tu sesión expiró. Volvé a iniciar sesión.' }, 401)
    const { data: caller, error: callerErr } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (callerErr) return json({ ok: false, error: 'No se pudo verificar tu usuario.' }, 500)
    if (!caller || caller.role !== 'admin') return json({ ok: false, error: 'No autorizado' }, 403)

    // --- Datos ---
    const body = await req.json().catch(() => ({}))
    const athleteId = String(body?.athlete_id ?? '').trim()
    const end = String(body?.subscription_end ?? '').trim()
    if (!athleteId) return json({ ok: false, error: 'Falta el alumno.' }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || isNaN(new Date(end + 'T12:00:00Z').getTime())) {
      return json({ ok: false, error: 'La fecha de fin no es válida (AAAA-MM-DD).' }, 400)
    }

    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('id, role, mp_subscription_id, trial_status')
      .eq('id', athleteId)
      .maybeSingle()
    if (profErr) return json({ ok: false, error: 'No se pudo leer el perfil del alumno.' }, 500)
    if (!prof || prof.role !== 'athlete') return json({ ok: false, error: 'No se encontró el alumno.' }, 404)
    if (prof.trial_status === 'in_trial') {
      return json({ ok: false, error: 'Está en la semana de prueba: resolvelo desde 🧪 Pruebas.' }, 409)
    }
    const preapprovalId = prof.mp_subscription_id ? String(prof.mp_subscription_id) : ''
    if (!preapprovalId) return json({ ok: false, error: 'El alumno no tiene una suscripción de Mercado Pago.' }, 400)

    // --- Mercado Pago ---
    const getRes = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
      headers: { 'Authorization': `Bearer ${MP_TOKEN}` },
    })
    const sub = await getRes.json().catch(() => ({}))
    if (!getRes.ok) {
      console.error('Baja desde el admin: no se pudo consultar la suscripción en MP:', getRes.status, '| preapproval:', preapprovalId)
      return json({ ok: false, error: 'No se pudo consultar la suscripción en Mercado Pago. No se cambió nada; probá de nuevo.' }, 502)
    }
    let mpResult: 'cancelled' | 'already_cancelled' = 'already_cancelled'
    if (sub?.status !== 'cancelled') {
      const putRes = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const putBody = await putRes.json().catch(() => ({}))
      if (!putRes.ok) {
        console.error('Baja desde el admin: MP no canceló:', putRes.status, '| preapproval:', preapprovalId)
        const msg = putBody?.message ? ` (${String(putBody.message).slice(0, 200)})` : ''
        return json({ ok: false, error: 'Mercado Pago no pudo cancelar la suscripción' + msg + '. No se cambió nada; probá de nuevo.' }, 502)
      }
      mpResult = 'cancelled'
    }

    // --- Perfil: recién ahora ---
    const { data: upd, error: updErr } = await admin
      .from('profiles')
      .update({ subscription_status: 'cancelled', subscription_end: end })
      .eq('id', prof.id)
      .select('id')
    if (updErr || !upd || upd.length === 0) {
      console.error('REVISAR BAJA: MP canceló pero no se guardó la baja desde el admin:', updErr?.message ?? '0 filas', '| preapproval:', preapprovalId)
      return json({ ok: false, mp_cancelled: true, error: 'Se canceló en Mercado Pago, pero no se guardó la baja. Tocá "Dar de baja" de nuevo (no vuelve a cancelar en MP).' }, 500)
    }

    console.log('Baja desde el admin:', mpResult === 'cancelled' ? 'MP cancelada' : 'MP ya estaba cancelada', '| acceso hasta', end, '| preapproval:', preapprovalId)
    return json({ ok: true, mp: mpResult, subscription_end: end })
  } catch (err) {
    console.error('admin-cancel-subscription error:', (err as Error).message)
    return json({ ok: false, error: 'Error inesperado: ' + ((err as Error).message ?? '') }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
