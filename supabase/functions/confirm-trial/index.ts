// ============================================================================
// Edge Function: confirm-trial   (Fase 2, semana de prueba)
// ----------------------------------------------------------------------------
// Es el único lugar que da de alta una prueba. La llaman:
//  · La página de regreso: { preapproval_id, pending_id } o, sin id en el navegador, { preapproval_id, email }.
//  · process-payment, con la clave de servicio: { preapproval_id } o { preapproval_id, charge_seen: true }.
//    Sin datos del navegador, busca el mail de cada pending de prueba en MP, dentro del plan. Nunca usa recencia.
//
// Exige: suscripción authorized del plan de prueba del programa, sin vincular, creada después del pending y dentro
// de 2 horas; pending sin usar; payer_id presente y sin usar; mail sin perfil y sin cuenta en Auth.
// Si algo no cierra, no da el alta y deja el caso en trial_reviews. Esa suscripción sigue viva en MP y VA A COBRAR.
// Un primer cobro sin vincular nunca da el alta: solo se anota.
//
// Una prueba solo crea cuentas nuevas: nunca reactiva ni modifica un perfil, ni cancela otra suscripción.
//
// Respuesta pública, siempre status 200 y sin decir si un mail existe: { ok: true } o GENERIC, con retry: true si
// conviene reintentar. Para process-payment: 200 con el resultado, o 503 para que MP reintente.
// El log no lleva mails.
//
// Requiere: 20261102_trial_revisiones.sql y mp_trial_plan_<programa> en site_config.
// Secretos (ya existen a nivel proyecto): SUPABASE_URL, SERVICE_ROLE_KEY, MP_ACCESS_TOKEN.
// Deploy: verify_jwt = OFF (la página de regreso no tiene sesión).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://hbperformance.fit',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MP_API = 'https://api.mercadopago.com'
const TRIAL_PROGRAMS = ['crossfit', 'hybrid', 'corredores']
const GENERIC = { ok: false, error: 'No pudimos confirmar tu prueba, escribinos' }
const HOUR_MS = 60 * 60 * 1000
const WINDOW_MS = 2 * HOUR_MS
const LIMIT_PUBLIC = 20   // pedidos por hora por IP: cada uno consulta MP con el token de todo el negocio
const LIMIT_EMAIL = 5     // pedidos por hora por IP que prueban un mail
const SEARCH_LIMIT = 60

type Result =
  | { kind: 'ok', status: string }    // alta hecha o suscripción ya vinculada
  | { kind: 'stop', reason: string }  // sin alta; reintentar no cambia nada
  | { kind: 'wait', reason: string }  // sin alta; conviene reintentar

const stop = (reason: string): Result => ({ kind: 'stop', reason })
const wait = (reason: string): Result => ({ kind: 'wait', reason })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const internal = isInternal(req)
  try {
    if (req.method !== 'POST') return respond(stop('metodo'), internal)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json().catch(() => null)
    const preapprovalId = typeof body?.preapproval_id === 'string' ? body.preapproval_id.trim() : ''
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(preapprovalId)) return respond(stop('datos'), internal)

    if (internal) {
      return respond(await confirmTrial(admin, { preapprovalId, chargeSeen: body?.charge_seen === true }), true)
    }

    // Los datos del navegador solo cuentan en el pedido público.
    const pendingId = typeof body?.pending_id === 'string' ? body.pending_id.trim() : ''
    const email = typeof body?.email === 'string' ? normEmail(body.email) : ''
    if (pendingId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pendingId)) return respond(stop('datos'), false)
    if (!pendingId && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return respond(stop('datos'), false)

    if (await overLimit(admin, req, 'confirm', LIMIT_PUBLIC)) return respond(stop('limite_ip'), false)
    if (!pendingId && await overLimit(admin, req, 'confirm-mail', LIMIT_EMAIL)) return respond(stop('limite_mail'), false)

    return respond(await confirmTrial(admin, pendingId ? { preapprovalId, pendingId } : { preapprovalId, email }), false)
  } catch (err) {
    console.error('confirm-trial: error inesperado:', (err as Error)?.message ?? err)
    return respond(wait('inesperado'), internal)
  }
})

function isInternal(req: Request): boolean {
  const key = Deno.env.get('SERVICE_ROLE_KEY')
  return !!key && req.headers.get('authorization') === `Bearer ${key}`
}

function respond(result: Result, internal: boolean) {
  if (result.kind === 'ok') {
    console.log('confirm-trial:', result.status)
    return json(internal ? { ok: true, status: result.status } : { ok: true })
  }
  console.log('confirm-trial sin alta:', result.kind, result.reason)
  if (internal) return json({ ok: false, status: result.reason }, result.kind === 'wait' ? 503 : 200)
  return json(result.kind === 'wait' ? { ...GENERIC, retry: true } : GENERIC)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function confirmTrial(admin: any, input: { preapprovalId: string, pendingId?: string, email?: string, chargeSeen?: boolean }): Promise<Result> {
  const { preapprovalId } = input
  const token = Deno.env.get('MP_ACCESS_TOKEN')

  // --- La suscripción se consulta en MP: no se confía en lo que manda el navegador ---
  const subRes = await fetch(`${MP_API}/preapproval/${preapprovalId}`, { headers: { 'Authorization': `Bearer ${token}` } })
  if (subRes.status === 404) return stop('suscripcion_inexistente')
  if (!subRes.ok) return wait('mp_suscripcion')
  const sub = await subRes.json()

  const plans = await loadTrialPlans(admin)
  if (plans.error) return wait('plan_lectura')
  const planId = String(sub?.preapproval_plan_id ?? '')
  const program = plans.byId?.[planId]
  if (!program) return stop('no_es_plan_de_prueba')

  const review = (reason: string, extra: Record<string, unknown> = {}) =>
    saveReview(admin, preapprovalId, { program, reason, ...extra })

  // --- ¿Ya está vinculada? ---
  const { data: linked, error: linkedErr } = await admin
    .from('profiles').select('id').eq('mp_subscription_id', preapprovalId).limit(1)
  if (linkedErr) return wait('vinculo_lectura')
  if (linked && linked.length > 0) {
    await resolveReview(admin, preapprovalId)
    return { kind: 'ok', status: 'already_linked' }
  }

  if (input.chargeSeen) return await review('cobro_sin_vincular', { charge_seen_at: new Date().toISOString() })

  if (sub.status === 'pending') return wait('suscripcion_sin_autorizar')
  if (sub.status === 'cancelled') {
    await resolveReview(admin, preapprovalId)
    return stop('suscripcion_cancelada')
  }
  if (sub.status !== 'authorized') return await review('estado_' + String(sub.status).slice(0, 30))

  const subCreated = Date.parse(sub.date_created)
  if (isNaN(subCreated)) return await review('sin_fecha_de_creacion')

  // --- Identificar a la persona ---
  let pending: any = null
  if (input.pendingId) {
    const { data, error } = await admin
      .from('pending_subscriptions').select('*').eq('id', input.pendingId).eq('is_trial', true).maybeSingle()
    if (error) return wait('pending_lectura')
    if (!data) return await review('pending_no_encontrado')
    pending = data
  } else if (input.email) {
    const { data, error } = await admin
      .from('pending_subscriptions').select('*').eq('is_trial', true).ilike('email', escapeLike(input.email))
    if (error) return wait('pending_lectura')
    pending = (data ?? []).find((p: any) => normEmail(p.email) === input.email)
    if (!pending) return await review('mail_no_coincide')
  } else {
    const found = await findBySearch(admin, token, planId, program, preapprovalId, subCreated)
    if (found.wait) return wait(found.wait)
    if (found.reason) return await review(found.reason)
    pending = found.pending
  }

  const payerId = String(sub.payer_id ?? '').trim()
  const known = { email: pending.email, ...(payerId ? { payer_id: payerId } : {}) }

  // --- Verificaciones ---
  if (pending.program !== program) return await review('otro_programa', known)

  const pendingCreated = Date.parse(pending.created_at)
  if (isNaN(pendingCreated) || subCreated < pendingCreated || subCreated - pendingCreated > WINDOW_MS) {
    return await review('fuera_de_ventana', known)
  }

  if (!payerId) return await review('sin_payer_id', known)
  const { data: samePayer, error: payerErr } = await admin
    .from('profiles').select('id').eq('payer_id', payerId).limit(1)
  if (payerErr) return wait('payer_lectura')
  if (samePayer && samePayer.length > 0) return await review('payer_repetido', known)

  const email = normEmail(pending.email)
  const { data: profiles, error: profErr } = await admin
    .from('profiles').select('id, email').ilike('email', escapeLike(email))
  if (profErr) return wait('perfil_lectura')
  if ((profiles ?? []).some((p: any) => normEmail(p.email) === email)) return await review('ya_tiene_cuenta', known)

  const authUser = await findAuthUserByEmail(admin, email)
  if (authUser.error) return wait('auth_lectura')
  if (authUser.id) return await review('ya_tiene_cuenta', known)

  const trialEnds = Date.parse(sub.next_payment_date)
  if (isNaN(trialEnds) || trialEnds <= Date.now()) return await review('sin_fecha_de_fin', known)

  // --- Reserva: el regreso y el webhook pueden llegar a la vez ---
  const { data: claimed, error: claimErr } = await admin
    .rpc('reservar_pending_prueba', { p_pending_id: pending.id, p_preapproval_id: preapprovalId })
  if (claimErr) return wait('reserva')
  if (claimed !== true) return wait('pending_reservado')

  // --- Alta: solo cuenta nueva ---
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(pending.email, {
    redirectTo: 'https://hbperformance.fit/app/set-password.html',
    data: { full_name: pending.full_name },
  })
  const userId = inviteData?.user?.id
  if (inviteError || !userId) {
    await releaseClaim(admin, pending.id, preapprovalId)
    if (inviteError?.code === 'email_exists' || inviteError?.status === 422) return await review('ya_tiene_cuenta', known)
    console.error('confirm-trial: falló la invitación:', inviteError?.message)
    return wait('invitacion')
  }

  const now = new Date()
  const { error: insertError } = await admin.from('profiles').insert({
    id: userId,
    full_name: pending.full_name,
    email: pending.email,
    phone: pending.phone || null,
    role: 'athlete',
    program,
    subscription_status: 'active',
    mp_subscription_id: preapprovalId,
    subscription_start: now.toISOString().split('T')[0],
    access_from: arMondayStr(now),
    trial_status: 'in_trial',
    trial_started_at: now.toISOString(),
    trial_ends_at: new Date(trialEnds).toISOString(),
    payer_id: payerId,
  })
  if (insertError) {
    console.error('PERFIL NO GUARDADO (prueba):', insertError.message, '| preapproval:', preapprovalId)
    // Sin borrar el usuario de Auth, el reintento lo vería como cuenta existente. Solo se borra si seguro no tiene perfil.
    const { data: profileById, error: lookupError } = await admin
      .from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!lookupError && !profileById) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
      if (deleteError) console.error('REVISAR PRUEBA: no se pudo borrar el usuario de Auth:', deleteError.message)
    }
    await releaseClaim(admin, pending.id, preapprovalId)
    return wait('perfil_guardar')
  }

  const { error: deletePendingErr } = await admin.from('pending_subscriptions').delete().eq('id', pending.id)
  if (deletePendingErr) console.error('confirm-trial: no se pudo borrar el pending:', deletePendingErr.message)
  await resolveReview(admin, preapprovalId)
  return { kind: 'ok', status: 'provisioned' }
}

// Respaldo sin datos del navegador: un solo pending tiene que coincidir, y su mail tener esta única suscripción viva.
async function findBySearch(admin: any, token: string | undefined, planId: string, program: string, preapprovalId: string, subCreated: number):
  Promise<{ pending?: any, reason?: string, wait?: string }> {
  const { data: candidates, error } = await admin
    .from('pending_subscriptions').select('*')
    .eq('is_trial', true).eq('program', program)
    .gte('created_at', new Date(subCreated - WINDOW_MS).toISOString())
    .lte('created_at', new Date(subCreated).toISOString())
    .limit(SEARCH_LIMIT)
  if (error) return { wait: 'pending_lectura' }

  const hits: any[] = []
  let severalSubs = false
  for (const p of candidates ?? []) {
    const params = new URLSearchParams({ preapproval_plan_id: planId, payer_email: normEmail(p.email) })
    const res = await fetch(`${MP_API}/preapproval/search?${params}`, { headers: { 'Authorization': `Bearer ${token}` } })
    if (!res.ok) return { wait: 'mp_busqueda' }
    const results = (await res.json())?.results ?? []
    const alive = results.filter((s: any) => s.status !== 'cancelled')
    if (!alive.some((s: any) => String(s.id) === preapprovalId)) continue
    if (alive.length !== 1) severalSubs = true
    hits.push(p)
  }
  if (hits.length === 0) return { reason: 'sin_identificar' }
  if (hits.length > 1) return { reason: 'varios_pendings' }
  if (severalSubs) return { reason: 'varias_suscripciones' }
  return { pending: hits[0] }
}

async function loadTrialPlans(admin: any): Promise<{ byId?: Record<string, string>, error?: boolean }> {
  const { data, error } = await admin
    .from('site_config').select('key, value').in('key', TRIAL_PROGRAMS.map((p) => `mp_trial_plan_${p}`))
  if (error) return { error: true }
  const byId: Record<string, string> = {}
  for (const row of data ?? []) {
    const id = extractPlanId(row.value)
    if (id) byId[id] = row.key.replace('mp_trial_plan_', '')
  }
  return { byId }
}

// Guarda el caso. Solo se escriben los campos recibidos: nunca reabre un caso resuelto ni borra lo anterior.
async function saveReview(admin: any, preapprovalId: string, fields: Record<string, unknown>): Promise<Result> {
  const { error } = await admin.from('trial_reviews').upsert({
    preapproval_id: preapprovalId,
    ...fields,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'preapproval_id' })
  if (error) {
    console.error('REVISAR PRUEBA: no se pudo guardar el caso:', error.message, '| preapproval:', preapprovalId)
    return wait('revision_guardar')
  }
  console.error('REVISAR PRUEBA:', fields.reason, '| preapproval:', preapprovalId)
  return stop(String(fields.reason))
}

async function resolveReview(admin: any, preapprovalId: string): Promise<void> {
  const { error } = await admin.from('trial_reviews')
    .update({ resolved_at: new Date().toISOString() })
    .eq('preapproval_id', preapprovalId).is('resolved_at', null)
  if (error) console.error('confirm-trial: no se pudo cerrar el caso:', error.message)
}

async function releaseClaim(admin: any, pendingId: string, preapprovalId: string): Promise<void> {
  const { error } = await admin.from('pending_subscriptions')
    .update({ trial_claimed_at: null, trial_claimed_by: null })
    .eq('id', pendingId).eq('trial_claimed_by', preapprovalId)
  if (error) console.error('confirm-trial: no se pudo liberar la reserva, vence a los 5 minutos:', error.message)
}

// Cuenta el pedido contra el límite por hora, en trial_attempts. Si no se puede comprobar, no se deja pasar.
async function overLimit(admin: any, req: Request, scope: string, limit: number): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip')
    || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || 'desconocida'
  const bytes = new TextEncoder().encode(`${Deno.env.get('SERVICE_ROLE_KEY') ?? ''}|${scope}|${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const ipHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')

  const { count, error } = await admin
    .from('trial_attempts').select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - HOUR_MS).toISOString())
  if (error || (count ?? 0) >= limit) return true
  const { error: insertErr } = await admin.from('trial_attempts').insert({ ip_hash: ipHash })
  return !!insertErr
}

function normEmail(e: unknown): string {
  return String(e ?? '').trim().toLowerCase()
}

// Escapa los comodines de ilike: los emails pueden llevar '_'.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

// En site_config el plan puede estar como id o como dirección del checkout.
function extractPlanId(value: unknown): string | null {
  const v = String(value ?? '').trim()
  const m = v.match(/preapproval_plan_id=([A-Za-z0-9_-]+)/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : null
}

// Busca en Auth por mail (la API de admin no filtra por mail). Mismo criterio que start-trial.
async function findAuthUserByEmail(admin: any, email: string): Promise<{ id?: string, error?: string }> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { error: error.message }
    const users = data?.users ?? []
    const hit = users.find((u: any) => normEmail(u.email) === email)
    if (hit) return { id: hit.id }
    if (users.length < 1000) return {}
  }
  return { error: 'demasiados usuarios para revisar' }
}

// Lunes de la semana en hora Argentina (UTC-3 fijo), igual que process-payment.
function arMondayStr(now: Date): string {
  const ar = new Date(now.getTime() - 3 * 3600 * 1000)
  ar.setUTCDate(ar.getUTCDate() - (ar.getUTCDay() + 6) % 7)
  return ar.toISOString().slice(0, 10)
}
