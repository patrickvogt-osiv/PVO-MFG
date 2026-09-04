import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getEuroExchangeRate, formatConverted } from '../lib/currency'
import Logo from '../components/Logo'

const APP_BASE_URL = window.location.origin

// Distanz zwischen zwei Koordinaten in km (Luftlinie), für gespeicherte
// Suchaufträge ("Informiere mich...").
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Schickt eine E-Mail über die Supabase Edge Function "send-email" (SMTP im
// Hintergrund). Schlägt der Versand fehl, wird das nur geloggt.
async function sendEmailNotification(to, subject, text) {
  if (!to) {
    console.log('[E-Mail] Übersprungen — keine Empfängeradresse vorhanden.', { subject })
    return
  }
  console.log('[E-Mail] Sende-Versuch gestartet.', { to, subject })
  try {
    const { data, error } = await supabase.functions.invoke('send-email', { body: { to, subject, text } })
    if (error) {
      console.error('[E-Mail] Function meldete einen Fehler:', error, { to, subject })
    } else {
      console.log('[E-Mail] Erfolgreich ausgelöst, Antwort:', data, { to, subject })
    }
  } catch (err) {
    console.error('[E-Mail] Aufruf ist fehlgeschlagen, bevor eine Antwort kam (Netzwerk/CORS/falsche Zugangsdaten?):', err, { to, subject })
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function AdminDashboard() {
  const [tab, setTab] = useState('people')

  return (
    <>
      <div className="app-header">
        <div className="app-header-text">
          <Logo height={36} />
          <p>Admin — Strecken, Autos, Fahrten & Einladungen verwalten</p>
        </div>
      </div>
      <div className="container">
        <div className="tabs">
          <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>Mitfahrer</button>
          <button className={tab === 'drivers' ? 'active' : ''} onClick={() => setTab('drivers')}>Fahrer</button>
          <button className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>Strecken</button>
          <button className={tab === 'cars' ? 'active' : ''} onClick={() => setTab('cars')}>Autos</button>
          <button className={tab === 'trips' ? 'active' : ''} onClick={() => setTab('trips')}>Fahrten</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Einstellungen</button>
          <button className={tab === 'emaillog' ? 'active' : ''} onClick={() => setTab('emaillog')}>E-Mail-Log</button>
        </div>
        {tab === 'people' && <PeopleTab />}
        {tab === 'drivers' && <DriversTab />}
        {tab === 'routes' && <RoutesTab />}
        {tab === 'cars' && <CarsTab />}
        {tab === 'trips' && <TripsTab />}
        {tab === 'settings' && <ProjectSettingsTab />}
        {tab === 'emaillog' && <EmailLogTab />}
        <button className="secondary" style={{ width: '100%', marginTop: 20 }} onClick={() => supabase.auth.signOut()}>
          Abmelden
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
function EmailLogTab() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'success' | 'error'

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('email_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    setEntries(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = entries.filter((e) => {
    if (filter === 'success') return e.success
    if (filter === 'error') return !e.success
    return true
  })

  function formatTimestamp(ts) {
    return new Date(ts).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'medium' })
  }

  return (
    <div className="card">
      <h3>E-Mail-Log</h3>
      <div className="meta" style={{ marginBottom: 10 }}>
        Zeigt die letzten 300 Versandversuche der Edge Function "send-email" (Buchung, Stornierung,
        Suchauftrag-Benachrichtigung usw.) — jeweils mit Zeitpunkt, Adressat und Ergebnis.
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={filter === 'all' ? '' : 'secondary'} onClick={() => setFilter('all')}>Alle ({entries.length})</button>
        <button className={filter === 'success' ? '' : 'secondary'} onClick={() => setFilter('success')}>
          ✓ Erfolg ({entries.filter((e) => e.success).length})
        </button>
        <button className={filter === 'error' ? '' : 'secondary'} onClick={() => setFilter('error')}>
          ✕ Fehler ({entries.filter((e) => !e.success).length})
        </button>
        <button className="secondary" onClick={load}>Aktualisieren</button>
      </div>
      {loading && <div className="empty-state">Lädt …</div>}
      {!loading && filtered.length === 0 && <div className="empty-state">Keine Einträge.</div>}
      {!loading && filtered.map((e) => (
        <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <strong>{e.recipient}</strong>
              {e.subject && <div className="meta">{e.subject}</div>}
              <div className="meta">{formatTimestamp(e.created_at)}</div>
              {!e.success && e.error_message && (
                <div className="meta" style={{ color: 'var(--color-danger)', marginTop: 4 }}>{e.error_message}</div>
              )}
            </div>
            <span className={`badge ${e.success ? '' : 'full'}`} style={{ flex: 'none' }}>
              {e.success ? '✓ Erfolg' : '✕ Fehler'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
function ProjectSettingsTab() {
  const [bmcLink, setBmcLink] = useState('')
  const [emailBccTo, setEmailBccTo] = useState('')
  const [impressum, setImpressum] = useState('')
  const [welcomeIntro, setWelcomeIntro] = useState('')
  const [welcomeDetails, setWelcomeDetails] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('*')
      .in('key', ['buymeacoffee_link', 'email_bcc_to', 'impressum', 'welcome_text_intro', 'welcome_text_details'])
    setBmcLink(data?.find((r) => r.key === 'buymeacoffee_link')?.value || '')
    setEmailBccTo(data?.find((r) => r.key === 'email_bcc_to')?.value || '')
    setImpressum(data?.find((r) => r.key === 'impressum')?.value || '')
    setWelcomeIntro(data?.find((r) => r.key === 'welcome_text_intro')?.value || '')
    setWelcomeDetails(data?.find((r) => r.key === 'welcome_text_details')?.value || '')
    setLoaded(true)
  }, [])

  useEffect(() => { load() }, [load])

  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('app_settings').upsert([
      { key: 'buymeacoffee_link', value: bmcLink.trim() || null, updated_at: new Date().toISOString() },
      { key: 'email_bcc_to', value: emailBccTo.trim() || null, updated_at: new Date().toISOString() },
      { key: 'impressum', value: impressum.trim() || null, updated_at: new Date().toISOString() },
      { key: 'welcome_text_intro', value: welcomeIntro.trim() || null, updated_at: new Date().toISOString() },
      { key: 'welcome_text_details', value: welcomeDetails.trim() || null, updated_at: new Date().toISOString() },
    ])
    if (error) { alert('Fehler beim Speichern: ' + error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!loaded) return null

  return (
    <div className="card">
      <h3>Projekt-Einstellungen</h3>
      <form onSubmit={save}>
        <label>Buy Me a Coffee — Projekt-Link</label>
        <input
          type="url"
          value={bmcLink}
          onChange={(e) => setBmcLink(e.target.value)}
          placeholder="z.B. https://buymeacoffee.com/deinprojekt"
        />
        <div className="meta" style={{ marginTop: 4, marginBottom: 10 }}>
          Dies ist der EINE Link des Projekts, den alle Fahrer und Mitfahrer zum
          Unterstützen nutzen — nicht pro Person, sondern zentral hier gepflegt.
        </div>

        <label>E-Mail-BCC an</label>
        <input
          type="email"
          value={emailBccTo}
          onChange={(e) => setEmailBccTo(e.target.value)}
          placeholder="z.B. deine-adresse@domain.de"
        />
        <div className="meta" style={{ marginTop: 4, marginBottom: 10 }}>
          Jede automatisch verschickte E-Mail (Buchung/Stornierung) geht zusätzlich
          als Kopie an diese Adresse. Leer lassen, um keine Kopie zu verschicken.
        </div>

        <label>Impressum</label>
        <textarea
          value={impressum}
          onChange={(e) => setImpressum(e.target.value)}
          rows={10}
          placeholder={'z.B.\nMax Mustermann\nMusterstraße 1\n12345 Musterstadt\n\nE-Mail: kontakt@example.com\nTelefon: +41 79 123 45 67'}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, padding: 10, borderRadius: 10, border: '1px solid var(--color-border)', resize: 'vertical' }}
        />
        <div className="meta" style={{ marginTop: 4, marginBottom: 10 }}>
          Wird öffentlich unter /impressum angezeigt (Link erscheint auf den
          Start-/Landing-Seiten von Fahrern und Mitfahrern). Bitte hier deine
          rechtlich vollständigen Angaben eintragen (Name/Firma, Anschrift,
          Kontaktmöglichkeit) — je nach Land können weitere Pflichtangaben nötig
          sein; das kann ich als KI nicht rechtssicher für dich beurteilen.
        </div>

        <label>Willkommenstext — immer sichtbarer Teil</label>
        <textarea
          value={welcomeIntro}
          onChange={(e) => setWelcomeIntro(e.target.value)}
          rows={5}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, padding: 10, borderRadius: 10, border: '1px solid var(--color-border)', resize: 'vertical' }}
        />
        <div className="meta" style={{ marginTop: 4, marginBottom: 10 }}>
          Erscheint direkt oben auf der Landing-Seite (vor dem Button "Warum - Wie -
          Kosten"). Leerzeile = neuer Absatz.
        </div>

        <label>Willkommenstext — Teil hinter "Warum - Wie - Kosten"</label>
        <textarea
          value={welcomeDetails}
          onChange={(e) => setWelcomeDetails(e.target.value)}
          rows={10}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, padding: 10, borderRadius: 10, border: '1px solid var(--color-border)', resize: 'vertical' }}
        />
        <div className="meta" style={{ marginTop: 4, marginBottom: 10 }}>
          Erscheint erst, wenn jemand auf der Landing-Seite auf "Warum - Wie - Kosten"
          klickt. Leerzeile = neuer Absatz.
        </div>

        <button style={{ width: '100%' }}>{saved ? '✓ Gespeichert' : 'Speichern'}</button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
function PeopleTab() {
  const [people, setPeople] = useState([])
  const [name, setName] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [ratingsByPerson, setRatingsByPerson] = useState({})
  const [bmcDrafts, setBmcDrafts] = useState({})
  const [bmcSavedId, setBmcSavedId] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('people').select('*').order('created_at', { ascending: false })
    setPeople(data || [])
    const nextDrafts = {}
    for (const p of data || []) {
      nextDrafts[p.id] = {
        active: p.bmc_subscription_active || false,
        lastPaymentDate: p.bmc_last_payment_date || '',
      }
    }
    setBmcDrafts(nextDrafts)

    const { data: ratings } = await supabase
      .from('person_ratings')
      .select('person_id, rating_punctuality, rating_cleanliness, rating_communication')
    const grouped = {}
    for (const r of ratings || []) {
      if (!grouped[r.person_id]) grouped[r.person_id] = []
      grouped[r.person_id].push(r)
    }
    const summaries = {}
    for (const [personId, rows] of Object.entries(grouped)) {
      const avg = (field) => Math.round((rows.reduce((sum, r) => sum + r[field], 0) / rows.length) * 10) / 10
      const overall = Math.round(
        (rows.reduce((sum, r) => sum + (r.rating_punctuality + r.rating_cleanliness + r.rating_communication) / 3, 0) / rows.length) * 10
      ) / 10
      summaries[personId] = {
        count: rows.length,
        avg_punctuality: avg('rating_punctuality'),
        avg_cleanliness: avg('rating_cleanliness'),
        avg_communication: avg('rating_communication'),
        avg_overall: overall,
      }
    }
    setRatingsByPerson(summaries)
  }, [])

  useEffect(() => { load() }, [load])

  async function addPerson(e) {
    e.preventDefault()
    if (!name.trim()) return
    await supabase.from('people').insert({ name: name.trim() })
    setName('')
    load()
  }

  async function toggleRevoke(p) {
    await supabase.from('people').update({ revoked: !p.revoked }).eq('id', p.id)
    load()
  }

  function inviteLink(token) {
    return `${APP_BASE_URL}/invite/${token}`
  }

  function copyLink(p) {
    navigator.clipboard.writeText(inviteLink(p.invite_token))
    setCopiedId(p.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function updateBmcDraft(personId, field, value) {
    setBmcDrafts((prev) => ({ ...prev, [personId]: { ...prev[personId], [field]: value } }))
  }

  async function saveBmc(p) {
    const draft = bmcDrafts[p.id]
    const { error } = await supabase.from('people').update({
      bmc_subscription_active: draft.active,
      bmc_last_payment_date: draft.lastPaymentDate || null,
    }).eq('id', p.id)
    if (error) { alert('Fehler beim Speichern: ' + error.message); return }
    setBmcSavedId(p.id)
    setTimeout(() => setBmcSavedId(null), 1500)
    load()
  }

  return (
    <>
      <div className="card">
        <h3>Neuen Mitfahrer einladen</h3>
        <form onSubmit={addPerson}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Anna Muster" required />
          <button style={{ marginTop: 12, width: '100%' }}>Einladung erstellen</button>
        </form>
      </div>

      {people.map((p) => {
        const draft = bmcDrafts[p.id] || { active: false, lastPaymentDate: '' }
        return (
          <div className="card" key={p.id}>
            <h3>{p.name} {p.revoked && <span className="badge full">widerrufen</span>}</h3>
            {(p.phone || p.email) && (
              <div className="meta">{[p.phone, p.email].filter(Boolean).join(' · ')}</div>
            )}
            <div className="meta" style={{ marginTop: 4 }}>
              {ratingsByPerson[p.id]
                ? `⭐ ${ratingsByPerson[p.id].avg_overall} (${ratingsByPerson[p.id].count} Bewertung${ratingsByPerson[p.id].count === 1 ? '' : 'en'}) — Pünktlichkeit ${ratingsByPerson[p.id].avg_punctuality} · Sauberkeit ${ratingsByPerson[p.id].avg_cleanliness} · Kommunikation ${ratingsByPerson[p.id].avg_communication}`
                : 'Noch keine Bewertungen.'}
            </div>
            <div className="link-box">
              <span style={{ flex: 1 }}>{inviteLink(p.invite_token)}</span>
              <button className="secondary" style={{ padding: '4px 8px' }} onClick={() => copyLink(p)}>
                {copiedId === p.id ? '✓' : 'Kopieren'}
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => updateBmcDraft(p.id, 'active', e.target.checked)}
                style={{ width: 'auto' }}
              /> ☕ Buy-Me-a-Coffee-Abo aktiv
            </label>
            <label>Letztes Zahldatum</label>
            <input
              type="date"
              value={draft.lastPaymentDate}
              onChange={(e) => updateBmcDraft(p.id, 'lastPaymentDate', e.target.value)}
            />
            <button className="secondary" style={{ marginTop: 10, width: '100%' }} onClick={() => saveBmc(p)}>
              {bmcSavedId === p.id ? '✓ Gespeichert' : 'BMC-Status speichern'}
            </button>

            <button
              className={p.revoked ? 'secondary' : 'danger'}
              style={{ marginTop: 10 }}
              onClick={() => toggleRevoke(p)}
            >
              {p.revoked ? 'Zugang wiederherstellen' : 'Zugang widerrufen'}
            </button>
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
function emptyAddress() {
  return { name: '', postal_code: '', street: '', house_number: '', country: '', maps_link: '' }
}

function formatAddress(s) {
  if (!s) return ''
  const line1 = [s.postal_code, s.name].filter(Boolean).join(' ')
  const line2 = [s.street, s.house_number].filter(Boolean).join(', ')
  return [line1, line2, s.country].filter(Boolean).join(', ')
}

// Zerlegt einen frei eingegebenen Adresstext (z.B. "Wünscherstraße 42, 80939
// München") über OpenStreetMap (Nominatim, kostenlos, kein Key) in Straße,
// Hausnummer, PLZ und Ort. Land bekommt "Deutschland" als Standardwert, falls
// keines erkannt wird.
async function parseAddressText(text) {
  if (!text || text.trim().length < 3) {
    throw new Error('Bitte eine Adresse eingeben.')
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&accept-language=de&q=${encodeURIComponent(text)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Adressdienst nicht erreichbar.')
  const data = await res.json()
  if (!data || data.length === 0) {
    throw new Error('Adresse nicht gefunden. Bitte Felder manuell ausfüllen.')
  }
  const addr = data[0].address || {}
  const result = {}
  const street = addr.road || addr.pedestrian || addr.footway
  if (street) result.street = street
  if (addr.house_number) result.house_number = addr.house_number
  if (addr.postcode) result.postal_code = addr.postcode
  const city = addr.city || addr.town || addr.village || addr.municipality
  if (city) result.name = city
  result.country = addr.country || 'Deutschland'
  return result
}

// Eingabefeld, das einen kompletten Adresstext entgegennimmt und per Klick
// die zerlegten Felder an den Aufrufer zurückgibt.
function AddressAutoFill({ onParsed }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleParse() {
    setError(null)
    setBusy(true)
    try {
      const parsed = await parseAddressText(text)
      onParsed(parsed)
      setText('')
    } catch (err) {
      setError(err.message || 'Adresse konnte nicht erkannt werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <label>Adresse einfügen (füllt Straße/Hausnr./PLZ/Ort automatisch aus)</label>
      <div className="row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="z.B. Wünscherstraße 42, 80939 München"
        />
        <button type="button" className="secondary" style={{ flex: 'none' }} onClick={handleParse} disabled={busy || !text.trim()}>
          {busy ? '…' : 'Übernehmen'}
        </button>
      </div>
      {error && <div className="notice error" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  )
}

function AddressFields({ value, onChange, prefix }) {
  return (
    <>
      <AddressAutoFill onParsed={(parsed) => onChange({ ...value, ...parsed })} />
      <div className="row">
        <div>
          <label>PLZ</label>
          <input value={value.postal_code} onChange={(e) => onChange({ ...value, postal_code: e.target.value })} placeholder="79098" />
        </div>
        <div style={{ flex: 2 }}>
          <label>Stadt</label>
          <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={prefix ? `${prefix} Stadt` : 'Stadt'} required />
        </div>
      </div>
      <div className="row">
        <div style={{ flex: 2 }}>
          <label>Straße</label>
          <input value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} placeholder="Bahnhofstraße" />
        </div>
        <div>
          <label>Hausnr.</label>
          <input value={value.house_number} onChange={(e) => onChange({ ...value, house_number: e.target.value })} placeholder="12" />
        </div>
      </div>
      <label>Land</label>
      <input value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })} placeholder="z.B. Deutschland" />
      <label>Google-Maps-Link</label>
      <div className="row">
        <input value={value.maps_link} onChange={(e) => onChange({ ...value, maps_link: e.target.value })} placeholder="https://maps.app.goo.gl/..." />
        {value.maps_link && (
          <a href={value.maps_link} target="_blank" rel="noreferrer" style={{ flex: 'none' }}>
            <button type="button" className="secondary" style={{ height: '100%' }}>📍</button>
          </a>
        )}
      </div>
    </>
  )
}

function DriversTab() {
  const [drivers, setDrivers] = useState([])
  const [name, setName] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [drafts, setDrafts] = useState({}) // { [driverId]: { payment_info, reference_currency, rate_eur_per_100km } }
  const [savedId, setSavedId] = useState(null)
  const [ratingsByDriver, setRatingsByDriver] = useState({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('drivers').select('*').order('created_at', { ascending: false })
    setDrivers(data || [])
    const nextDrafts = {}
    for (const d of data || []) {
      nextDrafts[d.id] = {
        payment_info: d.payment_info || '',
        reference_currency: d.reference_currency || '',
        rate_eur_per_100km: d.rate_eur_per_100km ?? '',
        bmcActive: d.bmc_subscription_active || false,
        bmcLastPaymentDate: d.bmc_last_payment_date || '',
      }
    }
    setDrafts(nextDrafts)

    const { data: ratings } = await supabase
      .from('driver_ratings')
      .select('driver_id, rating_experience, rating_punctuality, rating_driving, rating_cleanliness, rating_communication')
    const grouped = {}
    for (const r of ratings || []) {
      if (!grouped[r.driver_id]) grouped[r.driver_id] = []
      grouped[r.driver_id].push(r)
    }
    const summaries = {}
    for (const [driverId, rows] of Object.entries(grouped)) {
      const avg = (field) => Math.round((rows.reduce((sum, r) => sum + r[field], 0) / rows.length) * 10) / 10
      const overall = Math.round(
        (rows.reduce((sum, r) => sum + (r.rating_experience + r.rating_punctuality + r.rating_driving + r.rating_cleanliness + r.rating_communication) / 5, 0) / rows.length) * 10
      ) / 10
      summaries[driverId] = {
        count: rows.length,
        avg_experience: avg('rating_experience'),
        avg_punctuality: avg('rating_punctuality'),
        avg_driving: avg('rating_driving'),
        avg_cleanliness: avg('rating_cleanliness'),
        avg_communication: avg('rating_communication'),
        avg_overall: overall,
      }
    }
    setRatingsByDriver(summaries)
  }, [])

  useEffect(() => { load() }, [load])

  async function addDriver(e) {
    e.preventDefault()
    if (!name.trim()) return
    const { error } = await supabase.from('drivers').insert({ name: name.trim() })
    if (error) { alert('Fehler beim Anlegen: ' + error.message); return }
    setName('')
    load()
  }

  async function toggleRevoke(d) {
    await supabase.from('drivers').update({ revoked: !d.revoked }).eq('id', d.id)
    load()
  }

  function inviteLink(token) {
    return `${APP_BASE_URL}/driver/${token}`
  }

  function copyLink(d) {
    navigator.clipboard.writeText(inviteLink(d.invite_token))
    setCopiedId(d.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function updateDraft(driverId, field, value) {
    setDrafts((prev) => ({ ...prev, [driverId]: { ...prev[driverId], [field]: value } }))
  }

  async function saveDriverProfile(d) {
    const draft = drafts[d.id] || {}
    const { error } = await supabase.from('drivers').update({
      payment_info: draft.payment_info?.trim() || null,
      reference_currency: draft.reference_currency?.trim().toUpperCase() || null,
      rate_eur_per_100km: draft.rate_eur_per_100km === '' ? null : Number(draft.rate_eur_per_100km),
      bmc_subscription_active: draft.bmcActive || false,
      bmc_last_payment_date: draft.bmcLastPaymentDate || null,
    }).eq('id', d.id)
    if (error) { alert('Fehler beim Speichern: ' + error.message); return }
    setSavedId(d.id)
    setTimeout(() => setSavedId(null), 1500)
    load()
  }

  return (
    <>
      <div className="card">
        <h3>Neuen Fahrer einladen</h3>
        <div className="meta" style={{ marginBottom: 8 }}>
          Bist du selbst auch Fahrer? Leg dich hier einfach zusätzlich als Fahrer an und
          nutze deinen eigenen Einladungslink, um Fahrten zu veröffentlichen.
        </div>
        <form onSubmit={addDriver}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Peter Muster" required />
          <button style={{ marginTop: 12, width: '100%' }}>Einladung erstellen</button>
        </form>
      </div>

      {drivers.map((d) => {
        const draft = drafts[d.id] || { payment_info: '', reference_currency: '', rate_eur_per_100km: '', bmcActive: false, bmcLastPaymentDate: '' }
        return (
          <div className="card" key={d.id}>
            <h3>{d.name} {d.revoked && <span className="badge full">widerrufen</span>}</h3>
            {(d.phone || d.email) && (
              <div className="meta">{[d.phone, d.email].filter(Boolean).join(' · ')}</div>
            )}
            <div className="meta" style={{ marginTop: 4 }}>
              {ratingsByDriver[d.id]
                ? `⭐ ${ratingsByDriver[d.id].avg_overall} (${ratingsByDriver[d.id].count} Bewertung${ratingsByDriver[d.id].count === 1 ? '' : 'en'}) — Fahrerlebnis ${ratingsByDriver[d.id].avg_experience} · Pünktlichkeit ${ratingsByDriver[d.id].avg_punctuality} · Fahrweise ${ratingsByDriver[d.id].avg_driving} · Sauberkeit ${ratingsByDriver[d.id].avg_cleanliness} · Kommunikation ${ratingsByDriver[d.id].avg_communication}`
                : 'Noch keine Bewertungen.'}
            </div>
            <div className="link-box">
              <span style={{ flex: 1 }}>{inviteLink(d.invite_token)}</span>
              <button className="secondary" style={{ padding: '4px 8px' }} onClick={() => copyLink(d)}>
                {copiedId === d.id ? '✓' : 'Kopieren'}
              </button>
            </div>

            <label style={{ marginTop: 10 }}>Zahlungshinweis/-link (z.B. PayPal.me, Twint, WERO)</label>
            <input
              value={draft.payment_info}
              placeholder="z.B. paypal.me/name oder 'Twint an 079 123 45 67'"
              onChange={(e) => updateDraft(d.id, 'payment_info', e.target.value)}
            />
            <div className="row">
              <div>
                <label>Referenzwährung</label>
                <input
                  value={draft.reference_currency}
                  placeholder="z.B. CHF"
                  onChange={(e) => updateDraft(d.id, 'reference_currency', e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <label>EUR/100km-Rate</label>
                <input
                  type="number" min="0" step="0.1"
                  value={draft.rate_eur_per_100km}
                  onChange={(e) => updateDraft(d.id, 'rate_eur_per_100km', e.target.value)}
                />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={draft.bmcActive}
                onChange={(e) => updateDraft(d.id, 'bmcActive', e.target.checked)}
                style={{ width: 'auto' }}
              /> ☕ Buy-Me-a-Coffee-Abo aktiv
            </label>
            <label>Letztes Zahldatum</label>
            <input
              type="date"
              value={draft.bmcLastPaymentDate}
              onChange={(e) => updateDraft(d.id, 'bmcLastPaymentDate', e.target.value)}
            />

            <button className="secondary" style={{ marginTop: 10, width: '100%' }} onClick={() => saveDriverProfile(d)}>
              {savedId === d.id ? '✓ Gespeichert' : 'Speichern'}
            </button>

            <button
              className={d.revoked ? 'secondary' : 'danger'}
              style={{ marginTop: 10 }}
              onClick={() => toggleRevoke(d)}
            >
              {d.revoked ? 'Zugang wiederherstellen' : 'Zugang widerrufen'}
            </button>
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
function RoutesTab() {
  const [routes, setRoutes] = useState([])
  const [routeName, setRouteName] = useState('')
  const [totalPrice, setTotalPrice] = useState('')
  const [startAddr, setStartAddr] = useState(emptyAddress())
  const [endAddr, setEndAddr] = useState(emptyAddress())

  const [openRoute, setOpenRoute] = useState(null)
  const [routeNameDraft, setRouteNameDraft] = useState('')
  const [totalPriceDraft, setTotalPriceDraft] = useState('')
  const [stops, setStops] = useState([])
  const [newStop, setNewStop] = useState(emptyAddress())
  const [priceToNext, setPriceToNext] = useState('')
  const [saveError, setSaveError] = useState(null)
  const [distanceError, setDistanceError] = useState(null)
  const [calculatingDistances, setCalculatingDistances] = useState(false)

  const [comparisonDrivers, setComparisonDrivers] = useState([])
  const [comparisonDriverId, setComparisonDriverId] = useState('')
  const [comparisonRate, setComparisonRate] = useState(null)
  const [driverRatesById, setDriverRatesById] = useState({})

  const comparisonDriver = comparisonDrivers.find((d) => d.id === comparisonDriverId)
  const comparisonCurrency = comparisonDriver?.reference_currency

  useEffect(() => {
    supabase.from('drivers').select('id, name, reference_currency').order('name').then(({ data }) => {
      setComparisonDrivers((data || []).filter((d) => d.reference_currency))
    })
    supabase.from('drivers').select('id, rate_eur_per_100km').then(({ data }) => {
      const map = {}
      for (const d of data || []) map[d.id] = d.rate_eur_per_100km
      setDriverRatesById(map)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!comparisonCurrency) { setComparisonRate(null); return }
    getEuroExchangeRate(comparisonCurrency).then((rate) => { if (!cancelled) setComparisonRate(rate) })
    return () => { cancelled = true }
  }, [comparisonCurrency])

  function convertedHint(amountEur) {
    if (!comparisonCurrency || comparisonRate == null || amountEur == null) return ''
    const text = formatConverted(amountEur, comparisonRate, comparisonCurrency)
    return text ? ` (${text})` : ''
  }

  const [routeStopsMap, setRouteStopsMap] = useState({})

  const loadRoutes = useCallback(async () => {
    const { data } = await supabase.from('routes').select('*, drivers(name)').order('created_at', { ascending: false })
    setRoutes(data || [])

    if (data && data.length > 0) {
      const { data: stopsData } = await supabase
        .from('route_stops')
        .select('route_id, name, order_index')
        .in('route_id', data.map((r) => r.id))
        .order('order_index', { ascending: true })
      const grouped = {}
      for (const s of stopsData || []) {
        grouped[s.route_id] = grouped[s.route_id] || []
        grouped[s.route_id].push(s)
      }
      setRouteStopsMap(grouped)
    } else {
      setRouteStopsMap({})
    }
  }, [])

  useEffect(() => { loadRoutes() }, [loadRoutes])

  async function addRoute(e) {
    e.preventDefault()
    if (!routeName.trim() || !startAddr.name.trim() || !endAddr.name.trim()) return
    const { data: route, error } = await supabase
      .from('routes')
      .insert({ name: routeName.trim(), total_price: Math.max(0, Math.round(Number(totalPrice) || 0)) })
      .select()
      .single()
    if (error) { alert('Fehler beim Anlegen: ' + error.message); return }

    const { error: stopsErr } = await supabase.from('route_stops').insert([
      { route_id: route.id, order_index: 0, name: startAddr.name.trim(), postal_code: startAddr.postal_code || null, street: startAddr.street || null, house_number: startAddr.house_number || null, country: startAddr.country || null, maps_link: startAddr.maps_link || null },
      { route_id: route.id, order_index: 1, name: endAddr.name.trim(), postal_code: endAddr.postal_code || null, street: endAddr.street || null, house_number: endAddr.house_number || null, country: endAddr.country || null, maps_link: endAddr.maps_link || null },
    ])
    if (stopsErr) { alert('Fehler beim Anlegen der Start-/Zielpunkte: ' + stopsErr.message); return }

    setRouteName(''); setTotalPrice(''); setStartAddr(emptyAddress()); setEndAddr(emptyAddress())
    loadRoutes()
  }

  async function deleteRoute(id) {
    if (!confirm('Strecke inkl. aller Zwischenstopps löschen?')) return
    await supabase.from('routes').delete().eq('id', id)
    if (openRoute?.id === id) setOpenRoute(null)
    loadRoutes()
  }

  async function openRouteDetail(route) {
    setOpenRoute(route)
    setRouteNameDraft(route.name)
    setTotalPriceDraft(String(route.total_price ?? 0))
    setNewStop(emptyAddress())
    setPriceToNext('')
    setSaveError(null)
    const { data, error } = await supabase
      .from('route_stops')
      .select('*')
      .eq('route_id', route.id)
      .order('order_index', { ascending: true })
    if (error) {
      setSaveError(
        'Konnte Zwischenstopps nicht laden: ' + error.message +
        ' — falls Adressfelder fehlen, bitte migration_3_adressen_und_gesamtbetrag.sql in Supabase ausführen.'
      )
      return
    }
    setStops(data || [])
  }

  async function saveRouteMeta() {
    setSaveError(null)
    const patch = {}
    if (routeNameDraft.trim() && routeNameDraft !== openRoute.name) patch.name = routeNameDraft.trim()
    const priceNum = Math.max(0, Math.round(Number(totalPriceDraft) || 0))
    if (priceNum !== openRoute.total_price) patch.total_price = priceNum
    if (Object.keys(patch).length === 0) return
    const { error } = await supabase.from('routes').update(patch).eq('id', openRoute.id)
    if (error) { setSaveError('Konnte nicht gespeichert werden: ' + error.message); return }
    setOpenRoute({ ...openRoute, ...patch })
    loadRoutes()
  }

  async function updateStopField(stop, field, value) {
    setSaveError(null)
    const { error } = await supabase.from('route_stops').update({ [field]: value === '' ? null : value }).eq('id', stop.id)
    if (error) { setSaveError('Feld konnte nicht gespeichert werden: ' + error.message); return }
    openRouteDetail(openRoute)
  }

  async function updatePrice(stop, value) {
    const v = Math.max(0, Math.round(Number(value) || 0))
    setSaveError(null)
    const { error } = await supabase.from('route_stops').update({ price_to_next: v }).eq('id', stop.id)
    if (error) { setSaveError('Preis konnte nicht gespeichert werden: ' + error.message); return }
    openRouteDetail(openRoute)
  }

  async function addStop(e) {
    e.preventDefault()
    if (!newStop.name.trim()) return
    if (stops.length < 2) { setSaveError('Bitte zuerst Start- und Zielpunkt anlegen.'); return }
    setSaveError(null)

    // Neuer Zwischenstopp wird immer direkt VOR dem Zielort eingefügt.
    const insertIndex = stops.length - 1
    const prevStop = stops[insertIndex - 1]
    const endStop = stops[stops.length - 1]

    const { error: shiftErr } = await supabase.from('route_stops').update({ order_index: stops.length }).eq('id', endStop.id)
    if (shiftErr) { setSaveError('Konnte Zielort nicht verschieben: ' + shiftErr.message); return }

    const { error: priceErr } = await supabase
      .from('route_stops')
      .update({ price_to_next: Math.max(0, Math.round(Number(priceToNext) || 0)) })
      .eq('id', prevStop.id)
    if (priceErr) { setSaveError('Preis konnte nicht gespeichert werden: ' + priceErr.message); return }

    const { error: insErr } = await supabase.from('route_stops').insert({
      route_id: openRoute.id,
      order_index: insertIndex,
      name: newStop.name.trim(),
      postal_code: newStop.postal_code || null,
      street: newStop.street || null,
      house_number: newStop.house_number || null,
      maps_link: newStop.maps_link || null,
      country: newStop.country || null,
    })
    if (insErr) { setSaveError('Zwischenstopp konnte nicht angelegt werden: ' + insErr.message); return }

    setNewStop(emptyAddress())
    setPriceToNext('')
    openRouteDetail(openRoute)
  }

  async function removeStop(stop) {
    if (!confirm(`„${stop.name}" wirklich entfernen?`)) return
    setSaveError(null)
    const { error: err } = await supabase.from('route_stops').delete().eq('id', stop.id)
    if (err) {
      if (err.code === '23503') {
        setSaveError(`„${stop.name}" kann nicht gelöscht werden, da bereits mindestens eine Buchung diesen Ein-/Ausstiegspunkt nutzt. Storniere zuerst die betreffenden Buchungen.`)
      } else {
        setSaveError('Zwischenstopp konnte nicht gelöscht werden: ' + err.message)
      }
      return
    }
    const remaining = stops.filter((s) => s.id !== stop.id)
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order_index !== i) {
        await supabase.from('route_stops').update({ order_index: i }).eq('id', remaining[i].id)
      }
    }
    openRouteDetail(openRoute)
  }

  // Start (Index 0) und Ziel (letzter Index) bleiben fix; nur Zwischenstopps
  // untereinander können verschoben werden.
  async function moveStop(index, direction) {
    const targetIndex = index + direction
    if (index < 1 || index > stops.length - 2) return
    if (targetIndex < 1 || targetIndex > stops.length - 2) return
    setSaveError(null)
    const a = stops[index]
    const b = stops[targetIndex]
    const { error: err1 } = await supabase.from('route_stops').update({ order_index: b.order_index }).eq('id', a.id)
    const { error: err2 } = err1 ? {} : await supabase.from('route_stops').update({ order_index: a.order_index }).eq('id', b.id)
    if (err1 || err2) { setSaveError('Reihenfolge konnte nicht geändert werden: ' + (err1 || err2).message); return }
    setSaveError('Reihenfolge geändert — bitte die Mitfahrbeiträge (und ggf. Entfernungen neu berechnen) der betroffenen Abschnitte prüfen.')
    openRouteDetail(openRoute)
  }

  // Adressen der Reihe nach über OpenStreetMap (Nominatim) geokodieren und die
  // Fahrstrecke zwischen den Punkten über OSRM (ebenfalls kostenlos, ohne
  // API-Key) berechnen. Läuft komplett im Browser, keine eigene Server-Logik
  // nötig.
  async function calculateDistances() {
    if (stops.length < 2) return
    setDistanceError(null)
    setCalculatingDistances(true)
    try {
      const coords = []
      for (const s of stops) {
        const query = [s.street, s.house_number, s.postal_code, s.name, s.country].filter(Boolean).join(' ')
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
        const res = await fetch(url)
        if (!res.ok) throw new Error('Geocoding-Dienst nicht erreichbar.')
        const data = await res.json()
        if (!data || data.length === 0) {
          throw new Error(`Konnte „${s.name}" nicht auf der Karte finden. Bitte Adresse (Straße/PLZ) präzisieren.`)
        }
        coords.push({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) })
        // Nominatim-Nutzungsrichtlinie: max. 1 Anfrage pro Sekunde
        await new Promise((r) => setTimeout(r, 1100))
      }

      const coordStr = coords.map((c) => `${c.lon},${c.lat}`).join(';')
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false`
      const osrmRes = await fetch(osrmUrl)
      if (!osrmRes.ok) throw new Error('Routing-Dienst nicht erreichbar.')
      const osrmData = await osrmRes.json()
      if (osrmData.code !== 'Ok' || !osrmData.routes?.[0]) {
        throw new Error('Route konnte nicht berechnet werden (evtl. zu weit entfernt oder keine Straßenverbindung gefunden).')
      }
      const legs = osrmData.routes[0].legs

      // Fahrer-Rate ermitteln: bevorzugt die des Streckenbesitzers, sonst
      // ersatzweise die aktuell gewählte Vergleichsfahrer-Rate.
      const effectiveDriverId = openRoute.driver_id || comparisonDriverId || null
      const rate = effectiveDriverId != null ? driverRatesById[effectiveDriverId] : null

      // Koordinaten für ALLE Stopps speichern (auch den letzten, der keine
      // eigene "Distanz bis nächster Stopp" hat), damit die Kartenansicht
      // für Mitfahrer vollständig ist. Ist ein Mitfahrbeitrag noch 0 und eine
      // Fahrer-Rate (EUR/100km) bekannt, wird er automatisch daraus befüllt.
      let totalDistance = 0
      for (let i = 0; i < stops.length; i++) {
        const patch = { latitude: coords[i].lat, longitude: coords[i].lon }
        if (i < legs.length) {
          const distanceKm = Math.round((legs[i].distance / 1000) * 10) / 10
          patch.distance_to_next_km = distanceKm
          patch.duration_to_next_min = Math.round(legs[i].duration / 60)
          totalDistance += distanceKm
          if (rate != null && !stops[i].price_to_next) {
            patch.price_to_next = Math.round((rate * distanceKm) / 100)
          }
        }
        await supabase.from('route_stops').update(patch).eq('id', stops[i].id)
      }

      if (rate != null && !openRoute.total_price) {
        const newTotal = Math.round((rate * totalDistance) / 100)
        await supabase.from('routes').update({ total_price: newTotal }).eq('id', openRoute.id)
        setOpenRoute((prev) => ({ ...prev, total_price: newTotal }))
        setTotalPriceDraft(String(newTotal))
      }

      openRouteDetail(openRoute)
    } catch (err) {
      setDistanceError(err.message || 'Entfernungen konnten nicht berechnet werden.')
    } finally {
      setCalculatingDistances(false)
    }
  }

  if (openRoute) {
    return (
      <div className="card">
        <button className="secondary" style={{ marginBottom: 12 }} onClick={() => { setOpenRoute(null); loadRoutes() }}>← Zurück</button>

        <label>Streckenname</label>
        <input value={routeNameDraft} onChange={(e) => setRouteNameDraft(e.target.value)} onBlur={saveRouteMeta} />

        {comparisonDrivers.length > 0 && (
          <>
            <label>Vergleichswährung (Fahrer)</label>
            <select value={comparisonDriverId} onChange={(e) => setComparisonDriverId(e.target.value)}>
              <option value="">Keine</option>
              {comparisonDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.reference_currency})</option>
              ))}
            </select>
          </>
        )}

        <label>Gesamtbetrag für die ganze Strecke (EUR) — individuell, unabhängig von den Teilstrecken</label>
        <input type="number" min="0" step="1" value={totalPriceDraft} onChange={(e) => setTotalPriceDraft(e.target.value)} onBlur={saveRouteMeta} />
        {comparisonCurrency && <div className="meta">≈{convertedHint(Number(totalPriceDraft) || 0)}</div>}

        {saveError && <div className="notice error" style={{ marginTop: 12 }}>{saveError}</div>}
        {distanceError && <div className="notice error" style={{ marginTop: 12 }}>{distanceError}</div>}

        {stops.length >= 2 && (
          <div style={{ margin: '16px 0', padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
            <strong>{stops[0].name} – {stops[stops.length - 1].name}</strong>
            <span className="meta"> (gesamte Strecke)</span>
            <div><span className="badge">EUR {openRoute.total_price ?? 0}</span></div>
            {stops.every((s, i) => i === stops.length - 1 || s.distance_to_next_km != null) && (() => {
              const totalDistance = Math.round(stops.reduce((sum, s) => sum + (s.distance_to_next_km || 0), 0) * 10) / 10
              const totalDuration = stops.reduce((sum, s) => sum + (s.duration_to_next_min || 0), 0)
              const per100 = totalDistance > 0 ? Math.round((openRoute.total_price / totalDistance) * 100 * 100) / 100 : null
              return (
                <div style={{ marginTop: 6 }}>
                  <span className="meta">
                    ≈ {totalDistance} km · {totalDuration} Min Fahrzeit
                    {per100 != null && ` · ≈ ${per100} EUR/100km${convertedHint(per100)}`}
                  </span>
                </div>
              )
            })()}
          </div>
        )}

        <button
          className="secondary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={calculateDistances}
          disabled={calculatingDistances || stops.length < 2}
        >
          {calculatingDistances ? 'Berechne Entfernungen …' : '📍 Entfernungen & Fahrzeiten berechnen'}
        </button>
        <div className="meta" style={{ marginBottom: 12 }}>
          Kostenlos über OpenStreetMap (Nominatim + OSRM), basierend auf den hinterlegten Adressen. Für genaue Ergebnisse Straße/Hausnummer angeben.
        </div>

        <h3 style={{ marginTop: 16 }}>Streckenpunkte</h3>
        {stops.map((s, i) => {
          const isIntermediate = i !== 0 && i !== stops.length - 1
          const role = i === 0 ? 'Start' : i === stops.length - 1 ? 'Ziel' : `Zwischenstopp #${i}`
          return (
            <div key={s.id}>
              <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '14px 0' }} />

              <div className="row" style={{ alignItems: 'center' }}>
                <span className="badge badge-role" style={{ flex: 'none' }}>{role}</span>
                {isIntermediate && (
                  <>
                    <button
                      className="secondary"
                      style={{ padding: '4px 8px', fontSize: 12, flex: 'none', marginLeft: 'auto' }}
                      disabled={i === 1}
                      onClick={() => moveStop(i, -1)}
                      title="Nach oben verschieben"
                    >↑</button>
                    <button
                      className="secondary"
                      style={{ padding: '4px 8px', fontSize: 12, flex: 'none' }}
                      disabled={i === stops.length - 2}
                      onClick={() => moveStop(i, 1)}
                      title="Nach unten verschieben"
                    >↓</button>
                    <button className="danger" style={{ padding: '4px 8px', fontSize: 12, flex: 'none' }} onClick={() => removeStop(s)}>✕</button>
                  </>
                )}
              </div>

              {i > 0 && stops.length > 2 && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ margin: '0 0 2px' }}>Mitfahrbeitrag bis „{s.name}" (EUR)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={stops[i - 1].price_to_next}
                    onBlur={(e) => updatePrice(stops[i - 1], e.target.value)}
                  />
                  {comparisonCurrency && <div className="meta">≈{convertedHint(stops[i - 1].price_to_next)}</div>}
                  {stops[i - 1].distance_to_next_km != null && (
                    <div className="meta" style={{ marginTop: 4 }}>
                      ≈ {stops[i - 1].distance_to_next_km} km · {stops[i - 1].duration_to_next_min} Min
                      {stops[i - 1].distance_to_next_km > 0 && (() => {
                        const per100 = Math.round((stops[i - 1].price_to_next / stops[i - 1].distance_to_next_km) * 100 * 100) / 100
                        return ` · ≈ ${per100} EUR/100km${convertedHint(per100)}`
                      })()}
                    </div>
                  )}
                </div>
              )}

              <label style={{ marginTop: 12 }}>Adresse</label>
              <AddressAutoFill onParsed={(parsed) => setStops(stops.map((x) => (x.id === s.id ? { ...x, ...parsed } : x)))} />
              <div className="row">
                <div style={{ flex: 2 }}>
                  <label style={{ marginTop: 0 }}>Straße</label>
                  <input
                    value={s.street || ''}
                    placeholder="Bahnhofstraße"
                    onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, street: e.target.value } : x)))}
                  />
                </div>
                <div>
                  <label style={{ marginTop: 0 }}>Hausnr.</label>
                  <input
                    value={s.house_number || ''}
                    placeholder="12"
                    onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, house_number: e.target.value } : x)))}
                  />
                </div>
              </div>
              <div className="row">
                <div>
                  <label style={{ marginTop: 0 }}>PLZ</label>
                  <input
                    value={s.postal_code || ''}
                    placeholder="79098"
                    onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, postal_code: e.target.value } : x)))}
                  />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ marginTop: 0 }}>Ort</label>
                  <input
                    value={s.name || ''}
                    onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                    required
                  />
                </div>
              </div>
              <label>Land</label>
              <input
                value={s.country || ''}
                placeholder="z.B. Deutschland"
                onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, country: e.target.value } : x)))}
              />
              <label>Google-Maps-Link</label>
              <div className="row">
                <input
                  value={s.maps_link || ''}
                  placeholder="https://maps.app.goo.gl/..."
                  onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, maps_link: e.target.value } : x)))}
                />
                {s.maps_link && (
                  <a href={s.maps_link} target="_blank" rel="noreferrer" style={{ flex: 'none' }}>
                    <button type="button" className="secondary" style={{ height: '100%' }}>📍</button>
                  </a>
                )}
              </div>

              <button
                className="secondary"
                style={{ marginTop: 10 }}
                onClick={() => {
                  updateStopField(s, 'name', s.name)
                  updateStopField(s, 'postal_code', s.postal_code)
                  updateStopField(s, 'street', s.street)
                  updateStopField(s, 'house_number', s.house_number)
                  updateStopField(s, 'country', s.country)
                  updateStopField(s, 'maps_link', s.maps_link)
                }}
              >{i === 0 ? 'Startpunkt speichern' : i === stops.length - 1 ? 'Zielpunkt speichern' : 'Zwischenstopp speichern'}</button>
            </div>
          )
        })}

        <form onSubmit={addStop} style={{ marginTop: 14 }}>
          <h3>Neuer Zwischenstopp</h3>
          <div className="meta" style={{ marginBottom: 8 }}>Wird direkt vor dem Zielort „{stops[stops.length - 1]?.name}" eingefügt.</div>
          <AddressFields value={newStop} onChange={setNewStop} prefix="Zwischenstopp:" />
          <label>Mitfahrbeitrag von „{stops[stops.length - 2]?.name}" bis hier (EUR)</label>
          <input type="number" min="0" step="1" value={priceToNext} onChange={(e) => setPriceToNext(e.target.value)} placeholder="0" />
          <button style={{ marginTop: 10, width: '100%' }}>Zwischenstopp hinzufügen</button>
        </form>
      </div>
    )
  }

  return (
    <>
      <div className="card">
        <h3>Neue Strecke</h3>
        <form onSubmit={addRoute}>
          <label>Name der Strecke</label>
          <input value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="z.B. München - Basel" required />

          <label>Gesamtbetrag für die ganze Strecke (EUR)</label>
          <input type="number" min="0" step="1" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="0" />

          <h3 style={{ marginTop: 16 }}>Startpunkt</h3>
          <AddressFields value={startAddr} onChange={setStartAddr} />

          <h3 style={{ marginTop: 16 }}>Zielpunkt</h3>
          <AddressFields value={endAddr} onChange={setEndAddr} />

          <button style={{ marginTop: 14, width: '100%' }}>Strecke anlegen</button>
        </form>
      </div>
      {routes.map((r) => {
        const stops = routeStopsMap[r.id] || []
        const via = stops.length > 2 ? stops.slice(1, -1).map((s) => s.name).join(', ') : ''
        return (
          <div className="card" key={r.id}>
            {r.drivers?.name && <div className="meta">Fahrer {r.drivers.name}</div>}
            <h3>{r.name}</h3>
            <div className="meta">Gesamtbetrag: EUR {r.total_price ?? 0}{via && ` · via ${via}`}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => openRouteDetail(r)}>Streckenpunkte & Beiträge</button>
              <button className="danger" onClick={() => deleteRoute(r.id)}>Löschen</button>
            </div>
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
const CAR_SIZE_OPTIONS = ['Klein', 'Kompakt', 'Mittelklasse', 'Oberklasse']
const CAR_DRIVE_OPTIONS = ['Elektro', 'Verbrenner']

function CarsTab() {
  const [cars, setCars] = useState([])
  const [drivers, setDrivers] = useState([])
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [driverId, setDriverId] = useState('')
  const [size, setSize] = useState('')
  const [driveType, setDriveType] = useState('')
  const [hasAc, setHasAc] = useState(false)
  const [hasSeatHeating, setHasSeatHeating] = useState(false)
  const [hasUsb, setHasUsb] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [savedId, setSavedId] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('cars').select('*, drivers(name)').order('created_at', { ascending: false })
    setCars(data || [])
    const nextDrafts = {}
    for (const c of data || []) {
      nextDrafts[c.id] = {
        size: c.size || '', drive_type: c.drive_type || '',
        has_ac: c.has_ac || false, has_seat_heating: c.has_seat_heating || false, has_usb: c.has_usb || false,
      }
    }
    setDrafts(nextDrafts)
    const { data: dr } = await supabase.from('drivers').select('*').order('name')
    setDrivers(dr || [])
  }, [])

  useEffect(() => { load() }, [load])

  async function addCar(e) {
    e.preventDefault()
    if (!name.trim() || !driverId) return
    const { error } = await supabase.from('cars').insert({
      name: name.trim(), notes: notes.trim() || null, driver_id: driverId,
      size: size || null, drive_type: driveType || null,
      has_ac: hasAc, has_seat_heating: hasSeatHeating, has_usb: hasUsb,
    })
    if (error) { alert('Fehler beim Anlegen: ' + error.message); return }
    setName(''); setNotes(''); setDriverId(''); setSize(''); setDriveType('')
    setHasAc(false); setHasSeatHeating(false); setHasUsb(false)
    load()
  }

  async function deleteCar(id) {
    if (!confirm('Auto löschen? (Fahrten, die dieses Auto nutzen, bleiben erhalten, aber ohne Autozuordnung.)')) return
    await supabase.from('cars').delete().eq('id', id)
    load()
  }

  async function reassignDriver(car, newDriverId) {
    await supabase.from('cars').update({ driver_id: newDriverId || null }).eq('id', car.id)
    load()
  }

  function updateDraft(carId, field, value) {
    setDrafts((prev) => ({ ...prev, [carId]: { ...prev[carId], [field]: value } }))
  }

  async function saveDetails(c) {
    const draft = drafts[c.id]
    const { error } = await supabase.from('cars').update({
      size: draft.size || null, drive_type: draft.drive_type || null,
      has_ac: draft.has_ac, has_seat_heating: draft.has_seat_heating, has_usb: draft.has_usb,
    }).eq('id', c.id)
    if (error) { alert('Fehler beim Speichern: ' + error.message); return }
    setSavedId(c.id)
    setTimeout(() => setSavedId(null), 1500)
    load()
  }

  return (
    <>
      <div className="card">
        <h3>Neues Auto</h3>
        {drivers.length === 0 && (
          <div className="notice error">Bitte zuerst im Tab „Fahrer" mindestens einen Fahrer anlegen.</div>
        )}
        <form onSubmit={addCar}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. VW Passat (blau)" required />
          <label>Notiz (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="z.B. Kennzeichen, Farbe" />
          <label>Gehört zu Fahrer</label>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} required disabled={drivers.length === 0}>
            <option value="">Bitte wählen</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label>Größe</label>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Bitte wählen</option>
            {CAR_SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <label>Antrieb</label>
          <select value={driveType} onChange={(e) => setDriveType(e.target.value)}>
            <option value="">Bitte wählen</option>
            {CAR_DRIVE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <label style={{ marginTop: 12 }}>Extras</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
            <input type="checkbox" checked={hasAc} onChange={(e) => setHasAc(e.target.checked)} style={{ width: 'auto' }} /> Klimaanlage
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
            <input type="checkbox" checked={hasSeatHeating} onChange={(e) => setHasSeatHeating(e.target.checked)} style={{ width: 'auto' }} /> Sitzheizung
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
            <input type="checkbox" checked={hasUsb} onChange={(e) => setHasUsb(e.target.checked)} style={{ width: 'auto' }} /> USB-Anschluss
          </label>
          <button style={{ marginTop: 12, width: '100%' }} disabled={drivers.length === 0}>Auto hinzufügen</button>
        </form>
      </div>
      {cars.length === 0 && <div className="empty-state">Noch keine Autos angelegt.</div>}
      {cars.map((c) => {
        const draft = drafts[c.id] || { size: '', drive_type: '', has_ac: false, has_seat_heating: false, has_usb: false }
        return (
          <div className="card" key={c.id}>
            <h3>{c.name}</h3>
            {c.notes && <div className="meta">{c.notes}</div>}
            <label style={{ marginTop: 8 }}>Fahrer</label>
            <select value={c.driver_id || ''} onChange={(e) => reassignDriver(c, e.target.value)}>
              <option value="">Kein Fahrer zugeordnet</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <label>Größe</label>
            <select value={draft.size} onChange={(e) => updateDraft(c.id, 'size', e.target.value)}>
              <option value="">Keine Angabe</option>
              {CAR_SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <label>Antrieb</label>
            <select value={draft.drive_type} onChange={(e) => updateDraft(c.id, 'drive_type', e.target.value)}>
              <option value="">Keine Angabe</option>
              {CAR_DRIVE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <label style={{ marginTop: 12 }}>Extras</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
              <input type="checkbox" checked={draft.has_ac} onChange={(e) => updateDraft(c.id, 'has_ac', e.target.checked)} style={{ width: 'auto' }} /> Klimaanlage
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
              <input type="checkbox" checked={draft.has_seat_heating} onChange={(e) => updateDraft(c.id, 'has_seat_heating', e.target.checked)} style={{ width: 'auto' }} /> Sitzheizung
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 6 }}>
              <input type="checkbox" checked={draft.has_usb} onChange={(e) => updateDraft(c.id, 'has_usb', e.target.checked)} style={{ width: 'auto' }} /> USB-Anschluss
            </label>
            <button className="secondary" style={{ marginTop: 10, width: '100%' }} onClick={() => saveDetails(c)}>
              {savedId === c.id ? '✓ Gespeichert' : 'Details speichern'}
            </button>
            <button className="danger" style={{ marginTop: 10 }} onClick={() => deleteCar(c.id)}>Löschen</button>
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
function TripsTab() {
  const [routes, setRoutes] = useState([])
  const [cars, setCars] = useState([])
  const [drivers, setDrivers] = useState([])
  const [trips, setTrips] = useState([])
  const [routeId, setRouteId] = useState('')
  const [carId, setCarId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [seats, setSeats] = useState(3)
  const [openTripBookings, setOpenTripBookings] = useState(null)
  const [bookings, setBookings] = useState([])
  const [calcStatus, setCalcStatus] = useState(null)

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('routes').select('*').order('name')
    setRoutes(r || [])
    const { data: c } = await supabase.from('cars').select('*').order('name')
    setCars(c || [])
    const { data: dr } = await supabase.from('drivers').select('*').order('name')
    setDrivers(dr || [])
    const { data: t } = await supabase
      .from('trips')
      .select('*, routes(name), cars(name), drivers(name)')
      .order('trip_date', { ascending: true })
    setTrips(t || [])
  }, [])

  useEffect(() => { load() }, [load])

  // Prüft vor dem Veröffentlichen, ob für die gewählte Strecke bereits
  // Entfernungen berechnet wurden — falls nicht, wird das automatisch
  // nachgeholt. Schlägt das fehl (z.B. Adresse nicht auffindbar), wird die
  // Fahrt trotzdem veröffentlicht, nur eben ohne Entfernungen.
  async function ensureRouteDistances(routeIdToCheck, driverIdForRate) {
    const { data: stops } = await supabase
      .from('route_stops')
      .select('*')
      .eq('route_id', routeIdToCheck)
      .order('order_index')
    if (!stops || stops.length < 2) return
    const needsCalc = stops.some((s, i) =>
      s.latitude == null || s.longitude == null || (i < stops.length - 1 && !s.distance_to_next_km)
    )
    if (!needsCalc) return

    setCalcStatus('Entfernungen für die gewählte Strecke werden berechnet …')
    try {
      const coords = []
      for (const s of stops) {
        const address = [s.street, s.house_number, s.postal_code, s.name, s.country].filter(Boolean).join(', ')
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address || s.name)}`)
        const json = await res.json()
        if (!json || json.length === 0) return
        coords.push({ lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) })
        await new Promise((r) => setTimeout(r, 1000))
      }

      const coordsStr = coords.map((c) => `${c.lon},${c.lat}`).join(';')
      const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=false`)
      const osrmData = await osrmRes.json()
      if (!osrmData?.routes?.length) return
      const legs = osrmData.routes[0].legs

      const { data: driverRow } = driverIdForRate
        ? await supabase.from('drivers').select('rate_eur_per_100km').eq('id', driverIdForRate).single()
        : { data: null }
      const rate = driverRow?.rate_eur_per_100km ?? null

      let totalDistance = 0
      for (let i = 0; i < stops.length; i++) {
        const patch = { latitude: coords[i].lat, longitude: coords[i].lon }
        if (i < legs.length) {
          const distanceKm = Math.round((legs[i].distance / 1000) * 10) / 10
          patch.distance_to_next_km = distanceKm
          patch.duration_to_next_min = Math.round(legs[i].duration / 60)
          totalDistance += distanceKm
          if (rate != null && !stops[i].price_to_next) {
            patch.price_to_next = Math.round((rate * distanceKm) / 100)
          }
        }
        await supabase.from('route_stops').update(patch).eq('id', stops[i].id)
      }

      if (rate != null) {
        const { data: routeRow } = await supabase.from('routes').select('total_price').eq('id', routeIdToCheck).single()
        if (!routeRow?.total_price) {
          const newTotal = Math.round((rate * totalDistance) / 100)
          await supabase.from('routes').update({ total_price: newTotal }).eq('id', routeIdToCheck)
        }
      }
    } catch {
      // Adressdienst nicht erreichbar o.ä. — Fahrt wird trotzdem veröffentlicht.
    } finally {
      setCalcStatus(null)
    }
  }

  async function publishTrip(e) {
    e.preventDefault()
    if (!routeId || !carId || !driverId || !date || !time || !seats) return
    const tripDate = date
    const tripTime = time
    await ensureRouteDistances(routeId, driverId)
    const { data: inserted, error } = await supabase.from('trips').insert({
      route_id: routeId,
      car_id: carId,
      driver_id: driverId,
      trip_date: tripDate,
      start_time: tripTime,
      total_seats: Number(seats),
    }).select('id').single()
    setDate(''); setTime(''); setSeats(3)
    load()

    if (!error && inserted) {
      notifyMatchingSearchAlerts(routeId, tripDate, tripTime)
    }
  }

  async function notifyMatchingSearchAlerts(routeIdForTrip, tripDate, tripTime) {
    const [{ data: stops }, { data: alerts }] = await Promise.all([
      supabase.from('route_stops').select('order_index, latitude, longitude').eq('route_id', routeIdForTrip),
      supabase.from('search_alerts').select('*, people(name, email, revoked)'),
    ])
    const routeName = routes.find((r) => r.id === routeIdForTrip)?.name || 'eine Strecke'
    const validStops = (stops || []).filter((s) => s.latitude != null && s.longitude != null)

    for (const alert of alerts || []) {
      const person = alert.people
      if (!person || person.revoked || !person.email) continue
      const startMatch = validStops.find(
        (s) => haversineKm(alert.start_lat, alert.start_lon, s.latitude, s.longitude) <= alert.radius_km
      )
      if (!startMatch) continue
      const destMatch = validStops.find(
        (s) =>
          s.order_index > startMatch.order_index &&
          haversineKm(alert.dest_lat, alert.dest_lon, s.latitude, s.longitude) <= alert.radius_km
      )
      if (!destMatch) continue

      sendEmailNotification(
        person.email,
        `Neue Fahrt in deiner Umgebung: ${routeName}`,
        [
          `Hallo ${person.name || ''}!`.replace('Hallo !', 'Hallo!'),
          `Es wurde soeben eine neue Fahrt veröffentlicht, die zu deiner gespeicherten Suche passt:`,
          `${routeName} am ${formatDate(tripDate)} (${tripTime} Uhr)`,
          `Schau in der App vorbei, um einen Platz zu buchen!`,
        ].join('\n')
      )
    }
  }

  const carsForSelectedDriver = driverId ? cars.filter((c) => c.driver_id === driverId) : []

  async function deleteTrip(id) {
    if (!confirm('Fahrt inkl. aller Buchungen löschen?')) return
    await supabase.from('trips').delete().eq('id', id)
    load()
  }

  async function toggleClosed(t) {
    await supabase.from('trips').update({ closed: !t.closed }).eq('id', t.id)
    load()
  }

  async function showBookings(trip) {
    setOpenTripBookings(trip)
    const { data } = await supabase
      .from('bookings')
      .select('*, people(name), route_stops!bookings_from_stop_id_fkey(name), to_stop:route_stops!bookings_to_stop_id_fkey(name)')
      .eq('trip_id', trip.id)
      .eq('cancelled', false)
    setBookings(data || [])
  }

  if (openTripBookings) {
    return (
      <div className="card">
        <button className="secondary" style={{ marginBottom: 12 }} onClick={() => setOpenTripBookings(null)}>← Zurück</button>
        <h3>{openTripBookings.routes?.name}</h3>
        <div className="meta">
          {formatDate(openTripBookings.trip_date)} · {openTripBookings.start_time?.slice(0,5)} Uhr
          {openTripBookings.cars?.name ? ` · ${openTripBookings.cars.name}` : ''}
          {openTripBookings.drivers?.name ? ` · Fahrer: ${openTripBookings.drivers.name}` : ''}
        </div>
        {bookings.length === 0 && <div className="empty-state">Noch keine Buchungen.</div>}
        {bookings.map((b) => (
          <div key={b.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
            <strong>{b.people?.name}</strong> — {b.route_stops?.name} → {b.to_stop?.name} ({b.seats} Platz/Plätze) · EUR {b.price}
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="card">
        <h3>Fahrt veröffentlichen</h3>
        {(cars.length === 0 || drivers.length === 0) && (
          <div className="notice error">
            Bitte zuerst {cars.length === 0 ? 'im Tab „Autos" mindestens ein Auto' : ''}
            {cars.length === 0 && drivers.length === 0 ? ' und ' : ''}
            {drivers.length === 0 ? 'im Tab „Fahrer" mindestens einen Fahrer' : ''} anlegen.
          </div>
        )}
        <form onSubmit={publishTrip}>
          <label>Strecke</label>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)} required>
            <option value="">Bitte wählen</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label>Fahrer</label>
          <select value={driverId} onChange={(e) => { setDriverId(e.target.value); setCarId('') }} required disabled={drivers.length === 0}>
            <option value="">Bitte wählen</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label>Auto {driverId && carsForSelectedDriver.length === 0 && '(dieser Fahrer hat noch kein Auto hinterlegt)'}</label>
          <select value={carId} onChange={(e) => setCarId(e.target.value)} required disabled={!driverId || carsForSelectedDriver.length === 0}>
            <option value="">{driverId ? 'Bitte wählen' : 'Zuerst Fahrer wählen'}</option>
            {carsForSelectedDriver.map((c) => <option key={c.id} value={c.id}>{c.name}{c.notes ? ` (${c.notes})` : ''}</option>)}
          </select>
          <div className="row">
            <div>
              <label>Datum</label>
              <input type="date" value={date} min={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label>Startzeit</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>
          <label>Freie Plätze</label>
          <input type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} required />
          {calcStatus && <div className="meta" style={{ marginTop: 8 }}>📍 {calcStatus}</div>}
          <button style={{ marginTop: 12, width: '100%' }} disabled={!!calcStatus || cars.length === 0 || drivers.length === 0}>
            {calcStatus ? 'Berechne Entfernungen …' : 'Veröffentlichen'}
          </button>
        </form>
      </div>

      {trips.map((t) => (
        <div className="card" key={t.id}>
          <h3>{t.routes?.name} {t.closed && <span className="badge full">geschlossen</span>}</h3>
          <div className="meta">
            {formatDate(t.trip_date)} · {t.start_time?.slice(0,5)} Uhr · {t.total_seats} Plätze
            {t.cars?.name ? ` · ${t.cars.name}` : ''}
          </div>
          <div className="meta">Fahrer: {t.drivers?.name || '—'}</div>
          <div className="row">
            <button onClick={() => showBookings(t)}>Buchungen ansehen</button>
            <button className="secondary" onClick={() => toggleClosed(t)}>{t.closed ? 'Buchungen wieder zulassen' : 'Neue Buchungen blockieren'}</button>
            <button className="danger" onClick={() => deleteTrip(t.id)}>Löschen</button>
          </div>
        </div>
      ))}
    </>
  )
}
