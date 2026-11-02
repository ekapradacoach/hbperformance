// ============================================================================
// Edge Function: start-trial   (Fase 2, semana de prueba)
// ----------------------------------------------------------------------------
// Recibe el formulario de prueba { full_name, email, phone, program, utm_* }, revisa si el mail es elegible,
// crea el pending con is_trial = true y devuelve { ok: true, pending_id, init_point } (checkout del plan de prueba).
//
// Elegible = sin perfil y sin cuenta en Auth. Una cuenta sin perfil es alguien que ya pasó por el sistema.
// Si el mail ya tiene un pending de prueba sin usar, se reusa y se renueva su fecha: la identificación exige una
// suscripción creada poco después del pending, y así quien reintenta no queda bloqueado.
//
// Cualquier otro resultado, también una falla interna, devuelve EXACTAMENTE la misma respuesta (GENERIC), con
// status 200: nunca dice si el mail existe. El motivo queda en los logs, sin el mail.
//
// Límites: LIMIT_PER_IP intentos por hora por IP (en trial_attempts, con la IP como hash) y LIMIT_GLOBAL pendings
// de prueba nuevos por hora en total.
//
// Requiere: 20261101_trial_datos.sql, 20261102_trial_intentos.sql y mp_trial_plan_<programa> en site_config.
// Secretos (ya existen a nivel proyecto): SUPABASE_URL, SERVICE_ROLE_KEY.
// Deploy: verify_jwt = OFF (endpoint público, el formulario no tiene sesión).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://hbperformance.fit',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Por ahora solo CrossFit. Sumar un programa acá cuando tenga su plan de prueba.
const TRIAL_PROGRAMS = ['crossfit']
const CHECKOUT_BASE = 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id='
const GENERIC = { ok: false, error: 'No pudimos iniciar tu prueba, escribinos' }
const LIMIT_PER_IP = 5
const LIMIT_GLOBAL = 30
const HOUR_MS = 60 * 60 * 1000
const ATTEMPTS_KEEP_MS = 7 * 24 * HOUR_MS
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') return reject('metodo')

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // --- Límite por IP: cuenta todos los intentos, también los inválidos ---
    const ipHash = await hashIp(req)
    const since = new Date(Date.now() - HOUR_MS).toISOString()
    const { count: attempts, error: countErr } = await admin
      .from('trial_attempts').select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash).gte('created_at', since)
    if (countErr) return reject('intentos_lectura', countErr)
    if ((attempts ?? 0) >= LIMIT_PER_IP) return reject('limite_ip')
    const { error: attemptErr } = await admin.from('trial_attempts').insert({ ip_hash: ipHash })
    if (attemptErr) return reject('intentos_escritura', attemptErr)
    await admin.from('trial_attempts').delete()
      .lt('created_at', new Date(Date.now() - ATTEMPTS_KEEP_MS).toISOString())

    // --- Datos ---
    const form = parseForm(await req.json().catch(() => null))
    if (!form) return reject('datos')

    // --- Plan de prueba del programa ---
    const { data: cfg, error: cfgErr } = await admin
      .from('site_config').select('value').eq('key', `mp_trial_plan_${form.program}`).maybeSingle()
    if (cfgErr) return reject('plan_lectura', cfgErr)
    const planId = extractPlanId(cfg?.value)
    if (!planId) return reject('plan_faltante')

    // --- Elegibilidad. Si algo falla, no se da por elegible ---
    const { data: profiles, error: profErr } = await admin
      .from('profiles').select('id, email').ilike('email', escapeLike(form.email))
    if (profErr) return reject('perfil_lectura', profErr)
    if ((profiles ?? []).some((p: any) => normEmail(p.email) === form.email)) return reject('tiene_perfil')

    const authUser = await findAuthUserByEmail(admin, form.email)
    if (authUser.error) return reject('auth_lectura', authUser.error)
    if (authUser.id) return reject('tiene_auth')

    // --- Pending: reusar el que exista o crear uno nuevo ---
    const existing = await findTrialPending(admin, form.email)
    if (existing.error) return reject('pending_lectura', existing.error)
    if (existing.id) {
      if (!(await refreshPending(admin, existing.id, form))) return reject('pending_renovar')
      return accepted(existing.id, planId)
    }

    const { count: created, error: globalErr } = await admin
      .from('pending_subscriptions').select('id', { count: 'exact', head: true })
      .eq('is_trial', true).gte('created_at', since)
    if (globalErr) return reject('global_lectura', globalErr)
    if ((created ?? 0) >= LIMIT_GLOBAL) return reject('limite_global')

    const { data: inserted, error: insertErr } = await admin
      .from('pending_subscriptions').insert({ ...form, is_trial: true }).select('id').single()
    if (!insertErr && inserted?.id) return accepted(inserted.id, planId)

    // Doble clic: otro pedido del mismo mail lo creó recién (índice único) → se reusa ese.
    if (insertErr?.code === '23505') {
      const raced = await findTrialPending(admin, form.email)
      if (raced.id && await refreshPending(admin, raced.id, form)) return accepted(raced.id, planId)
    }
    return reject('pending_crear', insertErr)
  } catch (err) {
    return reject('inesperado', err)
  }
})

function reject(reason: string, detail?: unknown) {
  if (detail) console.error('start-trial rechazado:', reason, (detail as any)?.message ?? detail)
  else console.log('start-trial rechazado:', reason)
  return json(GENERIC)
}

function accepted(pendingId: string, planId: string) {
  console.log('start-trial aceptado')
  return json({ ok: true, pending_id: pendingId, init_point: `${CHECKOUT_BASE}${planId}` })
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normEmail(e: unknown): string {
  return String(e ?? '').trim().toLowerCase()
}

// Escapa los comodines de ilike: los emails pueden llevar '_'.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

// Devuelve los datos limpios, o null si algo no es válido.
function parseForm(body: any) {
  if (!body || typeof body !== 'object') return null
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const full_name = text(body.full_name)
  const email = normEmail(typeof body.email === 'string' ? body.email : '')
  const phone = text(body.phone)
  const program = text(body.program)
  if (!TRIAL_PROGRAMS.includes(program)) return null
  if (full_name.length < 2 || full_name.length > 100) return null
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (phone.length > 30) return null
  const utm: Record<string, string> = {}
  for (const f of UTM_FIELDS) {
    const v = text(body[f])
    if (v) utm[f] = v.slice(0, 100)
  }
  return { full_name, email, phone: phone || null, program, ...utm }
}

// En site_config el plan puede estar como id o como dirección del checkout.
function extractPlanId(value: unknown): string | null {
  const v = String(value ?? '').trim()
  const m = v.match(/preapproval_plan_id=([A-Za-z0-9_-]+)/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : null
}

async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip')
    || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || 'desconocida'
  const bytes = new TextEncoder().encode((Deno.env.get('SERVICE_ROLE_KEY') ?? '') + '|' + ip)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Busca en Auth por mail (la API de admin no filtra por mail). Mismo criterio que update-athlete-email.
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

async function findTrialPending(admin: any, email: string): Promise<{ id?: string, error?: string }> {
  const { data, error } = await admin
    .from('pending_subscriptions').select('id, email')
    .eq('is_trial', true).ilike('email', escapeLike(email))
  if (error) return { error: error.message }
  return { id: (data ?? []).find((p: any) => normEmail(p.email) === email)?.id }
}

async function refreshPending(admin: any, id: string, form: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin
    .from('pending_subscriptions')
    .update({ ...form, created_at: new Date().toISOString() })
    .eq('id', id).eq('is_trial', true)
  if (error) console.error('start-trial: no se pudo renovar el pending:', error.message)
  return !error
}
