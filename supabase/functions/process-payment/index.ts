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
// Cambio 2026-07-27 (mail de reactivación): en la rama existingProfile, tras actualizar
//   el profile, se manda un mail vía Resend avisando que la suscripción se reactivó y que
//   entre con su usuario/contraseña de siempre (link al LOGIN, NO a set-password). El fallo
//   del mail se loguea pero NO rompe la reactivación.
//
// Cambio 2026-07-28 (cobro fallido): en la rama subscription_authorized_payment, ahora se mira
//   el estado del cobro puntual (ap.payment.status / ap.status). Si el cobro fue RECHAZADO
//   (rejected / invoice 'recycling') → se setea profiles.payment_failed_at = now (solo la 1ª vez,
//   idempotente) y se manda un mail avisando que tiene 3 días para regularizar; NO se cancela la
//   suscripción. Si el cobro fue APROBADO y había una falla previa → se limpia payment_failed_at
//   (recuperación automática). El corte de acceso a los 3 días lo hace el guard del dashboard.
//
// Cambio 2026-08-13 (I1 — firma del webhook, MODO MONITOR): al inicio se valida la firma x-signature
//   de MP (HMAC-SHA256 del manifest "id:{data.id};request-id:{x-request-id};ts:{ts};" contra el v1 del
//   header, con MP_WEBHOOK_SECRET). ⚠️ Por ahora es MONITOR: solo se loguea "MP SIGNATURE: ok|fail|..."
//   y NO se rechaza nada (para no cortar altas reales). Cuando se confirme en logs que los pagos reales
//   dan 'ok', se pasa a ENFORCE (rechazar 401 en fail). Si falta el secret, se loguea y NO se bloquea.
//
// Secretos: MP_ACCESS_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY, RESEND_API_KEY, MP_WEBHOOK_SECRET.
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
    // --- I1: validar la firma del webhook de MP (MODO MONITOR: loguea pero NO bloquea) ---
    // Va primero, antes de cualquier fetch/mutación, para quedar listo para el enforce futuro.
    // ⚠️ MONITOR: hoy solo se loguea el resultado; NO se corta el flujo aunque la firma falle.
    //    Cuando los logs confirmen que los pagos reales dan 'ok' → pasar a enforce (descomentar el reject).
    const sigResult = await verifyMpSignature(req, Deno.env.get('MP_WEBHOOK_SECRET'))
    console.log('MP SIGNATURE:', sigResult)
    // ENFORCE (futuro): if (sigResult === 'fail') return json({ ok: false, error: 'invalid signature' }, 401)

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
    // Email real del pagador (se resuelve desde el pago de MP en el 1er cobro de un alta nueva).
    // Es el criterio PRIMARIO para matchear el pending correcto; si queda null se usa el fallback por recencia.
    let payerEmail: string | null = null

    if (type.includes('preapproval')) {
      // subscription_preapproval / preapproval → data.id ES la preapproval
      preapprovalId = String(resourceId)
    } else if (type.includes('authorized_payment')) {
      // subscription_authorized_payment → data.id es un authorized_payment (una "cuota"/invoice)
      const apRes = await fetch(`${MP_API}/authorized_payments/${resourceId}`, {
        headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
      })
      const ap = await apRes.json()
      preapprovalId = ap?.preapproval_id ? String(ap.preapproval_id) : null
      if (!preapprovalId) {
        console.log('authorized_payment sin preapproval_id → skip:', JSON.stringify(ap))
        return json({ ok: true, skipped: 'no-preapproval-in-authorized-payment' })
      }

      // --- Cobro recurrente: ¿este cobro puntual falló o salió OK? ---
      // OJO: el status de la preapproval sigue 'authorized' aunque un cobro falle; la señal
      // real del cobro está en el authorized_payment: payment.status (approved|rejected) y el
      // status de la invoice (scheduled|recycling|processed). 'recycling' = rechazado y reintentando.
      const chargeStatus = ap?.payment?.status ? String(ap.payment.status) : null
      const invoiceStatus = ap?.status ? String(ap.status) : null
      const chargeFailed = chargeStatus === 'rejected' || invoiceStatus === 'recycling'
      const chargeApproved = chargeStatus === 'approved'

      if (chargeFailed) {
        // Buscar al atleta por su suscripción
        const { data: prof } = await adminClient
          .from('profiles')
          .select('id, email, full_name, payment_failed_at')
          .eq('mp_subscription_id', preapprovalId)
          .maybeSingle()
        if (!prof) {
          console.log('Cobro fallido pero no hay profile para la suscripción → skip:', preapprovalId)
          return json({ ok: true, skipped: 'payment-failed-no-profile' })
        }
        if (prof.payment_failed_at) {
          // Ya estaba marcado → idempotente: no reenvío mail ni reinicio el contador de 3 días
          console.log('Cobro fallido ya registrado (sin cambios):', prof.email)
          return json({ ok: true, status: 'payment_failed_already_flagged' })
        }
        // Primer cobro fallido del episodio: marcar el timestamp + avisar por mail.
        // NO se toca subscription_status (sigue 'active'); el corte a los 3 días lo hace el guard del dashboard.
        await adminClient
          .from('profiles')
          .update({ payment_failed_at: new Date().toISOString() })
          .eq('id', prof.id)
        await sendPaymentFailedEmail(prof.email, prof.full_name)
        console.log('Cobro fallido registrado + mail enviado:', prof.email)
        return json({ ok: true, status: 'payment_failed_flagged' })
      }

      if (chargeApproved) {
        // ¿Ya existe un profile con esta suscripción? → distingue RENOVACIÓN de ALTA NUEVA.
        const { data: prof } = await adminClient
          .from('profiles')
          .select('id, email, payment_failed_at')
          .eq('mp_subscription_id', preapprovalId)
          .maybeSingle()
        if (prof) {
          // RENOVACIÓN: cobro mensual de un socio que ya tiene cuenta con esta suscripción.
          // No hay nada que dar de alta. Si venía de una falla, se limpia el flag (recuperación).
          if (prof.payment_failed_at) {
            await adminClient
              .from('profiles')
              .update({ payment_failed_at: null })
              .eq('id', prof.id)
            console.log('Cobro recuperado → payment_failed_at limpiado:', prof.email)
          }
          console.log('Renovación (cobro recurrente OK), sin alta:', prof.email)
          return json({ ok: true, status: 'renewal' })
        }
        // No hay profile con esta suscripción → es el PRIMER pago de un alta nueva.
        // Capturar el email real del pagador para el matching por email de más abajo.
        // ⚠️ TEMPORAL: log del authorized_payment para validar el field-path del email en el 1er pago real. SACAR después.
        console.log('TEMP ap payload:', JSON.stringify(ap))
        payerEmail = await resolvePayerEmail(ap, MP_TOKEN)
        console.log('payerEmail resuelto:', payerEmail || '(no se pudo resolver → fallback por recencia)')
        // Sigo al flujo normal de abajo (alta inicial que llega como authorized_payment).
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

      // --- Encontrar el pending correcto ---
      // PRIMARIO: por el email real del pagador (payerEmail). Comparación case-insensitive exacta en JS
      // (evita los comodines %/_ de ilike; los emails pueden llevar '_').
      // FALLBACK: el pending más reciente del programa, SOLO si se creó hace <= 30 min.
      let pending: any = null

      if (payerEmail) {
        const target = payerEmail.toLowerCase().trim()
        const { data: candidates } = await adminClient
          .from('pending_subscriptions')
          .select('*')
          .eq('program', program)
          .order('created_at', { ascending: false })
          .limit(50)
        pending = (candidates ?? []).find((p: any) => (p.email || '').toLowerCase().trim() === target) ?? null
        if (pending) console.log('Pending matcheado por email del pagador:', payerEmail, program)
      }

      if (!pending) {
        // FALLBACK por recencia (solo si el email no matcheó). Para NO cruzar datos entre compradores casi
        // simultáneos, se usa SOLO si hay EXACTAMENTE UN pending del programa creado en la ventana (15 min).
        // Si hay 2+ recientes es ambiguo → no se adivina (cae al chequeo de redundancia / manual de más abajo).
        const RECENT_MS = 15 * 60 * 1000
        const sinceIso = new Date(Date.now() - RECENT_MS).toISOString()
        const { data: recents } = await adminClient
          .from('pending_subscriptions')
          .select('*')
          .eq('program', program)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
        if (recents && recents.length === 1) {
          pending = recents[0]
          console.warn('Pending por recencia (email no matcheó exacto; ÚNICO pending reciente). payer:',
            payerEmail || '(desconocido)', '| pending.email:', pending.email, '| program:', program)
        } else if (recents && recents.length > 1) {
          console.warn('Recencia AMBIGUA: ' + recents.length + ' pendings recientes de "' + program +
            '" y el email del pagador no matcheó → no se adivina (queda para manual).')
        }
      }

      if (!pending) {
        // ¿Ya existe un profile provisionado para esta suscripción (o el email del pagador)? → webhook REDUNDANTE.
        // (Ej.: MP reenvía otro "preapproval updated" DESPUÉS de que el alta ya se hizo; el pending ya se borró.)
        // Skip silencioso —como la renovación—, NO alarma. Chequeo exacto (sin comodines) → si no matchea, cae a manual.
        const { data: bySub } = await adminClient
          .from('profiles').select('id').eq('mp_subscription_id', mpSubscriptionId).maybeSingle()
        let byEmail = null
        if (!bySub && payerEmail) {
          const { data } = await adminClient
            .from('profiles').select('id').eq('email', payerEmail).maybeSingle()
          byEmail = data
        }
        if (bySub || byEmail) {
          console.log('Webhook redundante: el alta ya existe para esta suscripción/email → skip silencioso.',
            'preapproval:', preapprovalId, '| payer_email:', payerEmail || '(desconocido)')
          return json({ ok: true, status: 'already_provisioned' })
        }
        // Ni pending, ni profile previo → no damos de alta a nadie automático. Erika lo resuelve a mano.
        // Buscar "ALTA MANUAL REQUERIDA" en los logs. Devuelve 200 para que MP no reintente (no se auto-resuelve).
        console.error('ALTA MANUAL REQUERIDA: pago autorizado sin pending matcheable.',
          'program:', program, '| payer_email:', payerEmail || '(desconocido)', '| preapproval:', preapprovalId)
        return json({ ok: false, status: 'manual_required' })
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
            subscription_start: new Date().toISOString().split('T')[0],
            subscription_end: null, // limpiar el vencimiento de una cancelación previa (mismo criterio que un alta nueva)
            payment_failed_at: null // reactivación arranca con la ficha de pago limpia
          })
          .eq('email', email)

        // Mail de reactivación (el usuario YA existe y YA tiene contraseña → va al LOGIN, no a set-password).
        // Si el envío falla, se loguea pero NO rompe la reactivación (el dato en la DB es lo prioritario).
        try {
          const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
          if (!RESEND_API_KEY) {
            console.warn('RESEND_API_KEY no configurada → no se envía el mail de reactivación')
          } else {
            const firstName = full_name ? String(full_name).split(' ')[0] : ''
            const resendRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'HB Performance <noreply@hbperformance.fit>',
                to: email,
                subject: 'Tu suscripción fue reactivada',
                html: `<p>¡Hola${firstName ? ' ' + firstName : ''}!</p>
<p>Tu suscripción a <strong>HB Performance</strong> se reactivó. ¡Ya podés volver a entrenar! 💪</p>
<p>Entrá a tu portal con <strong>tu mismo usuario y contraseña de siempre</strong>:</p>
<p><a href="https://hbperformance.fit/app/login.html">https://hbperformance.fit/app/login.html</a></p>
<p>Si no te acordás la contraseña, desde esa misma pantalla podés recuperarla.</p>
<p style="color:#888;font-size:13px;">💡 Si no ves nuestros mails en tu bandeja de entrada, revisá la carpeta de <strong>spam</strong> o "promociones" y marcanos como remitente confiable.</p>
<p>— El equipo de HB Performance</p>`
              })
            })
            if (!resendRes.ok) {
              const errBody = await resendRes.text().catch(() => '')
              console.error('Resend (reactivación) falló:', resendRes.status, errBody)
            } else {
              console.log('Mail de reactivación enviado a:', email)
            }
          }
        } catch (mailErr) {
          console.error('Error enviando el mail de reactivación:', mailErr)
        }
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

// I1: valida la firma x-signature del webhook de MP. NO lanza; devuelve el resultado para loguear.
// Retornos: 'ok' | 'fail' | 'no-secret' | 'no-signature' | 'error'.
// Manifest oficial de MP: "id:{data.id};request-id:{x-request-id};ts:{ts};" (omitir data.id / request-id
// si no vienen; data.id = el del QUERY STRING, en minúsculas). HMAC-SHA256(secret, manifest) hex vs v1.
async function verifyMpSignature(req: Request, secret: string | undefined): Promise<string> {
  try {
    if (!secret) return 'no-secret'
    const xSignature = req.headers.get('x-signature') || ''
    const xRequestId = req.headers.get('x-request-id') || ''
    if (!xSignature) return 'no-signature'

    // Parsear "ts=<...>,v1=<...>"
    let ts = '', v1 = ''
    for (const part of xSignature.split(',')) {
      const idx = part.indexOf('=')
      if (idx === -1) continue
      const k = part.slice(0, idx).trim()
      const val = part.slice(idx + 1).trim()
      if (k === 'ts') ts = val
      else if (k === 'v1') v1 = val
    }
    if (!ts || !v1) return 'no-signature'

    // data.id del query string, en minúsculas (fallback a 'id'); omitir el segmento si falta.
    const url = new URL(req.url)
    const dataId = (url.searchParams.get('data.id') || url.searchParams.get('id') || '').toLowerCase()

    let manifest = ''
    if (dataId) manifest += `id:${dataId};`
    if (xRequestId) manifest += `request-id:${xRequestId};`
    manifest += `ts:${ts};`

    // HMAC-SHA256(secret, manifest) → hex
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(manifest))
    const computed = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')

    if (!constantTimeEqual(computed, v1.toLowerCase())) {
      // En modo monitor este log ayuda a confirmar por qué falla (los valores no son secretos; la key sí).
      console.warn('MP SIGNATURE fail — manifest:', manifest, '| v1(recibido):', v1, '| computed:', computed)
      return 'fail'
    }
    return 'ok'
  } catch (err) {
    console.warn('Error validando la firma de MP:', err)
    return 'error'
  }
}

// Comparación en tiempo constante de dos strings hex (evita timing attacks).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Mail de aviso de cobro fallido (mismo mecanismo Resend que el de reactivación).
// Falla silenciosa: si Resend no está o responde error, se loguea pero no rompe el webhook.
async function sendPaymentFailedEmail(email: string, full_name: string | null) {
  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      console.warn('RESEND_API_KEY no configurada → no se envía el mail de cobro fallido')
      return
    }
    const firstName = full_name ? String(full_name).split(' ')[0] : ''
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'HB Performance <noreply@hbperformance.fit>',
        to: email,
        subject: 'No pudimos procesar tu pago — regularizalo en 3 días',
        html: `<p>¡Hola${firstName ? ' ' + firstName : ''}!</p>
<p>Intentamos cobrar tu suscripción a <strong>HB Performance</strong> y el pago fue <strong>rechazado</strong>.</p>
<p>Mercado Pago va a reintentar el cobro automáticamente. Si no se regulariza en los próximos <strong>3 días</strong>, tu acceso al portal se va a suspender hasta que el pago se acredite.</p>
<p>Para evitarlo, revisá que tu medio de pago tenga fondos y esté vigente. Si necesitás cambiarlo o tenés dudas, escribinos y te ayudamos.</p>
<p>Podés entrar a tu portal cuando quieras:</p>
<p><a href="https://hbperformance.fit/app/login.html">https://hbperformance.fit/app/login.html</a></p>
<p>— El equipo de HB Performance</p>`
      })
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error('Resend (cobro fallido) falló:', res.status, errBody)
    } else {
      console.log('Mail de cobro fallido enviado a:', email)
    }
  } catch (mailErr) {
    console.error('Error enviando el mail de cobro fallido:', mailErr)
  }
}

// Email real del pagador, encadenando authorized_payment → payment → payer.email.
// El objeto `ap` (authorized_payment) trae payment.id; con ese id se consulta /v1/payments/{id},
// que sí expone payer.email. Defensivo: cualquier fallo devuelve null y el matching cae al fallback por recencia.
async function resolvePayerEmail(ap: any, mpToken: string | undefined): Promise<string | null> {
  try {
    const paymentId = ap?.payment?.id
    if (!paymentId) {
      console.warn('authorized_payment sin payment.id → no se puede resolver el email del pagador')
      return null
    }
    const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${mpToken}` }
    })
    if (!res.ok) {
      console.warn('No se pudo GET /v1/payments/{id}:', res.status)
      return null
    }
    const payment = await res.json()
    const email = payment?.payer?.email ? String(payment.payer.email).trim() : ''
    return email || null
  } catch (err) {
    console.warn('Error resolviendo el email del pagador:', err)
    return null
  }
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
