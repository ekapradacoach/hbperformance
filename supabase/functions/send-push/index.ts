// ============================================================================
// Edge Function: send-push   (Web Push de notificaciones de chat)
// ----------------------------------------------------------------------------
// Se dispara desde un INSERT en `public.notifications`. Acepta DOS formatos de body:
//   - Webhook nativo de Supabase:  { type:'INSERT', record:{...fila...} }
//   - Trigger manual (net.http_post con to_jsonb(NEW)):  la fila cruda de notifications
//   (hoy usamos el trigger manual porque el Database Webhook nativo estaba roto; ver CONTEXTO 2026-08-13 (d/e)).
// Filtra a `type='message'`, busca las `push_subscriptions` del destinatario (`record.user_id`) y les manda un
// Web Push firmado con VAPID (ES256) y cifrado aes128gcm (RFC 8291 / RFC 8188).
//
// Implementado con Web Crypto (crypto.subtle) — sin librería externa. Los endpoints
// muertos (404/410) se borran de la tabla.
//
// Secrets: SUPABASE_URL, SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// (La clave pública VAPID se lee de site_config.vapid_public_key, no de Secrets.)
// Deploy: verify_jwt OFF (lo llama el webhook de la base, sin sesión de usuario).
//   supabase functions deploy send-push --no-verify-jwt
//
// ⚠️ El cifrado de Web Push no se puede probar sin un navegador real suscripto: hay que
//    validar con un push real (Android primero) tras el deploy.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SITE = 'https://hbperformance.fit'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const payload = await req.json().catch(() => ({}))

    // Acepta 2 formatos de body (robusto a futuro):
    //  - Webhook nativo de Supabase:  { type:'INSERT', record:{...fila...}, table, schema, old_record }
    //  - Trigger manual (net.http_post con to_jsonb(NEW)):  la fila cruda de `notifications`
    const isEnvelope = payload && typeof payload === 'object' && payload.record != null
    const record = isEnvelope ? payload.record : payload

    // Con el sobre del webhook nativo, actuar SOLO en INSERT (no re-enviar en UPDATE/DELETE, p.ej. al marcar leído).
    // Con el trigger manual (fila cruda) no hay `type` de evento → el trigger ya es INSERT-only por definición.
    if (isEnvelope && payload.type && payload.type !== 'INSERT') {
      return json({ ok: true, skipped: `ignored-event:${payload.type}` })
    }
    // Solo notificaciones de tipo 'message'.
    if (!record || record.type !== 'message') {
      return json({ ok: true, skipped: 'not-a-message-notification' })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Suscripciones push del destinatario
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', record.user_id)
    if (!subs || !subs.length) return json({ ok: true, sent: 0, note: 'no-subscriptions' })

    // Rol del destinatario → arma la URL correcta (atleta vs admin)
    const { data: prof } = await admin
      .from('profiles').select('role').eq('id', record.user_id).maybeSingle()
    const base = prof?.role === 'admin' ? '/admin/index.html' : '/app/dashboard.html'
    const url = SITE + base + (record.link || '')

    const vapidPrivateB64 = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ekapradacoach@gmail.com'
    // La clave pública ya vive en site_config (la usa el front para suscribir) → se reusa acá,
    // así no hace falta un secret extra. La leemos con service_role.
    const { data: cfgPub } = await admin
      .from('site_config').select('value').eq('key', 'vapid_public_key').maybeSingle()
    const vapidPublicB64 = cfgPub?.value ?? ''
    if (!vapidPublicB64 || !vapidPrivateB64) {
      return json({ ok: false, error: 'Faltan VAPID keys (site_config.vapid_public_key o VAPID_PRIVATE_KEY)' }, 500)
    }

    const signingKey = await importVapidSigningKey(b64urlToBytes(vapidPublicB64), vapidPrivateB64)
    const plaintext = utf8(JSON.stringify({
      title: record.title || 'HB Performance',
      body: record.body || '',
      url,
      tag: 'hb-msg-' + record.user_id,
    }))

    let sent = 0, removed = 0
    for (const s of subs) {
      try {
        const status = await sendOne(s, plaintext, signingKey, subject, vapidPublicB64)
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id)
          removed++
        } else if (status >= 200 && status < 300) {
          sent++
        } else {
          console.warn('push no-2xx:', status, s.endpoint)
        }
      } catch (e) {
        console.error('push error:', (e as Error).message, s.endpoint)
      }
    }
    return json({ ok: true, sent, removed, total: subs.length })

  } catch (err) {
    console.error('send-push error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Envío de un push a UNA suscripción. Devuelve el status HTTP del push service.
// ---------------------------------------------------------------------------
async function sendOne(sub: any, plaintext: Uint8Array, signingKey: CryptoKey, subject: string, vapidPublicB64: string): Promise<number> {
  const jwt = await buildVapidJWT(sub.endpoint, signingKey, subject)
  const body = await encryptPayload(sub.p256dh, sub.auth, plaintext)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapidPublicB64}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body,
  })
  return res.status
}

// ---------------------------------------------------------------------------
// VAPID: JWT ES256 firmado con la clave privada VAPID.
// ---------------------------------------------------------------------------
async function importVapidSigningKey(publicKeyBytes: Uint8Array, privateB64url: string): Promise<CryptoKey> {
  // JWK a partir de las claves crudas: x,y del punto público (65 bytes: 0x04||X||Y) + d de la privada.
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(publicKeyBytes.slice(1, 33)),
    y: bytesToB64url(publicKeyBytes.slice(33, 65)),
    d: privateB64url,
    ext: true,
  }
  return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function buildVapidJWT(endpoint: string, signingKey: CryptoKey, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60
  const payload = bytesToB64url(utf8(JSON.stringify({ aud, exp, sub: subject })))
  const signingInput = `${header}.${payload}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, utf8(signingInput))
  // crypto.subtle devuelve la firma ECDSA en formato JOSE crudo (r||s, 64 bytes) → base64url.
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`
}

// ---------------------------------------------------------------------------
// Cifrado del payload: aes128gcm (RFC 8188) con el esquema de Web Push (RFC 8291).
// ---------------------------------------------------------------------------
async function encryptPayload(p256dhB64: string, authB64: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(p256dhB64)   // clave pública del navegador (65 bytes)
  const authSecret = b64urlToBytes(authB64)   // secreto de auth (16 bytes)

  // Par ECDH efímero del servidor
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey)) // 65 bytes

  // Secreto compartido ECDH(as_priv, ua_pub)
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256)
  const ecdhSecret = new Uint8Array(ecdhBits) // 32 bytes

  // ikm = HKDF(salt=authSecret, ikm=ecdhSecret, info="WebPush: info"||0x00||ua_pub||as_pub, 32)
  const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublicRaw)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16)
  const nonce = await hkdf(salt, ikm, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12)

  // Plaintext + delimitador de registro 0x02 (único/último registro), luego AES-128-GCM.
  const padded = concat(plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded))

  // Cabecera aes128gcm: salt(16) || rs(4, big-endian = 4096) || idlen(1)=65 || keyid(as_pub, 65) || ciphertext
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00])
  const idlen = new Uint8Array([asPublicRaw.length])
  return concat(salt, rs, idlen, asPublicRaw, ct)
}

// HKDF de Web Crypto (extract+expand). SHA-256.
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)
  return new Uint8Array(bits)
}

// ---------------------------------------------------------------------------
// Helpers base64url / bytes
// ---------------------------------------------------------------------------
function b64urlToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = t.length % 4 ? 4 - (t.length % 4) : 0
  t += '='.repeat(pad)
  const bin = atob(t)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function utf8(s: string): Uint8Array { return new TextEncoder().encode(s) }
function concat(...arrs: Uint8Array[]): Uint8Array {
  let len = 0
  for (const a of arrs) len += a.length
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}
