// Supabase Edge Function: send-email
// Verschickt eine E-Mail über einen beliebigen SMTP-Server (hier: 1&1/IONOS).
// Wird von der App aufgerufen, wenn eine Buchung erstellt oder storniert
// wird, um Fahrer/Mitfahrer per E-Mail zu informieren.
//
// SMTP-Zugangsdaten kommen aus Supabase "Secrets" (siehe README). Die
// BCC-Adresse dagegen kommt aus der Datenbank (app_settings, Key
// "email_bcc_to") — das ist im Admin-Bereich unter "Einstellungen" als
// Feld "E-Mail-BCC an" direkt änderbar, ohne die Function neu deployen zu
// müssen. Ist dort nichts eingetragen, wird keine Kopie verschickt.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? 'smtp.ionos.de'
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')
const SMTP_USER = Deno.env.get('SMTP_USER')
const SMTP_PASS = Deno.env.get('SMTP_PASS')
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'pickaride'

// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY werden Edge Functions von
// Supabase automatisch bereitgestellt — hier nichts manuell setzen nötig.
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

async function getBccAddress() {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'email_bcc_to')
    .maybeSingle()
  return data?.value?.trim() || null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP-Zugangsdaten fehlen. Bitte SMTP_USER und SMTP_PASS als Supabase-Secrets setzen.')
    }

    const { to, subject, text } = await req.json()
    if (!to || !subject || !text) {
      return new Response(JSON.stringify({ error: 'Felder "to", "subject" und "text" sind erforderlich.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const bccTo = await getBccAddress()

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        // Port 465 = implizites TLS von Anfang an (IONOS-Empfehlung für
        // einfache Einrichtung). Bei Port 587 (STARTTLS) auf false setzen —
        // siehe SMTP_PORT-Secret bzw. README.
        tls: SMTP_PORT === 465,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    })

    await client.send({
      from: `${SMTP_FROM_NAME} <${SMTP_USER}>`,
      to,
      ...(bccTo ? { bcc: bccTo } : {}),
      subject,
      content: text,
    })

    await client.close()

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-email Fehler:', err)
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
