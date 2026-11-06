// ============================================================================
// Edge Function: trial-admin   (Fase 2, semana de prueba, etapa 7)
// ----------------------------------------------------------------------------
// Acciones del admin sobre una suscripción del plan de prueba que quedó para revisión. Solo role = 'admin'
// (lo identifica por su JWT, como create-athlete). Body { action, preapproval_id, ... }:
//  · inspect   → qué dice MP (estado, plan, vínculo, plazo, cobro), el caso y los pendings de prueba del programa.
//  · provision → da el alta a la persona que ELIGE el admin ({ pending_id } o { email, full_name, phone? }).
//                Decide prueba o alta paga con las reglas de la etapa 5b (plazo y primer cobro).
//  · cancel    → cancela la suscripción en MP. Solo si es del plan de prueba y no está vinculada a ningún perfil.
//  · resolve   → marca el caso resuelto con una nota.
//
// Reglas que NO se saltean: suscripción authorized, del plan de prueba, sin vincular; plazo claro (prueba o paga);
// prueba sin cobros y con fin futuro; alta paga solo con el primer cobro aprobado por el precio del programa;
// mail sin perfil y sin cuenta en Auth (si tiene, es una reactivación: otras herramientas).
// Lo que el admin sí puede pasar por alto (lo decide al elegir a la persona): ventana de 2 horas, mail que no
// coincide y payer_id repetido. Nunca por recencia: el alta es para quien eligió el admin.
// Una prueba solo crea cuentas nuevas: nunca modifica ni reactiva un perfil existente.
//
// Secretos: SUPABASE_URL, SERVICE_ROLE_KEY, MP_ACCESS_TOKEN (ya existen).
// Deploy: verify_jwt = ON (la llama el admin con su sesión).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MP_API = 'https://api.mercadopago.com'
const TRIAL_PROGRAMS = ['crossfit', 'hybrid', 'corredores']
const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS
const TRIAL_MAX_DAYS = 10
const PAID_MIN_DAYS = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '')
    const token = Deno.env.get('MP_ACCESS_TOKEN')

    // --- Solo admin ---
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ ok: false, error: 'No autenticado.' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    const caller = userData?.user
    if (userErr || !caller) return json({ ok: false, error: 'Tu sesión expiró. Volvé a iniciar sesión.' }, 401)
    const { data: me, error: meErr } = await admin.from('profiles').select('role').eq('id', caller.id).maybeSingle()
    if (meErr) return json({ ok: false, error: 'No se pudo verificar tu usuario.' }, 500)
    if (!me || me.role !== 'admin') return json({ ok: false, error: 'Solo un admin puede hacer esto.' }, 403)

    const body = await req.json().catch(() => null)
    const action = String(body?.action ?? '')
    const preapprovalId = typeof body?.preapproval_id === 'string' ? body.preapproval_id.trim() : ''
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(preapprovalId)) return json({ ok: false, error: 'Id de suscripción inválido.' }, 400)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''

    if (action === 'resolve') {
      if (!note) return json({ ok: false, error: 'Escribí una nota para cerrar el caso.' }, 400)
      return await resolveCase(admin, preapprovalId, caller.id, note)
    }

    const state = await readState(admin, token, preapprovalId)
    if (state.error) return json({ ok: false, error: state.error }, state.status ?? 502)

    if (action === 'inspect') return json({ ok: true, ...state.view })
    if (action === 'cancel') return await cancelSub(admin, token, state, caller.id, note)
    if (action === 'provision') return await provision(admin, state, body, caller.id, note)
    return json({ ok: false, error: 'Acción desconocida.' }, 400)
  } catch (err) {
    console.error('trial-admin: error inesperado:', (err as Error)?.message ?? err)
    return json({ ok: false, error: 'Error inesperado. Probá de nuevo.' }, 500)
  }
})

// Todo lo que hace falta saber de la suscripción, leído de MP y de la base (nunca del navegador).
async function readState(admin: any, token: string | undefined, preapprovalId: string): Promise<any> {
  const subRes = await fetch(`${MP_API}/preapproval/${preapprovalId}`, { headers: { 'Authorization': `Bearer ${token}` } })
  if (subRes.status === 404) return { error: 'Mercado Pago no encuentra esa suscripción.', status: 404 }
  if (!subRes.ok) return { error: 'No se pudo consultar Mercado Pago. Probá de nuevo.' }
  const sub = await subRes.json()

  const keys = TRIAL_PROGRAMS.flatMap((p) => [`mp_trial_plan_${p}`, `price_${p}_ars`])
  const { data: cfg, error: cfgErr } = await admin.from('site_config').select('key, value').in('key', keys)
  if (cfgErr) return { error: 'No se pudo leer la configuración.', status: 500 }
  let program: string | null = null
  const prices: Record<string, number> = {}
  for (const r of cfg ?? []) {
    if (r.key.startsWith('mp_trial_plan_') && extractPlanId(r.value) === String(sub.preapproval_plan_id ?? '')) program = r.key.replace('mp_trial_plan_', '')
    if (r.key.startsWith('price_')) prices[r.key.replace(/^price_|_ars$/g, '')] = Number(r.value)
  }

  const { data: linked, error: linkErr } = await admin.from('profiles').select('id').eq('mp_subscription_id', preapprovalId).limit(1)
  if (linkErr) return { error: 'No se pudo leer los perfiles.', status: 500 }

  const charge = await findFirstCharge(token, preapprovalId)
  if (charge.error) return { error: 'No se pudieron consultar los cobros en Mercado Pago. Probá de nuevo.' }

  const created = Date.parse(sub.date_created)
  const next = Date.parse(sub.next_payment_date)
  const gapDays = !isNaN(created) && !isNaN(next) ? (next - created) / DAY_MS : null
  const mode = gapDays == null ? 'sin_fecha' : (gapDays > 0 && gapDays <= TRIAL_MAX_DAYS) ? 'prueba' : gapDays >= PAID_MIN_DAYS ? 'paga' : 'dudosa'

  const { data: review } = await admin.from('trial_reviews').select('*').eq('preapproval_id', preapprovalId).maybeSingle()

  let pendings: any[] = []
  if (program) {
    const { data } = await admin.from('pending_subscriptions')
      .select('id, full_name, email, phone, program, created_at, trial_claimed_at, trial_claimed_by')
      .eq('is_trial', true).eq('program', program)
    pendings = (data ?? []).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30)
  }
  const payerId = String(sub.payer_id ?? '').trim()
  let payerUsed = false
  if (payerId) {
    const { data } = await admin.from('profiles').select('id').eq('payer_id', payerId).limit(1)
    payerUsed = !!(data && data.length)
  }

  const view = {
    mp: {
      status: sub.status, program, linked: !!(linked && linked.length), payer_present: !!payerId, payer_used: payerUsed,
      date_created: sub.date_created ?? null, next_payment_date: sub.next_payment_date ?? null,
      gap_days: gapDays == null ? null : Math.round(gapDays * 10) / 10, mode,
      charge: { approved_amount: charge.approved ? Number(charge.approved.transaction_amount) : null, any: !!charge.any, rejected: !!charge.rejected, in_process: !!charge.inProcess },
      price: program ? (prices[program] ?? null) : null,
    },
    review: review ?? null,
    pendings,
  }
  return { sub, program, prices, linked: view.mp.linked, charge, mode, next, payerId, view }
}

async function provision(admin: any, st: any, body: any, adminId: string, note: string) {
  // --- Reglas fijas ---
  if (!st.program) return json({ ok: false, error: 'No es una suscripción del plan de prueba.' }, 409)
  if (st.sub.status !== 'authorized') return json({ ok: false, error: `La suscripción está "${st.sub.status}" en MP: no se puede dar el alta.` }, 409)
  if (st.linked) return json({ ok: false, error: 'Esa suscripción ya está vinculada a un perfil.' }, 409)
  if (!st.payerId) return json({ ok: false, error: 'MP no informa la cuenta del pagador: revisalo a mano.' }, 409)
  let paid: boolean
  if (st.mode === 'prueba') {
    if (st.charge.any) return json({ ok: false, error: 'Es una prueba pero MP muestra un cobro: revisalo a mano.' }, 409)
    if (!(st.next > Date.now())) return json({ ok: false, error: 'La fecha de fin de la prueba ya pasó.' }, 409)
    paid = false
  } else if (st.mode === 'paga') {
    if (!st.charge.approved) return json({ ok: false, error: st.charge.inProcess ? 'El primer cobro todavía está en proceso. Probá más tarde.' : 'No hay un primer cobro aprobado: no se puede dar el alta paga.' }, 409)
    const price = st.prices[st.program]
    if (!(price > 0) || Number(st.charge.approved.transaction_amount) !== price) return json({ ok: false, error: 'El cobro no coincide con el precio del programa: revisalo a mano.' }, 409)
    paid = true
  } else {
    return json({ ok: false, error: 'No se puede saber si MP aplicó la prueba (plazo dudoso): revisalo a mano.' }, 409)
  }

  // --- La persona que eligió el admin ---
  let pending: any = null
  let fullName = '', email = '', phone: string | null = null
  if (typeof body?.pending_id === 'string' && body.pending_id) {
    const { data, error } = await admin.from('pending_subscriptions').select('*').eq('id', body.pending_id).eq('is_trial', true).maybeSingle()
    if (error) return json({ ok: false, error: 'No se pudo leer el pending.' }, 500)
    if (!data) return json({ ok: false, error: 'Ese pending ya no existe.' }, 409)
    if (data.program !== st.program) return json({ ok: false, error: 'Ese pending es de otro programa.' }, 409)
    pending = data
    fullName = String(data.full_name ?? '').trim(); email = normEmail(data.email); phone = data.phone || null
  } else {
    fullName = String(body?.full_name ?? '').trim().slice(0, 100)
    email = normEmail(body?.email)
    phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 30) : null
    if (fullName.length < 2) return json({ ok: false, error: 'Falta el nombre.' }, 400)
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Mail inválido.' }, 400)

  const { data: profs, error: pErr } = await admin.from('profiles').select('id, email').ilike('email', escapeLike(email))
  if (pErr) return json({ ok: false, error: 'No se pudo revisar los perfiles.' }, 500)
  if ((profs ?? []).some((p: any) => normEmail(p.email) === email)) return json({ ok: false, error: 'Ese mail ya tiene cuenta: es una reactivación, no un alta de prueba.' }, 409)
  const auth = await findAuthUserByEmail(admin, email)
  if (auth.error) return json({ ok: false, error: 'No se pudo revisar las cuentas.' }, 500)
  if (auth.id) return json({ ok: false, error: 'Ese mail ya tiene una cuenta de acceso: es una reactivación, no un alta de prueba.' }, 409)

  // --- Reserva del pending (para no cruzarse con la página de regreso o el webhook) ---
  if (pending) {
    const { data: claimed, error: claimErr } = await admin.rpc('reservar_pending_prueba', { p_pending_id: pending.id, p_preapproval_id: st.sub.id })
    if (claimErr || claimed !== true) return json({ ok: false, error: 'Ese pending está siendo usado en este momento. Probá en unos minutos.' }, 409)
  }

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://hbperformance.fit/app/set-password.html',
    data: { full_name: fullName },
  })
  const userId = inviteData?.user?.id
  if (inviteError || !userId) {
    if (pending) await releaseClaim(admin, pending.id, st.sub.id)
    return json({ ok: false, error: 'No se pudo enviar la invitación: ' + (inviteError?.message ?? 'sin detalle') }, 502)
  }

  const now = new Date()
  const { error: insErr } = await admin.from('profiles').insert({
    id: userId, full_name: fullName, email, phone, role: 'athlete', program: st.program,
    subscription_status: 'active', mp_subscription_id: st.sub.id,
    subscription_start: now.toISOString().split('T')[0], access_from: arMondayStr(now),
    ...(paid ? {} : { trial_status: 'in_trial', trial_started_at: now.toISOString(), trial_ends_at: new Date(st.next).toISOString() }),
    payer_id: st.payerId,
  })
  if (insErr) {
    console.error('trial-admin: PERFIL NO GUARDADO:', insErr.message, '| preapproval:', st.sub.id)
    const { data: again } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!again) await admin.auth.admin.deleteUser(userId)
    if (pending) await releaseClaim(admin, pending.id, st.sub.id)
    return json({ ok: false, error: 'No se pudo guardar el perfil. No quedó nada a medias: probá de nuevo.' }, 500)
  }

  if (pending) {
    const { error } = await admin.from('pending_subscriptions').delete().eq('id', pending.id)
    if (error) console.error('trial-admin: no se pudo borrar el pending:', error.message)
  }
  let chargeWarning = ''
  if (paid && !(await registerPaidCharge(admin, userId, st.program, st.charge.approved))) {
    chargeWarning = ' El cobro no quedó registrado en Pagos: cargalo a mano.'
  }
  await closeCase(admin, st.sub.id, adminId, note || (paid ? 'Alta paga manual' : 'Alta de prueba manual'))
  console.log('trial-admin: alta manual', paid ? 'paga' : 'de prueba', '| preapproval:', st.sub.id)
  return json({ ok: true, mode: paid ? 'paga' : 'prueba', warning: chargeWarning || undefined })
}

async function cancelSub(admin: any, token: string | undefined, st: any, adminId: string, note: string) {
  if (!st.program) return json({ ok: false, error: 'No es una suscripción del plan de prueba: no se cancela desde acá.' }, 409)
  if (st.linked) return json({ ok: false, error: 'Esa suscripción está vinculada a un alumno: cancelala desde Alumnos.' }, 409)
  if (st.sub.status === 'cancelled') {
    await closeCase(admin, st.sub.id, adminId, note || 'Ya estaba cancelada en MP')
    return json({ ok: true, already: true })
  }
  const res = await fetch(`${MP_API}/preapproval/${st.sub.id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  })
  if (!res.ok) return json({ ok: false, error: 'Mercado Pago no canceló la suscripción. Probá de nuevo.' }, 502)
  await closeCase(admin, st.sub.id, adminId, note || 'Cancelada en MP desde el admin')
  console.log('trial-admin: suscripción de prueba cancelada desde el admin | preapproval:', st.sub.id)
  return json({ ok: true })
}

async function resolveCase(admin: any, preapprovalId: string, adminId: string, note: string) {
  const { data, error } = await admin.from('trial_reviews')
    .update({ resolved_at: new Date().toISOString(), resolved_by: adminId, review_note: note, updated_at: new Date().toISOString() })
    .eq('preapproval_id', preapprovalId).is('resolved_at', null).select('preapproval_id')
  if (error) return json({ ok: false, error: 'No se pudo guardar.' }, 500)
  if (!data || !data.length) return json({ ok: false, error: 'Ese caso no existe o ya estaba resuelto.' }, 409)
  return json({ ok: true })
}

// Cierra el caso si existe (un alta o cancelación sin caso previo no crea uno).
async function closeCase(admin: any, preapprovalId: string, adminId: string, note: string) {
  const { error } = await admin.from('trial_reviews')
    .update({ resolved_at: new Date().toISOString(), resolved_by: adminId, review_note: note, updated_at: new Date().toISOString() })
    .eq('preapproval_id', preapprovalId).is('resolved_at', null)
  if (error) console.error('trial-admin: no se pudo cerrar el caso:', error.message)
}

// --- Igual que en confirm-trial (cada función se deploya pegando un solo archivo) ---
async function findFirstCharge(token: string | undefined, preapprovalId: string):
  Promise<{ error?: boolean, approved?: any, any?: boolean, rejected?: boolean, inProcess?: boolean }> {
  const res = await fetch(`${MP_API}/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}`,
    { headers: { 'Authorization': `Bearer ${token}` } })
  if (!res.ok) return { error: true }
  const invoices = ((await res.json())?.results ?? []).filter((i: any) => String(i?.preapproval_id) === preapprovalId)
  const out: { approved?: any, any?: boolean, rejected?: boolean, inProcess?: boolean } = {}
  for (const inv of invoices) {
    const st = String(inv?.payment?.status ?? '')
    if (st || inv?.status === 'processed' || inv?.status === 'recycling') out.any = true
    if (st === 'approved' && inv.payment.id != null && !out.approved) {
      const p = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(String(inv.payment.id))}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (!p.ok) return { error: true }
      const payment = await p.json()
      if (payment?.status === 'approved') out.approved = payment
      else out.rejected = true
    } else if (st === 'rejected' || inv?.status === 'recycling') {
      out.rejected = true
    } else if (['pending', 'in_process', 'authorized'].includes(st) || (!st && inv?.status === 'scheduled')) {
      out.inProcess = true
    }
  }
  if (out.approved) out.rejected = false
  return out
}

async function registerPaidCharge(admin: any, athleteId: string, program: string, payment: any): Promise<boolean> {
  if (!payment || payment.id == null) return false
  const amount = Number(payment.transaction_amount)
  if (isNaN(amount)) return false
  const netRaw = payment?.transaction_details?.net_received_amount
  const approvedMs = Date.parse(payment.date_approved)
  const { error } = await admin.from('payments').upsert({
    athlete_id: athleteId, program, amount,
    net_amount: netRaw != null && !isNaN(Number(netRaw)) ? Number(netRaw) : null,
    paid_at: new Date((isNaN(approvedMs) ? Date.now() : approvedMs) - 3 * HOUR_MS).toISOString().slice(0, 10),
    type: 'alta_nueva', method: 'mp', manual_channel: null, created_by: null,
    mp_payment_id: String(payment.id), prev_subscription_end: null,
  }, { onConflict: 'mp_payment_id', ignoreDuplicates: true })
  if (error) { console.error('COBRO SIN REGISTRAR (alta manual desde prueba):', error.message, '| payment:', payment.id); return false }
  return true
}

async function releaseClaim(admin: any, pendingId: string, preapprovalId: string) {
  const { error } = await admin.from('pending_subscriptions').update({ trial_claimed_at: null, trial_claimed_by: null })
    .eq('id', pendingId).eq('trial_claimed_by', preapprovalId)
  if (error) console.error('trial-admin: no se pudo liberar la reserva, vence a los 5 minutos:', error.message)
}

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

function arMondayStr(now: Date): string {
  const ar = new Date(now.getTime() - 3 * 3600 * 1000)
  ar.setUTCDate(ar.getUTCDate() - (ar.getUTCDay() + 6) % 7)
  return ar.toISOString().slice(0, 10)
}
function extractPlanId(value: unknown): string | null {
  const v = String(value ?? '').trim()
  const m = v.match(/preapproval_plan_id=([A-Za-z0-9_-]+)/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : null
}
function normEmail(e: unknown): string { return String(e ?? '').trim().toLowerCase() }
function escapeLike(s: string): string { return s.replace(/[\\%_]/g, (c) => '\\' + c) }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
