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
// Cambio 2026-09-10 (feature Pagos — registro aditivo en la tabla `payments`):
//   Cada cobro aprobado de MP se registra en `payments` con bruto + neto real. El neto sale de
//   GET /v1/payments/{id} → transaction_details.net_received_amount (mismo endpoint que ya se usaba
//   para el email del pagador → se reutiliza esa llamada en el alta nueva, costo extra 0). En la
//   renovación automática se agrega 1 fetch a /v1/payments. Todo en try/catch: si MP falla, el pago
//   se guarda con net_amount=null y NO se bloquea el alta/renovación. Idempotencia: mp_payment_id
//   UNIQUE + upsert ignoreDuplicates (ON CONFLICT DO NOTHING) → los reintentos de MP no duplican.
//   paid_at = date_approved convertido a hora de Argentina (UTC-3 fijo), no UTC → un pago de fin de
//   mes queda en el mes correcto. Tipos MP: alta_nueva (1er pago) / renovacion_automatica (recurrente).
//
// Cambio 2026-09-27 (corte por cobro fallido basado en INTENTOS, no en plazo fijo): antes el corte era a
//   los 3 días fijos (guard del dashboard) y podía cortar ANTES de que MP reintentara (caso alumno de prueba). Ahora el
//   server escribe `profiles.payment_grace_until` y el dashboard corta cuando hoy > grace_until:
//     · 1er fallo → grace_until = +15 días (backstop por si el 2do webhook nunca llega) + banner + mail.
//     · 2do fallo REAL → grace_until = ahora (corte inmediato). "Real" = retry_attempt de la invoice MAYOR al
//       guardado en el 1er fallo (`payment_failed_attempt`), para no cortar por un REENVÍO del mismo intento.
//     · cobro exitoso → limpia payment_failed_at / payment_grace_until / payment_failed_attempt (recuperación).
//   Requiere columnas nuevas en profiles: payment_grace_until (timestamptz), payment_failed_attempt (int).
//
// Cambio 2026-09-11 (anti-suscripciones-duplicadas): en la rama existingProfile, antes de sobrescribir
//   mp_subscription_id con la suscripción nueva, si el perfil YA tenía otra sub de MP guardada (distinta),
//   se cancela esa vieja en MP (PUT /preapproval/{viejo} status:cancelled) → evita 2 subs del mismo atleta
//   cobrando en paralelo. try/catch, no bloquea el alta. NO busca por email (evita falsos positivos). Solo
//   cubre subs viejas YA vinculadas en profiles (una huérfana nunca guardada no se detecta acá).
//
// Cambio 2026-10-30 (ventana de acceso `access_from`): alta nueva → access_from = lunes de la semana (hora AR).
//   Reactivación (existingProfile) → se mueve al lunes SOLO si la persona vuelve después de haberse ido
//   (isReturningAthlete); si nunca perdió el acceso, conserva el suyo. La renovación no lo toca.
//   ⚠️ Requiere la columna profiles.access_from (supabase/migrations/20261019_access_from.sql): correr el SQL ANTES de deployar.
//
// Cambio 2026-11-01 (ningún cobro aprobado sin registrar): el registro en `payments` ya no depende del camino que tome
//   el aviso. Si el cobro está aprobado y se identifica al perfil (por suscripción o por mail del pagador, sin revincular),
//   se registra. Si falla la consulta a MP o el guardado → 5xx para que MP reintente; es seguro porque mp_payment_id es
//   único. Sin perfil identificable → log "COBRO SIN REGISTRAR". El 1er cobro queda como alta_nueva aunque entre por la
//   rama de renovación. La lógica de gracia y corte NO cambió.
//   Probar antes de cada deploy: node supabase/tests/process-payment-pagos.sim.mjs
//
// Cambio 2026-11-02 (etapa 4 de la semana de prueba): los avisos de una suscripción sin vincular de un plan de prueba
//   van a confirm-trial, que es el único que da esa alta. Una vez vinculada, sigue el flujo normal.
//
// Semana de prueba, etapa 6 (2026-11-05): dos desvíos insertados que SOLO actúan si el perfil de esa suscripción
//   tiene trial_status = in_trial (o charge_rejected en el aviso de cuota). Cualquier otro perfil, o si la lectura
//   falla, sigue exactamente por el código de antes (lo prueba process-payment-etapa6.sim.mjs contra 76c477a).
//   · Cuota: 1er cobro aprobado → converted + alta_nueva; rechazado → corte (cancelled, subscription_end = ayer),
//     charge_rejected y cancelación en MP, sin gracia ni mail de cobro fallido.
//   · Cancelación de MP en prueba → acceso hasta el día de fin de la prueba (subscription_end) y trial_status cancelled.
//   · Una prueba en curso nunca se corta por fecha: solo por estos eventos.
//
// Cambio 2026-11-13 (resultados persistentes): cada aviso deja una fila en mp_webhook_log (ids de MP, estados,
//   respuesta y resultado: registrado / ya_estaba / cobro_sin_registrar / saltado / error), sin mails ni nombres.
//   Lo escribe un envoltorio después de procesar: nunca cambia la respuesta a MP y si falla solo se loguea.
//   SQL: supabase/migrations/20261113_mp_webhook_log.sql.
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

// Datos del aviso en curso para mp_webhook_log, por cliente de Supabase (uno por aviso): así registerMpPayment
// anota el resultado sin cambiar su firma, y dos avisos simultáneos no se mezclan.
const WEBHOOK_CTX = new WeakMap<object, any>()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const ctx: any = {}
  const res = await handleWebhook(req, ctx)
  await recordWebhookResult(ctx, res)
  return res
})

async function handleWebhook(req: Request, ctx: any): Promise<Response> {
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
    WEBHOOK_CTX.set(adminClient, ctx)
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
    ctx.eventType = type || null
    ctx.action = action || null
    ctx.resourceId = resourceId ? String(resourceId) : null

    if (!resourceId) {
      return json({ ok: true, skipped: 'no-resource-id' })
    }

    // --- Resolver el ID de la preapproval según el tipo de evento ---
    let preapprovalId: string | null = null
    // Email real del pagador (se resuelve desde el pago de MP en el 1er cobro de un alta nueva).
    // Es el criterio PRIMARIO para matchear el pending correcto; si queda null se usa el fallback por recencia.
    let payerEmail: string | null = null
    // Objeto payment de MP del 1er cobro (alta nueva). Se trae UNA vez (para email + bruto + neto) y se
    // reutiliza para registrar el pago en `payments` después de crear/reactivar el profile.
    let altaPayment: any = null
    // true = este aviso trae un cobro APROBADO que todavía no se registró (no había perfil con esta suscripción).
    let approvedChargePending = false

    if (type.includes('preapproval')) {
      // subscription_preapproval / preapproval → data.id ES la preapproval
      preapprovalId = String(resourceId)
      ctx.preapprovalId = preapprovalId
    } else if (type.includes('authorized_payment')) {
      // subscription_authorized_payment → data.id es un authorized_payment (una "cuota"/invoice)
      const apRes = await fetch(`${MP_API}/authorized_payments/${resourceId}`, {
        headers: { 'Authorization': `Bearer ${MP_TOKEN}` }
      })
      // Un error transitorio de MP no puede perder el cobro: se pide reintento. 404 = la cuota no existe, reintentar no sirve.
      if (!apRes.ok && apRes.status !== 404) {
        console.error('No se pudo traer el authorized_payment:', apRes.status, resourceId)
        return json({ ok: false, error: 'No se pudo obtener la cuota' }, 502)
      }
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
      ctx.preapprovalId = preapprovalId
      ctx.paymentId = ap?.payment?.id != null ? String(ap.payment.id) : null
      ctx.chargeStatus = chargeStatus
      ctx.invoiceStatus = invoiceStatus

      // Cobro todavía sin resultado: se pide reintento para volver a mirarlo cuando MP lo resuelva.
      if (!chargeFailed && chargeStatus && ['pending', 'in_process', 'authorized'].includes(chargeStatus)) {
        console.log('Cobro en proceso → se pide reintento a MP:', chargeStatus, preapprovalId)
        return json({ ok: false, status: 'charge_in_process' }, 503)
      }

      // --- Semana de prueba (etapa 6): solo perfiles in_trial / charge_rejected. Los demás siguen igual que antes. ---
      if (chargeApproved || chargeFailed) {
        const trialProf = await findTrialProfile(adminClient, preapprovalId, ['in_trial', 'charge_rejected'])
        if (trialProf) return await handleTrialCharge(adminClient, trialProf, ap, chargeApproved, MP_TOKEN)
      }

      // Cobro aprobado con la cuota todavía en 'recycling': el dinero entró, se registra. Después sigue la lógica
      // de gracia de abajo tal como estaba.
      if (chargeFailed && chargeApproved) {
        const { data: paidProf } = await adminClient
          .from('profiles')
          .select('id, program, subscription_start')
          .eq('mp_subscription_id', preapprovalId)
          .maybeSingle()
        if (paidProf) {
          const paid = await fetchPaymentFromAp(ap, MP_TOKEN)
          const saved = await registerMpPayment(adminClient, paidProf.id, paidProf.program ?? null, paid,
            await mpChargeType(adminClient, paidProf.id, paidProf.subscription_start, paid))
          if (!saved) return json({ ok: false, error: 'No se pudo registrar el cobro' }, 500)
        } else {
          ctx.unregistered = 'aprobado con cuota en recycling y sin perfil'
          console.error('COBRO SIN REGISTRAR: aprobado con cuota en recycling y sin perfil. preapproval:', preapprovalId, '| payment:', ap?.payment?.id)
        }
      }

      if (chargeFailed) {
        // Política de corte (2026-09-27): el deadline lo decide el server en `payment_grace_until`; el
        // dashboard corta cuando hoy > grace_until. 1er fallo → gracia con backstop de 15 días. 2do fallo
        // REAL → corte inmediato (grace_until = ahora). Un cobro exitoso limpia todo (recuperación automática).
        //
        // Dedup: MP puede REENVIAR el webhook del MISMO intento fallido. Para no cortar por un reenvío,
        // usamos `ap.retry_attempt` (nº de reintento de la invoice, provisto por MP): un fallo cuenta como
        // "2do real" solo si su retry_attempt es MAYOR al que guardamos en el 1er fallo. Si MP no manda
        // retry_attempt, NO cortamos por 2do fallo y dejamos que actúe el backstop de 15 días.
        const retryAttempt = (ap?.retry_attempt != null && !isNaN(Number(ap.retry_attempt))) ? Number(ap.retry_attempt) : null

        const { data: prof } = await adminClient
          .from('profiles')
          .select('id, email, full_name, payment_failed_at, payment_failed_attempt, payment_grace_until')
          .eq('mp_subscription_id', preapprovalId)
          .maybeSingle()
        if (!prof) {
          console.log('Cobro fallido pero no hay profile para la suscripción → skip:', preapprovalId)
          return json({ ok: true, skipped: 'payment-failed-no-profile' })
        }

        const GRACE_BACKSTOP_MS = 15 * 24 * 60 * 60 * 1000 // red de seguridad si el 2do webhook de fallo nunca llega

        if (!prof.payment_failed_at) {
          // PRIMER fallo del episodio: gracia (banner) + backstop 15 días + mail. NO corta todavía.
          // NO toca subscription_status (sigue 'active'); el corte lo decide el guard del dashboard vía grace_until.
          await adminClient
            .from('profiles')
            .update({
              payment_failed_at: new Date().toISOString(),
              payment_grace_until: new Date(Date.now() + GRACE_BACKSTOP_MS).toISOString(),
              payment_failed_attempt: retryAttempt
            })
            .eq('id', prof.id)
          await sendPaymentFailedEmail(prof.email, prof.full_name)
          console.log('1er cobro fallido → gracia + backstop 15d. retry_attempt:', retryAttempt, '·', prof.email)
          return json({ ok: true, status: 'payment_failed_flagged' })
        }

        // Episodio YA abierto. ¿Es un SEGUNDO intento REAL (retry_attempt mayor al del 1er fallo) o un reenvío?
        const firstAttempt = (prof.payment_failed_attempt != null) ? Number(prof.payment_failed_attempt) : null
        const isDistinctLaterAttempt = retryAttempt != null && firstAttempt != null && retryAttempt > firstAttempt

        if (isDistinctLaterAttempt) {
          // SEGUNDO fallo real → corte INMEDIATO: grace_until = ahora (el dashboard corta en la próxima entrada).
          await adminClient
            .from('profiles')
            .update({
              payment_grace_until: new Date().toISOString(),
              payment_failed_attempt: retryAttempt
            })
            .eq('id', prof.id)
          console.log('2do cobro fallido REAL (retry_attempt', firstAttempt, '→', retryAttempt, ') → corte inmediato:', prof.email)
          return json({ ok: true, status: 'payment_failed_cut' })
        }

        // Reenvío del mismo intento (o MP no mandó retry_attempt) → idempotente, no corta; sigue vigente el backstop.
        console.log('Cobro fallido repetido/sin retry_attempt nuevo → sin cambios (backstop 15d vigente). retry_attempt:', retryAttempt, '| first:', firstAttempt, '·', prof.email)
        return json({ ok: true, status: 'payment_failed_already_flagged' })
      }

      if (chargeApproved) {
        // ¿Ya existe un profile con esta suscripción? → distingue RENOVACIÓN de ALTA NUEVA.
        const { data: prof } = await adminClient
          .from('profiles')
          .select('id, email, program, subscription_start, payment_failed_at, payment_grace_until')
          .eq('mp_subscription_id', preapprovalId)
          .maybeSingle()
        if (prof) {
          // RENOVACIÓN: cobro mensual de un socio que ya tiene cuenta con esta suscripción.
          // No hay nada que dar de alta. Si venía de una falla, se limpian TODOS los flags (recuperación).
          if (prof.payment_failed_at || prof.payment_grace_until) {
            await adminClient
              .from('profiles')
              .update({ payment_failed_at: null, payment_grace_until: null, payment_failed_attempt: null })
              .eq('id', prof.id)
            console.log('Cobro recuperado → flags de fallo limpiados:', prof.email)
          }
          // Registrar el cobro recurrente en `payments`. 1 fetch extra a /v1/payments (bruto+neto).
          // try/catch adentro del helper → si MP falla, no rompe la renovación.
          const renewalPayment = await fetchPaymentFromAp(ap, MP_TOKEN)
          const saved = await registerMpPayment(adminClient, prof.id, prof.program ?? null, renewalPayment,
            await mpChargeType(adminClient, prof.id, prof.subscription_start, renewalPayment))
          if (!saved) return json({ ok: false, error: 'No se pudo registrar el cobro' }, 500)
          console.log('Renovación (cobro recurrente OK), sin alta:', prof.email)
          return json({ ok: true, status: 'renewal' })
        }
        // No hay profile con esta suscripción → es el PRIMER pago de un alta nueva.
        // Traer el payment de MP UNA sola vez: de ahí sale el email del pagador (para el matching por
        // email de más abajo) y también el bruto+neto para registrar el pago tras crear el profile.
        altaPayment = await fetchPaymentFromAp(ap, MP_TOKEN)
        approvedChargePending = true
        payerEmail = altaPayment?.payer?.email ? (String(altaPayment.payer.email).trim() || null) : null
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
    ctx.subscriptionStatus = status ?? null
    const mpSubscriptionId = subscription.id
    const externalReference = subscription.external_reference

    if (status === 'pending') {
      // Con un cobro aprobado la suscripción debería pasar a authorized enseguida: se reintenta para no perderlo.
      if (approvedChargePending) return json({ ok: false, status: 'subscription_not_ready' }, 503)
      return json({ ok: true, status: 'pending_ignored' })
    }

    // Registra el cobro aprobado de este aviso contra un perfil ya identificado. true si quedó guardado o no había cobro.
    const registerCharge = async (prof: any, fallbackProgram: string | null): Promise<boolean> => {
      if (!approvedChargePending) return true
      return await registerMpPayment(adminClient, prof.id, prof.program ?? fallbackProgram, altaPayment,
        await mpChargeType(adminClient, prof.id, prof.subscription_start, altaPayment))
    }
    const logUnregisteredCharge = (reason: string) => {
      if (approvedChargePending) {
        ctx.unregistered = reason
        console.error('COBRO SIN REGISTRAR:', reason, '| preapproval:', preapprovalId, '| payment:', altaPayment?.id ?? '(desconocido)')
      }
    }

    if (status === 'cancelled') {
      // --- Semana de prueba (etapa 6): cancelación durante la prueba. Los demás perfiles siguen igual que antes. ---
      const trialCancel = await findTrialProfile(adminClient, mpSubscriptionId, ['in_trial'])
      if (trialCancel) return await handleTrialCancel(adminClient, trialCancel)

      logUnregisteredCharge('suscripción cancelada y sin perfil vinculado')
      await adminClient
        .from('profiles')
        .update({ subscription_status: 'cancelled' })
        .eq('mp_subscription_id', mpSubscriptionId)
      // Una prueba cancelada sin alta ya no va a cobrar: su caso se cierra. No bloquea la cancelación.
      await adminClient
        .from('trial_reviews')
        .update({ resolved_at: new Date().toISOString() })
        .eq('preapproval_id', mpSubscriptionId)
      return json({ ok: true, status: 'cancelled' })
    }

    if (status === 'authorized') {
      // Si esta suscripción ya está vinculada a un perfil, no se busca ningún pending: un pending reciente
      // puede ser de OTRA persona. Si la consulta falla, se responde 500 para que MP reintente.
      const { data: linked, error: linkedErr } = await adminClient
        .from('profiles').select('id, program, subscription_start').eq('mp_subscription_id', mpSubscriptionId).limit(2)
      if (linkedErr) {
        console.error('No se pudo chequear si la suscripción ya está vinculada:', linkedErr.message)
        return json({ ok: false, error: 'No se pudo verificar la suscripción' }, 500)
      }
      if (linked && linked.length > 0) {
        console.log('Aviso de suscripción ya vinculada → sin alta ni búsqueda de pending:', mpSubscriptionId)
        // El perfil pudo aparecer mientras se procesaba este cobro (avisos casi simultáneos). Con dos perfiles no se adivina.
        if (linked.length === 1) {
          if (!(await registerCharge(linked[0], null))) return json({ ok: false, error: 'No se pudo registrar el cobro' }, 500)
        } else {
          logUnregisteredCharge('suscripción vinculada a más de un perfil')
        }
        return json({ ok: true, status: 'already_provisioned' })
      }

      // Plan de prueba sin vincular: el alta la decide confirm-trial, nunca este flujo.
      const trialPlan = await isTrialPlan(adminClient, subscription)
      if (trialPlan === null) {
        console.error('No se pudieron leer los planes de prueba')
        return json({ ok: false, error: 'No se pudo verificar el plan' }, 500)
      }
      if (trialPlan) {
        logUnregisteredCharge('primer cobro de una prueba sin vincular')
        return await delegateToConfirmTrial(mpSubscriptionId, approvedChargePending)
      }

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
      // FALLBACK: por recencia (ventana de 15 min), ver abajo.
      let pending: any = null

      if (payerEmail) {
        const target = normEmail(payerEmail)
        const { data: candidates } = await adminClient
          .from('pending_subscriptions')
          .select('*')
          .eq('program', program)
          .eq('is_trial', false) // un pending de prueba nunca da de alta a una compra paga
          .order('created_at', { ascending: false })
          .limit(50)
        pending = (candidates ?? []).find((p: any) => normEmail(p.email) === target) ?? null
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
          .eq('is_trial', false)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
        // Varios pendings recientes del MISMO email = una sola persona que reintentó el pago y llenó el modal
        // otra vez (caso real 2026-10-15) → no es ambiguo: se toma el más reciente (recents viene DESC).
        const recentEmails = new Set((recents ?? []).map((p: any) => normEmail(p.email)))
        if (recents && recents.length >= 1 && recentEmails.size === 1) {
          pending = recents[0]
          console.warn('Pending por recencia (email no matcheó exacto; ' +
            (recents.length === 1 ? 'ÚNICO pending reciente' : recents.length + ' pendings recientes del MISMO email') +
            '). payer:', payerEmail || '(desconocido)', '| pending.email:', pending.email, '| program:', program)
        } else if (recents && recents.length > 1) {
          console.warn('Recencia AMBIGUA: ' + recents.length + ' pendings recientes de "' + program +
            '" con ' + recentEmails.size + ' emails distintos y el email del pagador no matcheó → no se adivina (queda para manual).')
        }
      }

      if (!pending) {
        // ¿Ya existe un profile provisionado para esta suscripción (o el email del pagador)? → webhook REDUNDANTE.
        // (Ej.: MP reenvía otro "preapproval updated" DESPUÉS de que el alta ya se hizo; el pending ya se borró.)
        // Skip silencioso —como la renovación—, NO alarma. Chequeo exacto (sin comodines) → si no matchea, cae a manual.
        const { data: bySub } = await adminClient
          .from('profiles').select('id, program, subscription_start').eq('mp_subscription_id', mpSubscriptionId).maybeSingle()
        let byEmail = null
        if (!bySub && payerEmail) {
          const { data } = await adminClient
            .from('profiles').select('id, program, subscription_start').eq('email', payerEmail).maybeSingle()
          byEmail = data
        }
        if (bySub || byEmail) {
          console.log('Webhook redundante: el alta ya existe para esta suscripción/email → skip silencioso.',
            'preapproval:', preapprovalId, '| payer_email:', payerEmail || '(desconocido)')
          // Cobro real de un perfil identificado: se registra aunque la suscripción guardada sea otra. No se revincula solo.
          if (!bySub && approvedChargePending) {
            console.error('SUSCRIPCION SIN VINCULAR: cobro registrado por mail del pagador; revisar el id guardado. preapproval:', preapprovalId, '| perfil:', byEmail.id)
          }
          if (!(await registerCharge(bySub || byEmail, program))) return json({ ok: false, error: 'No se pudo registrar el cobro' }, 500)
          return json({ ok: true, status: 'already_provisioned' })
        }
        // Ni pending, ni profile previo → no damos de alta a nadie automático. Erika lo resuelve a mano.
        // Buscar "ALTA MANUAL REQUERIDA" en los logs. Devuelve 200 para que MP no reintente (no se auto-resuelve).
        console.error('ALTA MANUAL REQUERIDA: pago autorizado sin pending matcheable.',
          'program:', program, '| payer_email:', payerEmail || '(desconocido)', '| preapproval:', preapprovalId)
        logUnregisteredCharge('sin perfil ni pending')
        return json({ ok: false, status: 'manual_required' })
      }

      const { email, full_name, phone } = pending

      // ¿El usuario ya existe?
      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('id, subscription_status, subscription_end, payment_grace_until, mp_subscription_id')
        .eq('email', email)
        .maybeSingle()

      // athlete_id del alta (para registrar el pago en `payments` más abajo). Se setea en cada rama.
      let altaAthleteId: string | null = existingProfile ? existingProfile.id : null

      if (existingProfile) {
        // ¿VUELVE después de haberse ido? Se calcula ANTES del update (que limpia payment_grace_until).
        // Solo en ese caso se mueve access_from; un alumno que nunca perdió el acceso y se re-suscribe
        // (cambio de tarjeta / programa / duplicado) conserva el suyo.
        const returning = isReturningAthlete(existingProfile)
        const oldSubId = existingProfile.mp_subscription_id

        const { error: reactivateError } = await adminClient
          .from('profiles')
          .update({
            ...(returning ? { access_from: arMondayStr() } : {}),
            subscription_status: 'active',
            mp_subscription_id: mpSubscriptionId,
            subscription_start: new Date().toISOString().split('T')[0],
            subscription_end: null, // limpiar el vencimiento de una cancelación previa (mismo criterio que un alta nueva)
            payment_failed_at: null, // reactivación arranca con la ficha de pago limpia
            payment_grace_until: null,
            payment_failed_attempt: null
          })
          .eq('email', email)

        // Sin guardar no hay alta: 500 para que MP reintente, conservando el pending.
        if (reactivateError) {
          console.error('PERFIL NO GUARDADO (reactivación):', reactivateError.message, '| preapproval:', preapprovalId)
          return json({ ok: false, error: 'No se pudo guardar el perfil' }, 500)
        }

        // SEGURIDAD anti-duplicados: si el perfil YA tenía OTRA suscripción de MP guardada, cancelarla en MP
        // recién DESPUÉS de guardar la nueva → evita 2 suscripciones del mismo atleta cobrando en paralelo, y si el
        // guardado falla la vieja sigue viva.
        // Mismo patrón que cancel-subscription (PUT /preapproval/{id} status:cancelled). try/catch: si falla,
        // se loguea y NO bloquea el alta (el dato correcto en la DB es lo prioritario). NO busca por email
        // (evita falsos positivos si el mail se comparte). Solo cubre subs viejas YA vinculadas en profiles.
        if (oldSubId && String(oldSubId) !== String(mpSubscriptionId)) {
          try {
            const cancelRes = await fetch(`${MP_API}/preapproval/${oldSubId}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' })
            })
            if (cancelRes.ok) {
              console.log('Suscripción vieja cancelada en MP (anti-duplicado):', oldSubId, '→ nueva:', mpSubscriptionId)
            } else {
              const errTxt = await cancelRes.text().catch(() => '')
              console.warn('No se pudo cancelar la suscripción vieja en MP (no bloquea el alta):', oldSubId, cancelRes.status, errTxt)
            }
          } catch (cancelErr) {
            console.warn('Error cancelando la suscripción vieja en MP (no bloquea el alta):', oldSubId, cancelErr)
          }
        }

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

        // Mail ya confirmado en Auth y sin perfil (ej.: perfil borrado desde el admin y la persona vuelve a pagar):
        // el invite da email_exists. Se reusa ese usuario: no se puede borrar si tiene archivos en Storage.
        let athleteUserId: string | null = inviteData?.user?.id ?? null
        const reuseAuthUser = !!inviteError && (inviteError.code === 'email_exists' || inviteError.status === 422)

        if (inviteError && !reuseAuthUser) {
          console.error('Error inviting user:', inviteError)
          return json({ ok: false, error: inviteError.message }, 500)
        }

        if (reuseAuthUser) {
          const authUser = await findAuthUserByEmail(adminClient, email)
          if (authUser.error || !authUser.id) {
            console.error('ALTA MANUAL REQUERIDA: el invite dice que el mail existe y no se encontró en Auth:', authUser.error || 'sin usuario', '| preapproval:', preapprovalId)
            return json({ ok: false, error: 'No se pudo resolver el usuario de Auth' }, 500)
          }
          // El perfil se buscó por mail exacto: puede existir con otra mayúscula. Nunca pisarlo.
          const { data: profileById, error: lookupError } = await adminClient
            .from('profiles').select('id').eq('id', authUser.id).maybeSingle()
          if (lookupError || profileById) {
            console.error('ALTA MANUAL REQUERIDA: el usuario de Auth ya tiene perfil o no se pudo comprobar. preapproval:', preapprovalId)
            return json({ ok: false, error: 'El usuario de Auth ya tiene perfil o no se pudo comprobar' }, 500)
          }
          athleteUserId = authUser.id
          console.warn('Usuario de Auth sin perfil: se reusa. preapproval:', preapprovalId)
        }

        const { error: insertError } = await adminClient.from('profiles').insert({
          id: athleteUserId,
          full_name,
          email,
          phone: phone || null,
          role: 'athlete',
          program,
          subscription_status: 'active',
          mp_subscription_id: mpSubscriptionId,
          subscription_start: new Date().toISOString().split('T')[0],
          access_from: arMondayStr()   // create-athlete (alta manual) NO lo setea
        })
        if (insertError) {
          console.error('PERFIL NO GUARDADO (alta nueva):', insertError.message, '| preapproval:', preapprovalId)
          // Un usuario reusado queda como estaba: el reintento vuelve a pasar por acá.
          if (reuseAuthUser) return json({ ok: false, error: 'No se pudo guardar el perfil' }, 500)
          // Sin borrar el usuario de Auth, el reintento de MP fallaría siempre en el invite (mail ya registrado).
          // Solo se borra si seguro no tiene perfil.
          const { data: profileById, error: lookupError } = await adminClient
            .from('profiles').select('id').eq('id', athleteUserId).maybeSingle()
          if (!lookupError && !profileById) {
            const { error: deleteError } = await adminClient.auth.admin.deleteUser(athleteUserId)
            if (deleteError) console.error('ALTA MANUAL REQUERIDA: no se pudo borrar el usuario de Auth, el reintento va a fallar:', deleteError.message)
          } else {
            console.error('ALTA MANUAL REQUERIDA: el usuario de Auth ya tiene perfil o no se pudo comprobar. No se borra. preapproval:', preapprovalId)
          }
          return json({ ok: false, error: 'No se pudo guardar el perfil' }, 500)
        }
        altaAthleteId = athleteUserId
        if (reuseAuthUser) await sendAccessMail(adminClient, email, full_name)
      }

      // Registrar el pago del alta en `payments` (bruto+neto del payment ya traído). No bloquea el alta.
      // Si el aviso fue de preapproval no hay cobro todavía: lo registra el authorized_payment.
      let altaChargeSaved = true
      if (altaAthleteId && approvedChargePending) {
        altaChargeSaved = await registerMpPayment(adminClient, altaAthleteId, program, altaPayment, 'alta_nueva')
      }

      // Limpiar pending_subscriptions (también actúa de guard de idempotencia). Se borran TODOS los pendings de
      // ese email+programa, no solo el matcheado: si quedaba un duplicado de un reintento, un webhook redundante
      // posterior lo agarraría por recencia. Se filtra en JS (comparación exacta, sin comodines de ilike).
      const { data: samePendings } = await adminClient
        .from('pending_subscriptions')
        .select('id, email')
        .eq('program', program)
        .eq('is_trial', false)
      const pendingIds = (samePendings ?? [])
        .filter((p: any) => normEmail(p.email) === normEmail(email))
        .map((p: any) => p.id)
      if (!pendingIds.includes(pending.id)) pendingIds.push(pending.id)
      await adminClient
        .from('pending_subscriptions')
        .delete()
        .in('id', pendingIds)

      console.log('User created/activated:', email)
      // El alta ya quedó hecha: el reintento de MP entra por la rama de renovación y solo registra el cobro.
      if (!altaChargeSaved) return json({ ok: false, error: 'No se pudo registrar el cobro' }, 500)
    } else {
      logUnregisteredCharge('suscripción en estado ' + status)
    }

    return json({ ok: true })

  } catch (err) {
    console.error('Error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
}

// Guarda el resultado del aviso en mp_webhook_log. Nunca tira ni cambia la respuesta: si falla (por ejemplo, el SQL
// todavía no se corrió) solo se loguea. Sin datos personales: ids de MP, estados y un motivo corto sin mails.
async function recordWebhookResult(ctx: any, res: Response): Promise<void> {
  try {
    const body: any = await res.clone().json().catch(() => ({}))
    const http = res.status
    const rawReason = [body?.status, body?.skipped, body?.error, ctx.unregistered].filter(Boolean).join(' | ')
    let result: string
    if (http >= 500) result = 'error'
    else if (ctx.paymentSaved) result = ctx.paymentNew === false ? 'ya_estaba' : 'registrado'
    else if (ctx.unregistered) result = 'cobro_sin_registrar'
    // Aviso con cobro que no terminó guardado ni explicado (ni rechazado ni en recycling): a revisar.
    else if (ctx.paymentId && http < 400 && ctx.chargeStatus !== 'rejected' && ctx.invoiceStatus !== 'recycling') result = 'cobro_sin_registrar'
    else result = 'saltado'
    const reason = (result === 'cobro_sin_registrar' && !ctx.unregistered && ctx.paymentId
      ? 'cobro en estado ' + (ctx.chargeStatus ?? 'desconocido') + (rawReason ? ' | ' + rawReason : '')
      : rawReason)
      .replace(/[^\s@|]+@[^\s@|]+/g, '[mail]').slice(0, 300) || null
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '')
    const { error } = await client.from('mp_webhook_log').insert({
      event_type: ctx.eventType ?? null,
      action: ctx.action ?? null,
      resource_id: ctx.resourceId ?? null,
      preapproval_id: ctx.preapprovalId ?? null,
      payment_id: ctx.paymentId ?? null,
      charge_status: ctx.chargeStatus ?? null,
      invoice_status: ctx.invoiceStatus ?? null,
      subscription_status: ctx.subscriptionStatus ?? null,
      http_status: http,
      result,
      reason,
    })
    if (error) console.error('mp_webhook_log: no se pudo guardar el resultado del aviso:', error.message)
  } catch (err) {
    console.error('mp_webhook_log: excepción al guardar el resultado del aviso:', (err as Error).message)
  }
}

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

// Trae el objeto `payment` de MP a partir del authorized_payment (`ap.payment.id` → GET /v1/payments/{id}).
// Ese objeto expone payer.email, transaction_amount (bruto), transaction_details.net_received_amount (neto)
// y date_approved. Se usa para el matching por email Y para registrar el pago con bruto+neto en una sola
// llamada. Defensivo: cualquier fallo devuelve null (el matching cae al fallback por recencia; el pago se
// registra con net_amount=null sin bloquear el alta).
async function fetchPaymentFromAp(ap: any, mpToken: string | undefined): Promise<any | null> {
  try {
    const paymentId = ap?.payment?.id
    if (!paymentId) {
      console.warn('authorized_payment sin payment.id → no se puede traer el payment de MP')
      return null
    }
    const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${mpToken}` }
    })
    if (!res.ok) {
      console.warn('No se pudo GET /v1/payments/{id}:', res.status)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn('Error trayendo el payment de MP:', err)
    return null
  }
}

// Busca en Auth por mail (la API de admin no filtra por mail). Mismo criterio que update-athlete-email.
async function findAuthUserByEmail(adminClient: any, email: string): Promise<{ id?: string, error?: string }> {
  const target = normEmail(email)
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { error: error.message }
    const users = data?.users ?? []
    const hit = users.find((u: any) => normEmail(u.email) === target)
    if (hit) return { id: hit.id }
    if (users.length < 1000) return {}
  }
  return {}
}

// Mail de ingreso para un usuario de Auth reusado: RECOVERY link, porque el invite no sirve con un usuario confirmado.
// Si falla se loguea y NO rompe el alta: la persona puede entrar con "¿Olvidaste tu contraseña?".
async function sendAccessMail(adminClient: any, email: string, fullName: string | null): Promise<void> {
  const redirectTo = 'https://hbperformance.fit/app/set-password.html'
  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const { data, error } = await adminClient.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    const link = data?.properties?.action_link
    if (!RESEND_API_KEY || error || !link) throw new Error(error?.message || 'sin RESEND_API_KEY o sin link')
    const firstName = fullName ? escHtml(String(fullName).split(' ')[0]) : ''
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HB Performance <noreply@hbperformance.fit>',
        to: email,
        subject: 'Activá tu cuenta de HB Performance',
        html: `<p>¡Hola${firstName ? ' ' + firstName : ''}!</p>
<p>Ya podés entrar a tu portal de <strong>HB Performance</strong>. Tocá el botón para crear tu contraseña:</p>
<p><a href="${link}" style="display:inline-block;background:#F5A800;color:#0A0A0A;padding:12px 22px;border-radius:8px;font-weight:700;text-decoration:none;">Crear mi contraseña</a></p>
<p>Tu usuario es este email: <strong>${escHtml(email)}</strong>.</p>
<p style="color:#888;font-size:13px;">💡 Si no ves nuestros mails en tu bandeja de entrada, revisá la carpeta de <strong>spam</strong> o "promociones".</p>
<p>— El equipo de HB Performance</p>`
      })
    })
    if (!res.ok) throw new Error('Resend ' + res.status)
    console.log('Mail de ingreso (usuario reusado) enviado a:', email)
  } catch (err) {
    console.error('No se pudo enviar el mail de ingreso (usuario reusado):', (err as Error).message)
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Normaliza un email para comparar (case-insensitive, sin espacios). null/undefined → ''.
function normEmail(e: unknown): string {
  return String(e ?? '').toLowerCase().trim()
}

// Convierte date_approved (ISO con offset, o null) al día calendario de Argentina (UTC-3 fijo todo el año).
// Devuelve 'YYYY-MM-DD'. Así un pago del 30/09 23:00 AR (= 01/10 02:00 UTC) queda en septiembre, no octubre.
function arDateFromApproved(dateApproved: string | null | undefined): string {
  const base = dateApproved ? new Date(dateApproved) : new Date()
  const t = isNaN(base.getTime()) ? Date.now() : base.getTime()
  return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

// Lunes de la semana actual en hora Argentina (UTC-3 fijo, igual que arDateFromApproved) → 'YYYY-MM-DD'.
// Se usa como profiles.access_from en el alta nueva y cuando un ex alumno vuelve (ventana de acceso hacia atrás).
function arMondayStr(now: Date = new Date()): string {
  const ar = new Date(now.getTime() - 3 * 3600 * 1000)
  ar.setUTCDate(ar.getUTCDate() - (ar.getUTCDay() + 6) % 7)
  return ar.toISOString().slice(0, 10)
}

// ¿El perfil se había ido? Cancelado sin días pagos vigentes, o cortado por cobro fallido (ese corte deja
// subscription_status = 'active'; lo que manda es payment_grace_until vencido). En gracia todavía tiene acceso → no.
function isReturningAthlete(prof: { subscription_status?: string | null, subscription_end?: string | null, payment_grace_until?: string | null }): boolean {
  const endDs = prof.subscription_end ? String(prof.subscription_end).slice(0, 10) : null
  const leftByCancel = prof.subscription_status === 'cancelled' && (!endDs || endDs < arDateFromApproved(null))
  const cutByFailedPayment = !!prof.payment_grace_until && new Date(prof.payment_grace_until).getTime() <= Date.now()
  return leftByCancel || cutByFailedPayment
}

// Tipo del cobro que entra por un perfil ya existente: alta_nueva si es su primer pago y su suscripción arrancó hace
// muy poco (el aviso del cobro puede llegar después del alta); si no, renovación. Ante la duda, renovación.
async function mpChargeType(adminClient: any, athleteId: string, subscriptionStart: string | null, payment: any): Promise<string> {
  try {
    if (!subscriptionStart || !payment) return 'renovacion_automatica'
    const paidMs = new Date(arDateFromApproved(payment.date_approved)).getTime()
    const startMs = new Date(subscriptionStart).getTime()
    if (isNaN(startMs) || Math.abs(paidMs - startMs) > 3 * 24 * 60 * 60 * 1000) return 'renovacion_automatica'
    const { data, error } = await adminClient.from('payments').select('id').eq('athlete_id', athleteId).limit(1)
    if (error || (data && data.length > 0)) return 'renovacion_automatica'
    return 'alta_nueva'
  } catch (_) {
    return 'renovacion_automatica'
  }
}

// Registra un pago de MP en la tabla `payments`. Idempotente por mp_payment_id (ON CONFLICT DO NOTHING).
// Nunca tira: devuelve true si el pago quedó guardado (o ya estaba) y false si no, para que quien llama pida reintento.
async function registerMpPayment(
  adminClient: any,
  athleteId: string,
  program: string | null,
  payment: any,
  type: string
): Promise<boolean> {
  try {
    if (!payment || payment.id == null) {
      console.warn('registerMpPayment: sin payment (o sin id) →', type, '— no se registra el pago')
      return false
    }
    const amount = payment.transaction_amount != null ? Number(payment.transaction_amount) : null
    if (amount == null || isNaN(amount)) {
      console.warn('registerMpPayment: payment sin transaction_amount → no se registra:', payment.id)
      return false
    }
    const netRaw = payment?.transaction_details?.net_received_amount
    const netAmount = netRaw != null && !isNaN(Number(netRaw)) ? Number(netRaw) : null
    const paidAt = arDateFromApproved(payment.date_approved)
    const { data: inserted, error } = await adminClient
      .from('payments')
      .upsert({
        athlete_id: athleteId,
        program: program,
        amount: amount,
        net_amount: netAmount,
        paid_at: paidAt,
        type: type,
        method: 'mp',
        manual_channel: null,
        created_by: null,
        mp_payment_id: String(payment.id),
        prev_subscription_end: null
      }, { onConflict: 'mp_payment_id', ignoreDuplicates: true })
      .select('id')
    const logCtx = WEBHOOK_CTX.get(adminClient)
    if (error) {
      console.error('registerMpPayment: error insertando el pago (no bloquea el alta):', error.message)
      return false
    } else {
      // Para mp_webhook_log: ignoreDuplicates no devuelve la fila si el pago ya estaba.
      if (logCtx) {
        logCtx.paymentSaved = true
        logCtx.paymentId = String(payment.id)
        logCtx.paymentNew = Array.isArray(inserted) ? inserted.length > 0 : null
      }
      console.log('Pago MP registrado:', type, '| payment_id:', payment.id, '| net:', netAmount, '| paid_at:', paidAt)
    }
    return true
  } catch (err) {
    console.error('registerMpPayment: excepción (no bloquea el alta):', err)
    return false
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Semana de prueba (etapa 6). Solo se llega acá con un perfil cuyo trial_status está en `states`.
// ---------------------------------------------------------------------------------------------------------------

// Perfil de prueba vinculado a la suscripción. null = no hay (o no se pudo leer: entonces sigue el flujo de siempre,
// para que una falla de la base no cambie la respuesta que hoy recibe cualquier alumno).
async function findTrialProfile(adminClient: any, subscriptionId: string | null, states: string[]): Promise<any | null> {
  if (!subscriptionId) return null
  const { data, error } = await adminClient
    .from('profiles')
    .select('id, program, trial_status, trial_ends_at, subscription_status')
    .eq('mp_subscription_id', subscriptionId)
    .in('trial_status', states)
    .limit(2)
  if (error) {
    console.error('REVISAR PRUEBA: no se pudo leer el perfil de prueba, sigue el flujo normal:', error.message, '| preapproval:', subscriptionId)
    return null
  }
  if (!data || data.length !== 1) {
    if (data && data.length > 1) console.error('REVISAR PRUEBA: suscripción de prueba en más de un perfil, sigue el flujo normal | preapproval:', subscriptionId)
    return null
  }
  return data[0]
}

// Primer cobro al terminar la prueba (o un cobro tardío de una prueba ya cortada).
async function handleTrialCharge(adminClient: any, prof: any, ap: any, chargeApproved: boolean, mpToken: string | undefined) {
  const preapprovalId = String(ap?.preapproval_id ?? '')
  const nowIso = new Date().toISOString()

  if (chargeApproved) {
    // Aprobado (también con la cuota en recycling): primero se registra el pago, después se marca la conversión.
    // Si algo falla, 500 y el reintento de MP lo completa (el pago no se duplica: mp_payment_id es único).
    const payment = await fetchPaymentFromAp(ap, mpToken)
    const saved = await registerMpPayment(adminClient, prof.id, prof.program ?? null, payment, 'alta_nueva')
    if (!saved) return json({ ok: false, error: 'No se pudo registrar el cobro de la prueba' }, 500)
    if (prof.trial_status === 'charge_rejected') {
      console.error('REVISAR PRUEBA: cobro aprobado después de cortar la prueba por cobro rechazado (no se reactiva solo) | preapproval:', preapprovalId)
      return json({ ok: true, status: 'trial_paid_after_cut' })
    }
    const { error } = await adminClient
      .from('profiles')
      .update({ trial_status: 'converted', trial_resolved_at: nowIso })
      .eq('id', prof.id).eq('trial_status', 'in_trial')
    if (error) {
      console.error('No se pudo marcar la prueba como convertida:', error.message)
      return json({ ok: false, error: 'No se pudo guardar la conversión' }, 500)
    }
    console.log('Prueba convertida: primer cobro aprobado | preapproval:', preapprovalId)
    return json({ ok: true, status: 'trial_converted' })
  }

  // Rechazado: sin gracia. Primero se corta en la base (el corte del portal y de is_active_athlete usa
  // cancelled + subscription_end anterior a hoy), después se cancela en MP.
  if (prof.trial_status === 'in_trial') {
    const yesterday = arDateFromApproved(new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    const { error } = await adminClient
      .from('profiles')
      .update({ subscription_status: 'cancelled', subscription_end: yesterday, trial_status: 'charge_rejected', trial_resolved_at: nowIso })
      .eq('id', prof.id).eq('trial_status', 'in_trial')
    if (error) {
      console.error('No se pudo cortar la prueba con cobro rechazado:', error.message)
      return json({ ok: false, error: 'No se pudo guardar el corte' }, 500)
    }
    console.log('Prueba cortada: primer cobro rechazado | preapproval:', preapprovalId)
  }
  // Se intenta cancelar en MP en cada aviso de cobro rechazado, hasta que salga.
  try {
    const res = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    if (!res.ok) console.error('REVISAR PRUEBA: MP no canceló la suscripción con cobro rechazado:', res.status, '| preapproval:', preapprovalId)
  } catch (err) {
    console.error('REVISAR PRUEBA: no se pudo cancelar en MP:', (err as Error).message, '| preapproval:', preapprovalId)
  }
  return json({ ok: true, status: 'trial_charge_rejected' })
}

// Cancelación durante la prueba (aviso de MP): acceso hasta el día en que termina la prueba (hora AR).
async function handleTrialCancel(adminClient: any, prof: any) {
  const endDay = arDateFromApproved(prof.trial_ends_at)
  const { error } = await adminClient
    .from('profiles')
    .update({ subscription_status: 'cancelled', subscription_end: endDay, trial_status: 'cancelled', trial_resolved_at: new Date().toISOString() })
    .eq('id', prof.id).eq('trial_status', 'in_trial')
  if (error) {
    console.error('No se pudo guardar la cancelación de la prueba:', error.message)
    return json({ ok: false, error: 'No se pudo guardar la cancelación' }, 500)
  }
  console.log('Prueba cancelada: acceso hasta', endDay)
  return json({ ok: true, status: 'trial_cancelled' })
}

// ¿La suscripción es de un plan de prueba? null = no se pudo saber.
async function isTrialPlan(adminClient: any, subscription: any): Promise<boolean | null> {
  const planId = subscription?.preapproval_plan_id ? String(subscription.preapproval_plan_id) : null
  if (!planId) return false
  const { data, error } = await adminClient
    .from('site_config')
    .select('key, value')
    .in('key', PROGRAMS.map((p) => `mp_trial_plan_${p}`))
  if (error) return null
  return (data ?? []).some((r: any) => extractPlanId(r.value) === planId)
}

// Pasa el aviso a confirm-trial. Si no responde bien, 502 para que MP reintente.
async function delegateToConfirmTrial(preapprovalId: string, chargeSeen: boolean) {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/confirm-trial`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preapproval_id: preapprovalId, charge_seen: chargeSeen }),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('confirm-trial pidió reintento:', res.status, result?.status, '| preapproval:', preapprovalId)
      return json({ ok: false, error: 'Prueba sin confirmar' }, 502)
    }
    return json({ ok: true, status: 'trial_' + (result?.status ?? 'sin_estado') })
  } catch (err) {
    console.error('No se pudo llamar a confirm-trial:', (err as Error).message, '| preapproval:', preapprovalId)
    return json({ ok: false, error: 'Prueba sin confirmar' }, 502)
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
