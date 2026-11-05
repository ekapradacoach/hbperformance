// ============================================================================
// Edge Function: trial-reminders   (Fase 2, semana de prueba, etapa 6)
// ----------------------------------------------------------------------------
// Mail del día 6: avisa que la semana gratis está por terminar, cuánto se cobra y cómo cancelar.
// La llama una vez por día pg_cron (20261105_trial_aviso.sql), a las 10:00 hora AR.
//
// Elige perfiles con trial_status = 'in_trial', trial_ends_at entre ahora y 36 horas, y sin aviso enviado.
// Una sola vez por persona: marca trial_reminder_sent_at ANTES de mandar (solo si seguía vacío); si Resend falla,
// lo vuelve a vaciar para poder reintentar.
// No toca suscripciones, cobros ni accesos. El log no lleva mails.
//
// Protección: header x-cron-secret igual al secreto CRON_SECRET; si no, 401.
// Secretos: SUPABASE_URL, SERVICE_ROLE_KEY, RESEND_API_KEY, CRON_SECRET (nuevo).
// Deploy: verify_jwt = OFF (la llama el cron de la base, sin sesión).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WINDOW_MS = 36 * 3600 * 1000
const BATCH = 200
const PROGRAM_NAMES: Record<string, string> = { crossfit: 'CrossFit', hybrid: 'Hybrid Evolution', corredores: 'Fuerza para Corredores' }
const PORTAL = 'https://hbperformance.fit/app/login.html'

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  if (req.method !== 'POST' || !secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ ok: false, error: 'No autorizado' }, 401)
  }
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    console.error('REVISAR PRUEBA: falta RESEND_API_KEY, no se mandan avisos')
    return json({ ok: false, error: 'Falta RESEND_API_KEY' }, 500)
  }

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '')
    const now = Date.now()

    const { data: due, error } = await admin
      .from('profiles')
      .select('id, full_name, email, program, trial_ends_at')
      .eq('trial_status', 'in_trial')
      .is('trial_reminder_sent_at', null)
      .gt('trial_ends_at', new Date(now).toISOString())
      .lte('trial_ends_at', new Date(now + WINDOW_MS).toISOString())
      .limit(BATCH)
    if (error) {
      console.error('trial-reminders: no se pudieron leer las pruebas:', error.message)
      return json({ ok: false, error: 'lectura' }, 500)
    }

    const { data: cfg, error: cfgErr } = await admin
      .from('site_config').select('key, value').in('key', Object.keys(PROGRAM_NAMES).map((p) => `price_${p}_ars`))
    if (cfgErr) {
      console.error('trial-reminders: no se pudieron leer los precios:', cfgErr.message)
      return json({ ok: false, error: 'precios' }, 500)
    }
    const prices: Record<string, number> = {}
    for (const r of cfg ?? []) prices[String(r.key).replace(/^price_|_ars$/g, '')] = Number(r.value)

    let sent = 0, failed = 0, skipped = 0
    for (const p of due ?? []) {
      const price = prices[p.program]
      if (!(price > 0) || !p.email) { skipped++; console.error('REVISAR PRUEBA: aviso sin precio o sin mail | perfil:', p.id); continue }

      // Reserva: solo si todavía no se mandó (dos corridas a la vez no lo duplican).
      const stamp = new Date().toISOString()
      const { data: claimed, error: claimErr } = await admin
        .from('profiles').update({ trial_reminder_sent_at: stamp })
        .eq('id', p.id).eq('trial_status', 'in_trial').is('trial_reminder_sent_at', null)
        .select('id')
      if (claimErr || !claimed || claimed.length !== 1) { skipped++; continue }

      const ok = await sendReminder(resendKey, p, price)
      if (ok) { sent++; continue }
      failed++
      const { error: undoErr } = await admin
        .from('profiles').update({ trial_reminder_sent_at: null })
        .eq('id', p.id).eq('trial_reminder_sent_at', stamp)
      if (undoErr) console.error('REVISAR PRUEBA: el aviso falló y no se pudo desmarcar | perfil:', p.id)
    }

    console.log('trial-reminders:', { candidatos: (due ?? []).length, enviados: sent, fallidos: failed, salteados: skipped })
    return json({ ok: failed === 0, sent, failed, skipped })
  } catch (err) {
    console.error('trial-reminders: error inesperado:', (err as Error)?.message ?? err)
    return json({ ok: false, error: 'inesperado' }, 500)
  }
})

async function sendReminder(resendKey: string, p: any, price: number): Promise<boolean> {
  const firstName = esc(String(p.full_name ?? '').trim().split(/\s+/)[0] ?? '')
  const program = PROGRAM_NAMES[p.program] ?? p.program
  const end = new Date(p.trial_ends_at)
  const endTxt = end.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'numeric' })
  const priceTxt = '$' + price.toLocaleString('es-AR')
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HB Performance <noreply@hbperformance.fit>',
        to: p.email,
        subject: 'Tu semana gratis está por terminar',
        html: `<p>¡Hola${firstName ? ' ' + firstName : ''}!</p>
<p>Tu semana de prueba de <strong>${esc(program)}</strong> termina el <strong>${esc(endTxt)}</strong>.</p>
<p>Si querés seguir entrenando con nosotros, no tenés que hacer nada: ese día Mercado Pago cobra <strong>${priceTxt}</strong> y tu suscripción sigue cada mes.</p>
<p>Si no querés seguir, cancelá antes de esa fecha y no se cobra nada. Podés hacerlo de dos formas:</p>
<ul>
<li>En tu portal: <strong>Perfil → Cancelar suscripción</strong>.</li>
<li>En Mercado Pago: <strong>Suscripciones</strong> → HB Performance → Cancelar.</li>
</ul>
<p>Entrá a tu portal cuando quieras:</p>
<p><a href="${PORTAL}">${PORTAL}</a></p>
<p>— El equipo de HB Performance</p>`,
      }),
    })
    if (!res.ok) {
      console.error('trial-reminders: Resend respondió', res.status, '| perfil:', p.id)
      return false
    }
    return true
  } catch (err) {
    console.error('trial-reminders: no se pudo llamar a Resend:', (err as Error)?.message, '| perfil:', p.id)
    return false
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
