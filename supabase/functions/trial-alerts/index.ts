// ============================================================================
// Edge Function: trial-alerts   (Fase 2, semana de prueba, etapa 7)
// ----------------------------------------------------------------------------
// Aviso diario al admin, SOLO si hay algo para revisar. La llama pg_cron (20261106_trial_admin.sql) a las 9:00 AR.
// Cuenta:
//  · casos de trial_reviews sin resolver, creados hace más de 30 minutos;
//  · pruebas in_trial vencidas hace más de 24 horas sin resultado (el cobro no llegó);
//  · pruebas cortadas por cobro rechazado con un pago registrado después del corte.
// Si todo da 0, no manda nada. El mail lleva solo cantidades y el link al admin: ningún dato de alumnos.
// El destinatario es el secreto ALERT_EMAIL (no se guarda en site_config, que tiene lectura pública).
//
// Protección: header x-cron-secret igual a CRON_SECRET (el mismo del mail del día 6); si no, 401.
// Secretos: SUPABASE_URL, SERVICE_ROLE_KEY, RESEND_API_KEY, CRON_SECRET, ALERT_EMAIL (nuevo).
// Deploy: verify_jwt = OFF (la llama el cron de la base, sin sesión).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_URL = 'https://hbperformance.fit/admin/index.html'

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  if (req.method !== 'POST' || !secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ ok: false, error: 'No autorizado' }, 401)
  }
  const to = (Deno.env.get('ALERT_EMAIL') ?? '').trim()
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  if (!to || !resendKey) {
    console.error('trial-alerts: falta ALERT_EMAIL o RESEND_API_KEY')
    return json({ ok: false, error: 'Falta configuración' }, 500)
  }

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '')
    const now = Date.now()

    const { data: reviews, error: rErr } = await admin.from('trial_reviews')
      .select('preapproval_id').is('resolved_at', null).lte('created_at', new Date(now - 30 * 60 * 1000).toISOString())
    if (rErr) return fail('casos', rErr)

    const { data: stuck, error: sErr } = await admin.from('profiles')
      .select('id').eq('trial_status', 'in_trial').lte('trial_ends_at', new Date(now - 24 * 3600 * 1000).toISOString())
    if (sErr) return fail('pruebas vencidas', sErr)

    const { data: cut, error: cErr } = await admin.from('profiles')
      .select('id, trial_resolved_at').eq('trial_status', 'charge_rejected')
    if (cErr) return fail('cortes', cErr)
    let paidAfterCut = 0
    const cutIds = (cut ?? []).map((p: any) => p.id)
    if (cutIds.length) {
      const { data: pays, error: pErr } = await admin.from('payments').select('athlete_id, paid_at').in('athlete_id', cutIds)
      if (pErr) return fail('pagos', pErr)
      for (const p of cut ?? []) {
        const cutDay = arDay(p.trial_resolved_at)
        if ((pays ?? []).some((x: any) => x.athlete_id === p.id && String(x.paid_at) >= cutDay)) paidAfterCut++
      }
    }

    const counts = { casos: (reviews ?? []).length, vencidas: (stuck ?? []).length, pagos_despues_del_corte: paidAfterCut }
    if (!counts.casos && !counts.vencidas && !counts.pagos_despues_del_corte) {
      console.log('trial-alerts: nada para revisar')
      return json({ ok: true, sent: false, ...counts })
    }

    const lines = [
      counts.casos ? `<li><strong>${counts.casos}</strong> ${counts.casos === 1 ? 'caso' : 'casos'} de la prueba sin resolver (alguien pudo haberse suscripto o pagado sin tener acceso).</li>` : '',
      counts.vencidas ? `<li><strong>${counts.vencidas}</strong> ${counts.vencidas === 1 ? 'prueba vencida' : 'pruebas vencidas'} hace más de un día sin que llegue el cobro.</li>` : '',
      counts.pagos_despues_del_corte ? `<li><strong>${counts.pagos_despues_del_corte}</strong> ${counts.pagos_despues_del_corte === 1 ? 'persona pagó' : 'personas pagaron'} después de que se le cortó la prueba por cobro rechazado.</li>` : '',
    ].join('')
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HB Performance <noreply@hbperformance.fit>',
        to,
        subject: 'Semana de prueba: hay casos para revisar',
        html: `<p>Hola,</p><p>Hoy hay cosas de la semana de prueba para revisar:</p><ul>${lines}</ul>
<p>Los ves en el panel → <strong>🧪 Pruebas</strong>:</p><p><a href="${ADMIN_URL}">${ADMIN_URL}</a></p>`,
      }),
    })
    if (!res.ok) {
      console.error('trial-alerts: Resend respondió', res.status)
      return json({ ok: false, error: 'No se pudo mandar el aviso', ...counts }, 502)
    }
    console.log('trial-alerts: aviso enviado', counts)
    return json({ ok: true, sent: true, ...counts })
  } catch (err) {
    console.error('trial-alerts: error inesperado:', (err as Error)?.message ?? err)
    return json({ ok: false, error: 'inesperado' }, 500)
  }
})

function fail(what: string, err: any) {
  console.error(`trial-alerts: no se pudo leer ${what}:`, err?.message)
  return json({ ok: false, error: 'lectura' }, 500)
}
function arDay(ts: unknown): string {
  const ms = Date.parse(String(ts ?? ''))
  return isNaN(ms) ? '0000-00-00' : new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
