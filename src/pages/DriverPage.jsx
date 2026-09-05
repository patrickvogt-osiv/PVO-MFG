import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { getEuroExchangeRate, formatConverted } from '../lib/currency'
import Logo from '../components/Logo'

const TOKEN_STORAGE_KEY = 'fahrt-buchung:driver-token'

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Offizieller Buy-Me-a-Coffee-Button (öffentlich zum Einbetten gedacht),
// immer im Original angezeigt. Darunter ein Statustext mit Icon, je nachdem
// ob das Abo aktiv ist. Klick führt immer zum Projekt-Link (falls
// hinterlegt), sonst zu den Einstellungen.
function BuyMeACoffeeBadge({ active, projectLink, onGoToSettings }) {
  const img = (
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" />
  )
  const button = projectLink ? (
    <a href={projectLink} target="_blank" rel="noreferrer" className="bmc-badge" title="Buy Me a Coffee">
      {img}
    </a>
  ) : (
    <button
      type="button"
      className="bmc-badge"
      onClick={onGoToSettings}
      title="Buy Me a Coffee — noch kein Projekt-Link hinterlegt"
    >
      {img}
    </button>
  )
  return (
    <div className="bmc-badge-wrapper">
      {button}
      <div className="bmc-status">
        {active ? (
          <>✅ Danke - Abo ist aktiv!</>
        ) : (
          <>❌ Kein Abo aktiv!</>
        )}
      </div>
    </div>
  )
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

// Wandelt eine führende "00"-Vorwahl automatisch in "+" um (00 und + sind
// gleichbedeutend als internationales Vorwahl-Präfix).
// Baut einen wa.me-Link aus einer Telefonnummer (internationales Format
// erforderlich, z.B. "+41 79 123 45 67").
function whatsappLink(phone) {
  if (!phone) return null
  let digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  if (!digits) return null
  return `https://wa.me/${digits}`
}

function normalizePhoneInput(value) {
  if (value.startsWith('00')) return '+' + value.slice(2)
  return value
}

function formatTime(timeStr) {
  return timeStr?.slice(0, 5)
}

const PERSON_RATING_CATEGORIES = [
  { key: 'punctuality', label: 'Pünktlichkeit am Startpunkt' },
  { key: 'cleanliness', label: 'Sauberkeit' },
  { key: 'communication', label: 'Kommunikation' },
]

function StarInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 22, lineHeight: 1, cursor: 'pointer', color: n <= value ? '#f0a500' : '#d8dbe0' }}
        >★</button>
      ))}
    </div>
  )
}

function emptyAddress() {
  return { name: '', postal_code: '', street: '', house_number: '', country: '', maps_link: '' }
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

// ---------------------------------------------------------------------------
// Eigene Autos eines Fahrers: anlegen, bearbeiten, löschen.
const CAR_SIZE_OPTIONS = ['Klein', 'Kompakt', 'Mittelklasse', 'Oberklasse']
const CAR_DRIVE_OPTIONS = ['Elektro', 'Verbrenner']

function DriverCarsManager({ token, onCarsChanged }) {
  const [ownCars, setOwnCars] = useState([])
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [size, setSize] = useState('')
  const [driveType, setDriveType] = useState('')
  const [hasAc, setHasAc] = useState(false)
  const [hasSeatHeating, setHasSeatHeating] = useState(false)
  const [hasUsb, setHasUsb] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savedId, setSavedId] = useState(null)

  const loadOwnCars = useCallback(async () => {
    const { data } = await supabase.rpc('fn_driver_list_own_cars', { p_token: token })
    const cars = data?.cars || []
    setOwnCars(cars)
    const nextDrafts = {}
    for (const c of cars) {
      nextDrafts[c.id] = {
        name: c.name, notes: c.notes || '', size: c.size || '', drive_type: c.drive_type || '',
        has_ac: c.has_ac || false, has_seat_heating: c.has_seat_heating || false, has_usb: c.has_usb || false,
      }
    }
    setDrafts(nextDrafts)
  }, [token])

  useEffect(() => { loadOwnCars() }, [loadOwnCars])

  async function createCar(e) {
    e.preventDefault()
    setCreateError(null)
    if (!name.trim()) return
    const { data, error: err } = await supabase.rpc('fn_driver_create_car', {
      p_token: token, p_name: name.trim(), p_notes: notes.trim(),
      p_size: size, p_drive_type: driveType, p_has_ac: hasAc, p_has_seat_heating: hasSeatHeating, p_has_usb: hasUsb,
    })
    if (err || data?.error) { setCreateError('Auto konnte nicht angelegt werden.'); return }
    setName(''); setNotes(''); setSize(''); setDriveType(''); setHasAc(false); setHasSeatHeating(false); setHasUsb(false)
    loadOwnCars()
    onCarsChanged?.()
  }

  async function saveCar(c) {
    const draft = drafts[c.id]
    const { error: err } = await supabase.rpc('fn_driver_update_car', {
      p_token: token, p_car_id: c.id, p_name: draft.name, p_notes: draft.notes,
      p_size: draft.size, p_drive_type: draft.drive_type,
      p_has_ac: draft.has_ac, p_has_seat_heating: draft.has_seat_heating, p_has_usb: draft.has_usb,
    })
    if (err) { alert('Auto konnte nicht gespeichert werden.'); return }
    setSavedId(c.id)
    setTimeout(() => setSavedId(null), 1500)
    loadOwnCars()
    onCarsChanged?.()
  }

  async function deleteCar(id) {
    if (!confirm('Auto löschen? (Fahrten, die dieses Auto nutzen, bleiben erhalten, aber ohne Autozuordnung.)')) return
    await supabase.rpc('fn_driver_delete_car', { p_token: token, p_car_id: id })
    loadOwnCars()
    onCarsChanged?.()
  }

  function updateDraft(carId, field, value) {
    setDrafts((prev) => ({ ...prev, [carId]: { ...prev[carId], [field]: value } }))
  }

  return (
    <div style={{ marginTop: 12 }}>
      <h3>Neues Auto</h3>
      <form onSubmit={createCar}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. VW Passat (blau)" required />
        <label>Notiz (optional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="z.B. Kennzeichen, Farbe" />
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
        {createError && <div className="notice error" style={{ marginTop: 12 }}>{createError}</div>}
        <button style={{ marginTop: 12, width: '100%' }}>Auto hinzufügen</button>
      </form>

      <h3 style={{ marginTop: 20 }}>Meine Autos</h3>
      {ownCars.length === 0 && <div className="empty-state">Noch keine eigenen Autos angelegt.</div>}
      {ownCars.map((c) => {
        const draft = drafts[c.id] || { name: c.name, notes: c.notes || '', size: '', drive_type: '', has_ac: false, has_seat_heating: false, has_usb: false }
        return (
          <div className="card" key={c.id}>
            <label>Name</label>
            <input value={draft.name} onChange={(e) => updateDraft(c.id, 'name', e.target.value)} />
            <label>Notiz</label>
            <input value={draft.notes} onChange={(e) => updateDraft(c.id, 'notes', e.target.value)} />
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
            <div className="row" style={{ marginTop: 10 }}>
              <button className="secondary" onClick={() => saveCar(c)}>{savedId === c.id ? '✓ Gespeichert' : 'Speichern'}</button>
              <button className="danger" onClick={() => deleteCar(c.id)}>Löschen</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Eigene Strecken eines Fahrers: anlegen, Zwischenstopps verwalten,
// Reihenfolge ändern, Entfernungen berechnen — analog zum Admin-Bereich,
// aber beschränkt auf die vom Fahrer selbst angelegten Strecken.
function DriverRoutesManager({ token, onRoutesChanged, driverRate }) {
  const [ownRoutes, setOwnRoutes] = useState([])
  const [routeName, setRouteName] = useState('')
  const [totalPrice, setTotalPrice] = useState('')
  const [startAddr, setStartAddr] = useState(emptyAddress())
  const [endAddr, setEndAddr] = useState(emptyAddress())
  const [createError, setCreateError] = useState(null)

  const [openRoute, setOpenRoute] = useState(null)
  const [routeNameDraft, setRouteNameDraft] = useState('')
  const [totalPriceDraft, setTotalPriceDraft] = useState('')
  const [stops, setStops] = useState([])
  const [newStop, setNewStop] = useState(emptyAddress())
  const [priceToNext, setPriceToNext] = useState('')
  const [saveError, setSaveError] = useState(null)
  const [distanceError, setDistanceError] = useState(null)
  const [calculatingDistances, setCalculatingDistances] = useState(false)

  const loadOwnRoutes = useCallback(async () => {
    const { data } = await supabase.rpc('fn_driver_list_own_routes', { p_token: token })
    setOwnRoutes(data?.routes || [])
  }, [token])

  useEffect(() => { loadOwnRoutes() }, [loadOwnRoutes])

  async function createRoute(e) {
    e.preventDefault()
    setCreateError(null)
    if (!routeName.trim() || !startAddr.name.trim() || !endAddr.name.trim()) return
    const { data, error: err } = await supabase.rpc('fn_driver_create_route', {
      p_token: token,
      p_name: routeName.trim(),
      p_total_price: Math.max(0, Math.round(Number(totalPrice) || 0)),
      p_start: startAddr,
      p_end: endAddr,
    })
    if (err || data?.error) { setCreateError('Strecke konnte nicht angelegt werden.'); return }
    setRouteName(''); setTotalPrice(''); setStartAddr(emptyAddress()); setEndAddr(emptyAddress())
    loadOwnRoutes()
    onRoutesChanged?.()
  }

  async function deleteRoute(id) {
    if (!confirm('Strecke inkl. aller Zwischenstopps löschen?')) return
    await supabase.rpc('fn_driver_delete_route', { p_token: token, p_route_id: id })
    if (openRoute?.id === id) setOpenRoute(null)
    loadOwnRoutes()
    onRoutesChanged?.()
  }

  async function openRouteDetail(route) {
    setSaveError(null)
    const { data, error: err } = await supabase.rpc('fn_driver_get_route_detail', { p_token: token, p_route_id: route.id })
    if (err || data?.error) { setSaveError('Strecke konnte nicht geladen werden.'); return }
    setOpenRoute(data.route)
    setRouteNameDraft(data.route.name)
    setTotalPriceDraft(String(data.route.total_price ?? 0))
    setStops(data.stops)
  }

  const [creatingReverse, setCreatingReverse] = useState(false)

  async function createReverseRoute() {
    if (stops.length < 2) return
    setCreatingReverse(true)
    const { data, error: err } = await supabase.rpc('fn_driver_create_reverse_route', {
      p_token: token, p_route_id: openRoute.id,
    })
    setCreatingReverse(false)
    if (err || data?.error) {
      alert('Rückfahrstrecke konnte nicht angelegt werden.')
      return
    }
    onRoutesChanged?.()
    alert('Rückfahrstrecke wurde angelegt — zu finden in "Meine Strecken".')
    setOpenRoute(null)
    loadOwnRoutes()
  }

  async function saveRouteMeta() {
    setSaveError(null)
    const { error: err } = await supabase.rpc('fn_driver_update_route_meta', {
      p_token: token,
      p_route_id: openRoute.id,
      p_name: routeNameDraft.trim(),
      p_total_price: Math.max(0, Math.round(Number(totalPriceDraft) || 0)),
    })
    if (err) { setSaveError('Konnte nicht gespeichert werden.'); return }
    setOpenRoute({ ...openRoute, name: routeNameDraft.trim(), total_price: Math.max(0, Math.round(Number(totalPriceDraft) || 0)) })
    loadOwnRoutes()
  }

  async function updateStopField(stop, field, value) {
    setSaveError(null)
    const merged = { ...stop, [field]: value }
    const { error: err } = await supabase.rpc('fn_driver_update_stop', {
      p_token: token,
      p_stop_id: stop.id,
      p_name: merged.name,
      p_postal_code: merged.postal_code,
      p_street: merged.street,
      p_house_number: merged.house_number,
      p_country: merged.country,
      p_maps_link: merged.maps_link,
    })
    if (err) { setSaveError('Feld konnte nicht gespeichert werden.'); return }
    openRouteDetail(openRoute)
  }

  async function updatePrice(stop, value) {
    const v = Math.max(0, Math.round(Number(value) || 0))
    setSaveError(null)
    const { error: err } = await supabase.rpc('fn_driver_update_stop_price', { p_token: token, p_stop_id: stop.id, p_price_to_next: v })
    if (err) { setSaveError('Preis konnte nicht gespeichert werden.'); return }
    openRouteDetail(openRoute)
  }

  async function addStop(e) {
    e.preventDefault()
    if (!newStop.name.trim()) return
    if (stops.length < 2) { setSaveError('Bitte zuerst Start- und Zielpunkt anlegen.'); return }
    setSaveError(null)
    const { error: err } = await supabase.rpc('fn_driver_add_stop', {
      p_token: token,
      p_route_id: openRoute.id,
      p_name: newStop.name.trim(),
      p_postal_code: newStop.postal_code,
      p_street: newStop.street,
      p_house_number: newStop.house_number,
      p_country: newStop.country,
      p_maps_link: newStop.maps_link,
      p_price_to_prev: Math.max(0, Math.round(Number(priceToNext) || 0)),
    })
    if (err) { setSaveError('Zwischenstopp konnte nicht angelegt werden.'); return }
    setNewStop(emptyAddress())
    setPriceToNext('')
    openRouteDetail(openRoute)
  }

  async function removeStop(stop) {
    if (!confirm(`„${stop.name}" wirklich entfernen?`)) return
    setSaveError(null)
    const { data, error: err } = await supabase.rpc('fn_driver_remove_stop', { p_token: token, p_stop_id: stop.id })
    if (err || data?.error) {
      if (data?.error === 'stop_in_use') {
        setSaveError(`„${stop.name}" kann nicht gelöscht werden, da bereits mindestens eine Buchung diesen Ein-/Ausstiegspunkt nutzt. Storniere zuerst die betreffenden Buchungen.`)
      } else {
        setSaveError('Zwischenstopp konnte nicht gelöscht werden.')
      }
      return
    }
    openRouteDetail(openRoute)
  }

  async function moveStop(index, direction) {
    if (index < 1 || index > stops.length - 2) return
    setSaveError(null)
    const { error: err } = await supabase.rpc('fn_driver_move_stop', {
      p_token: token, p_route_id: openRoute.id, p_stop_id: stops[index].id, p_direction: direction,
    })
    if (err) { setSaveError('Reihenfolge konnte nicht geändert werden.'); return }
    setSaveError('Reihenfolge geändert — bitte die Mitfahrbeiträge (und ggf. Entfernungen neu berechnen) der betroffenen Abschnitte prüfen.')
    openRouteDetail(openRoute)
  }

  async function calculateDistances() {
    if (stops.length < 2) return
    setDistanceError(null)
    setCalculatingDistances(true)
    try {
      const coords = []
      for (const s of stops) {
        const query = [s.street, s.house_number, s.postal_code, s.name, s.country].filter(Boolean).join(' ')
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`)
        if (!res.ok) throw new Error('Geocoding-Dienst nicht erreichbar.')
        const data = await res.json()
        if (!data || data.length === 0) throw new Error(`Konnte „${s.name}" nicht auf der Karte finden. Bitte Adresse präzisieren.`)
        coords.push({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) })
        await new Promise((r) => setTimeout(r, 1100))
      }
      const coordStr = coords.map((c) => `${c.lon},${c.lat}`).join(';')
      const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false`)
      if (!osrmRes.ok) throw new Error('Routing-Dienst nicht erreichbar.')
      const osrmData = await osrmRes.json()
      if (osrmData.code !== 'Ok' || !osrmData.routes?.[0]) throw new Error('Route konnte nicht berechnet werden.')
      const legs = osrmData.routes[0].legs
      let totalDistance = 0
      for (let i = 0; i < stops.length; i++) {
        const distanceKm = i < legs.length ? Math.round((legs[i].distance / 1000) * 10) / 10 : null
        const durationMin = i < legs.length ? Math.round(legs[i].duration / 60) : null
        if (distanceKm != null) totalDistance += distanceKm
        await supabase.rpc('fn_driver_update_stop_distance', {
          p_token: token, p_stop_id: stops[i].id, p_distance_km: distanceKm, p_duration_min: durationMin,
          p_latitude: coords[i].lat, p_longitude: coords[i].lon,
        })
        if (distanceKm != null && driverRate != null && !stops[i].price_to_next) {
          const autoPrice = Math.round((driverRate * distanceKm) / 100)
          await supabase.rpc('fn_driver_update_stop_price', { p_token: token, p_stop_id: stops[i].id, p_price_to_next: autoPrice })
        }
      }

      if (driverRate != null && !openRoute.total_price) {
        const newTotal = Math.round((driverRate * totalDistance) / 100)
        await supabase.rpc('fn_driver_update_route_meta', {
          p_token: token, p_route_id: openRoute.id, p_name: openRoute.name, p_total_price: newTotal,
        })
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
      <div style={{ marginTop: 12 }}>
        <button className="secondary" style={{ marginBottom: 12 }} onClick={() => { setOpenRoute(null); loadOwnRoutes() }}>← Zurück zu meinen Strecken</button>
        <button
          className="secondary"
          style={{ marginBottom: 12, marginLeft: 8 }}
          disabled={creatingReverse || stops.length < 2}
          onClick={createReverseRoute}
        >
          {creatingReverse ? 'Wird angelegt …' : '🔄 Rückfahrstrecke anlegen'}
        </button>

        <label>Streckenname</label>
        <input value={routeNameDraft} onChange={(e) => setRouteNameDraft(e.target.value)} onBlur={saveRouteMeta} />

        <label>Gesamtbetrag für die ganze Strecke (EUR)</label>
        <input type="number" min="0" step="1" value={totalPriceDraft} onChange={(e) => setTotalPriceDraft(e.target.value)} onBlur={saveRouteMeta} />

        {saveError && <div className="notice error" style={{ marginTop: 12 }}>{saveError}</div>}
        {distanceError && <div className="notice error" style={{ marginTop: 12 }}>{distanceError}</div>}

        <button className="secondary" style={{ width: '100%', margin: '12px 0 4px' }} onClick={calculateDistances} disabled={calculatingDistances || stops.length < 2}>
          {calculatingDistances ? 'Berechne Entfernungen …' : '📍 Entfernungen & Fahrzeiten berechnen'}
        </button>
        <div className="meta" style={{ marginBottom: 12 }}>Kostenlos über OpenStreetMap, basierend auf den hinterlegten Adressen.</div>

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
                    <button className="secondary" style={{ padding: '4px 8px', fontSize: 12, flex: 'none', marginLeft: 'auto' }} disabled={i === 1} onClick={() => moveStop(i, -1)}>↑</button>
                    <button className="secondary" style={{ padding: '4px 8px', fontSize: 12, flex: 'none' }} disabled={i === stops.length - 2} onClick={() => moveStop(i, 1)}>↓</button>
                    <button className="danger" style={{ padding: '4px 8px', fontSize: 12, flex: 'none' }} onClick={() => removeStop(s)}>✕</button>
                  </>
                )}
              </div>

              {i > 0 && stops.length > 2 && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ margin: '0 0 2px' }}>Mitfahrbeitrag bis „{s.name}" (EUR)</label>
                  <input type="number" min="0" step="1" defaultValue={stops[i - 1].price_to_next} onBlur={(e) => updatePrice(stops[i - 1], e.target.value)} />
                  {stops[i - 1].distance_to_next_km != null && (
                    <div className="meta" style={{ marginTop: 4 }}>≈ {stops[i - 1].distance_to_next_km} km · {stops[i - 1].duration_to_next_min} Min</div>
                  )}
                </div>
              )}

              <label style={{ marginTop: 12 }}>Adresse</label>
              <AddressAutoFill onParsed={(parsed) => setStops(stops.map((x) => (x.id === s.id ? { ...x, ...parsed } : x)))} />
              <div className="row">
                <div style={{ flex: 2 }}>
                  <label style={{ marginTop: 0 }}>Straße</label>
                  <input value={s.street || ''} onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, street: e.target.value } : x)))} />
                </div>
                <div>
                  <label style={{ marginTop: 0 }}>Hausnr.</label>
                  <input value={s.house_number || ''} onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, house_number: e.target.value } : x)))} />
                </div>
              </div>
              <div className="row">
                <div>
                  <label style={{ marginTop: 0 }}>PLZ</label>
                  <input value={s.postal_code || ''} onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, postal_code: e.target.value } : x)))} />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ marginTop: 0 }}>Ort</label>
                  <input value={s.name || ''} onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} required />
                </div>
              </div>
              <label>Land</label>
              <input value={s.country || ''} onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, country: e.target.value } : x)))} />
              <label>Google-Maps-Link</label>
              <div className="row">
                <input value={s.maps_link || ''} onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, maps_link: e.target.value } : x)))} />
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
    <div style={{ marginTop: 12 }}>
      <h3>Neue Strecke</h3>
      <form onSubmit={createRoute}>
        <label>Name der Strecke</label>
        <input value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="z.B. München - Basel" required />
        <label>Gesamtbetrag für die ganze Strecke (EUR)</label>
        <input type="number" min="0" step="1" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="0" />
        <h3 style={{ marginTop: 16 }}>Startpunkt</h3>
        <AddressFields value={startAddr} onChange={setStartAddr} />
        <h3 style={{ marginTop: 16 }}>Zielpunkt</h3>
        <AddressFields value={endAddr} onChange={setEndAddr} />
        {createError && <div className="notice error" style={{ marginTop: 12 }}>{createError}</div>}
        <button style={{ marginTop: 14, width: '100%' }}>Strecke anlegen</button>
      </form>

      <h3 style={{ marginTop: 20 }}>Meine Strecken</h3>
      {ownRoutes.length === 0 && <div className="empty-state">Noch keine eigenen Strecken angelegt.</div>}
      {ownRoutes.map((r) => (
        <div className="card" key={r.id}>
          <h3>{r.name}</h3>
          <div className="meta">Gesamtbetrag: EUR {r.total_price ?? 0}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => openRouteDetail(r)}>Streckenpunkte & Beiträge</button>
            <button className="danger" onClick={() => deleteRoute(r.id)}>Löschen</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DriverPage() {
  const { token: tokenFromUrl } = useParams()
  const token = tokenFromUrl || localStorage.getItem(TOKEN_STORAGE_KEY)

  const [driver, setDriver] = useState(null)
  const [trips, setTrips] = useState([])
  const [routes, setRoutes] = useState([])
  const [cars, setCars] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [routeId, setRouteId] = useState('')
  const [carId, setCarId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [seats, setSeats] = useState(3)
  const [publishMsg, setPublishMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [calcStatus, setCalcStatus] = useState(null)
  const [copyTemplate, setCopyTemplate] = useState(null)

  const [openTripBookings, setOpenTripBookings] = useState(null)
  const [tripBookings, setTripBookings] = useState([])
  const [personRatingDrafts, setPersonRatingDrafts] = useState({})
  const [personRatingBusyId, setPersonRatingBusyId] = useState(null)
  const [personRatingSavedId, setPersonRatingSavedId] = useState(null)

  useEffect(() => {
    setPersonRatingDrafts((prev) => {
      const next = { ...prev }
      for (const b of tripBookings) {
        if (!next[b.id]) {
          next[b.id] = {
            punctuality: b.rating_punctuality || 0,
            cleanliness: b.rating_cleanliness || 0,
            communication: b.rating_communication || 0,
          }
        }
      }
      return next
    })
  }, [tripBookings])

  function personRatingDraftFor(b) {
    return personRatingDrafts[b.id] || { punctuality: 0, cleanliness: 0, communication: 0 }
  }

  function updatePersonRatingDraft(bookingId, key, value) {
    setPersonRatingDrafts((prev) => ({ ...prev, [bookingId]: { ...prev[bookingId], [key]: value } }))
  }

  async function submitPersonRating(b) {
    const draft = personRatingDraftFor(b)
    if (!draft.punctuality || !draft.cleanliness || !draft.communication) {
      alert('Bitte alle drei Kategorien mit 1-5 Sternen bewerten.')
      return
    }
    setPersonRatingBusyId(b.id)
    const { data, error: err } = await supabase.rpc('fn_driver_submit_person_rating', {
      p_token: token,
      p_booking_id: b.id,
      p_punctuality: draft.punctuality,
      p_cleanliness: draft.cleanliness,
      p_communication: draft.communication,
    })
    setPersonRatingBusyId(null)
    if (err || data?.error) {
      alert('Bewertung konnte nicht gespeichert werden.')
      return
    }
    setPersonRatingSavedId(b.id)
    setTimeout(() => setPersonRatingSavedId(null), 1500)
    showBookings(openTripBookings)
  }

  const [tab, setTab] = useState('trips') // 'trips' | 'routes' | 'cars' | 'settings'
  const [paymentInfo, setPaymentInfo] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [driverEmail, setDriverEmail] = useState('')
  const [referenceCurrency, setReferenceCurrency] = useState('')
  const [ratePer100km, setRatePer100km] = useState('')
  const [settingsMsg, setSettingsMsg] = useState(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [conversionRate, setConversionRate] = useState(null)

  useEffect(() => {
    if (tokenFromUrl) {
      localStorage.setItem(TOKEN_STORAGE_KEY, tokenFromUrl)
    }
  }, [tokenFromUrl])

  const loadAll = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)

    const [tripsRes, routesRes, carsRes] = await Promise.all([
      supabase.rpc('fn_driver_list_trips', { p_token: token }),
      supabase.rpc('fn_driver_list_routes', { p_token: token }),
      supabase.rpc('fn_driver_list_cars', { p_token: token }),
    ])
    setLoading(false)

    if (tripsRes.error) {
      setError('Verbindung fehlgeschlagen. Bitte später erneut versuchen.')
      return
    }
    if (tripsRes.data?.error === 'invalid_token') {
      setError('Dieser Einladungslink ist ungültig oder wurde widerrufen.')
      return
    }
    setDriver(tripsRes.data.driver)
    setTrips(tripsRes.data.trips)
    setRoutes(routesRes.data?.routes || [])
    setCars(carsRes.data?.cars || [])
    setPaymentInfo(tripsRes.data.driver?.payment_info || '')
    setDriverPhone(tripsRes.data.driver?.phone || '')
    setDriverEmail(tripsRes.data.driver?.email || '')
    setReferenceCurrency(tripsRes.data.driver?.reference_currency || '')
    setRatePer100km(tripsRes.data.driver?.rate_eur_per_100km ?? '')

    const map = {}
    for (const t of tripsRes.data.trips || []) map[t.id] = t.seats_booked
    bookedSeatsRef.current = map
  }, [token])

  // Fragt im Hintergrund alle 20 Sekunden nach neuen Buchungen, ohne die
  // Seite neu zu laden oder einen Ladezustand zu zeigen. Bei neuen Buchungen
  // erscheint ein In-App-Hinweis, plus eine Browser-Benachrichtigung, falls
  // dafür die Erlaubnis erteilt wurde.
  const bookedSeatsRef = useRef({})
  const [notifications, setNotifications] = useState([])

  const pollForNewBookings = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('fn_driver_list_trips', { p_token: token })
    if (!data || data.error) return
    const newTrips = data.trips || []
    const prev = bookedSeatsRef.current
    const fresh = []

    for (const t of newTrips) {
      const prevCount = prev[t.id]
      if (prevCount != null && t.seats_booked > prevCount) {
        const diff = t.seats_booked - prevCount
        const text = `🔔 Neue Buchung: ${diff} Platz/Plätze mehr bei „${t.route_name}" (${formatDate(t.trip_date)}).`
        fresh.push({ id: `${t.id}-${Date.now()}`, text })
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('pickaride — neue Buchung', {
            body: `${diff} Platz/Plätze mehr bei „${t.route_name}" am ${formatDate(t.trip_date)}.`,
          })
        }
      }
    }

    const nextMap = {}
    for (const t of newTrips) nextMap[t.id] = t.seats_booked
    bookedSeatsRef.current = nextMap
    setTrips(newTrips)

    if (fresh.length > 0) {
      setNotifications((old) => [...old, ...fresh])
      fresh.forEach((n) => {
        setTimeout(() => setNotifications((old) => old.filter((x) => x.id !== n.id)), 12000)
      })
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    const interval = setInterval(pollForNewBookings, 20000)
    return () => clearInterval(interval)
  }, [token, pollForNewBookings])

  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setNotificationPermission(result)
  }


  useEffect(() => {
    let cancelled = false
    if (!referenceCurrency) { setConversionRate(null); return }
    getEuroExchangeRate(referenceCurrency).then((rate) => { if (!cancelled) setConversionRate(rate) })
    return () => { cancelled = true }
  }, [referenceCurrency])

  async function saveSettings(e) {
    e.preventDefault()
    setSettingsBusy(true)
    setSettingsMsg(null)
    const { data, error: err } = await supabase.rpc('fn_driver_update_profile', {
      p_token: token,
      p_payment_info: paymentInfo,
      p_reference_currency: referenceCurrency,
      p_rate_eur_per_100km: ratePer100km === '' ? null : Number(ratePer100km),
      p_phone: driverPhone,
      p_email: driverEmail,
    })
    setSettingsBusy(false)
    if (err || data?.error) {
      setSettingsMsg({ type: 'error', text: 'Einstellungen konnten nicht gespeichert werden.' })
      return
    }
    setSettingsMsg({ type: 'success', text: 'Einstellungen gespeichert!' })
    loadAll()
  }

  async function toggleClosed(t) {
    await supabase.rpc('fn_driver_set_trip_closed', { p_token: token, p_trip_id: t.id, p_closed: !t.closed })
    loadAll()
  }

  const [seatsUpdatingId, setSeatsUpdatingId] = useState(null)

  async function updateTripSeats(t, newSeats) {
    if (newSeats < 1) return
    setSeatsUpdatingId(t.id)
    const { data, error: err } = await supabase.rpc('fn_driver_update_trip_seats', {
      p_token: token, p_trip_id: t.id, p_seats: newSeats,
    })
    setSeatsUpdatingId(null)
    if (err || data?.error) {
      if (data?.error === 'below_min_seats') {
        alert(`Weniger als ${data.min_seats} Plätze sind nicht möglich — so viele sind auf mindestens einem Streckenabschnitt bereits gebucht.`)
      } else {
        alert('Sitzplatzanzahl konnte nicht geändert werden.')
      }
      return
    }
    loadAll()
  }

  useEffect(() => { loadAll() }, [loadAll])

  // Prüft vor dem Veröffentlichen, ob für die gewählte Strecke bereits
  // Entfernungen berechnet wurden — falls nicht, wird das automatisch
  // nachgeholt (Geocoding + Routing), unabhängig davon, wem die Strecke
  // gehört. Schlägt das fehl (z.B. Adresse nicht auffindbar), wird die
  // Fahrt trotzdem veröffentlicht — nur eben ohne Entfernungen, wie bisher.
  async function ensureRouteDistances(routeIdToCheck) {
    const { data } = await supabase.rpc('fn_driver_get_route_stops_for_publish', {
      p_token: token, p_route_id: routeIdToCheck,
    })
    const stops = data?.stops || []
    if (stops.length < 2) return
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

      const rate = driver?.rate_eur_per_100km ?? null
      let totalDistance = 0
      const stopPatches = []
      for (let i = 0; i < stops.length; i++) {
        const patch = { id: stops[i].id, latitude: coords[i].lat, longitude: coords[i].lon }
        if (i < legs.length) {
          const distanceKm = Math.round((legs[i].distance / 1000) * 10) / 10
          patch.distance_to_next_km = distanceKm
          patch.duration_to_next_min = Math.round(legs[i].duration / 60)
          totalDistance += distanceKm
          if (rate != null && !stops[i].price_to_next) {
            patch.price_to_next = Math.round((rate * distanceKm) / 100)
          }
        }
        stopPatches.push(patch)
      }

      const newTotalPrice = rate != null && !data.total_price ? Math.round((rate * totalDistance) / 100) : null

      await supabase.rpc('fn_driver_save_computed_distances', {
        p_token: token,
        p_route_id: routeIdToCheck,
        p_stops: stopPatches,
        p_new_total_price: newTotalPrice,
      })
    } catch {
      // Adressdienst nicht erreichbar o.ä. — Fahrt wird trotzdem veröffentlicht.
    } finally {
      setCalcStatus(null)
    }
  }

  async function publishTrip(e) {
    e.preventDefault()
    if (!routeId || !carId || !date || !time || !seats) return
    setBusy(true)
    setPublishMsg(null)
    await ensureRouteDistances(routeId)
    const { data, error: err } = await supabase.rpc('fn_driver_create_trip', {
      p_token: token,
      p_route_id: routeId,
      p_car_id: carId,
      p_date: date,
      p_time: time,
      p_seats: Number(seats),
    })
    setBusy(false)
    if (err || data?.error) {
      const messages = {
        subscription_inactive: 'Fahrten veröffentlichen ist nur mit aktivem Buy-Me-a-Coffee-Abo möglich. Bitte Abo abschliessen.',
        no_payment_recorded: 'Für dein Abo ist noch kein Zahldatum hinterlegt. Bitte beim Admin melden.',
        trip_date_out_of_window: `Das Fahrtdatum liegt zu weit in der Zukunft. Mit der letzten Zahlung kannst du Fahrten bis einschliesslich ${data?.valid_until ? formatDate(data.valid_until) : '(unbekannt)'} veröffentlichen.`,
        car_not_owned: 'Dieses Auto gehört nicht zu deinem Konto.',
      }
      setPublishMsg({ type: 'error', text: messages[data?.error] || 'Fahrt konnte nicht veröffentlicht werden.' })
      return
    }
    setPublishMsg({ type: 'success', text: 'Fahrt veröffentlicht!' })

    const routeName = routes.find((r) => r.id === routeId)?.name || 'deine Strecke'
    const { data: matchData } = await supabase.rpc('fn_driver_find_matching_alerts', {
      p_token: token,
      p_trip_id: data.trip_id,
    })
    for (const m of matchData?.matches || []) {
      sendEmailNotification(
        m.email,
        `Neue Fahrt in deiner Umgebung: ${routeName}`,
        [
          `Hallo ${m.name || ''}!`.replace('Hallo !', 'Hallo!'),
          `Es wurde soeben eine neue Fahrt veröffentlicht, die zu deiner gespeicherten Suche passt:`,
          `${routeName} am ${formatDate(date)} (${time} Uhr)`,
          `Schau in der App vorbei, um einen Platz zu buchen!`,
        ].join('\n')
      )
    }

    setRouteId(''); setCarId(''); setDate(''); setTime(''); setSeats(3)
    setCopyTemplate(null)
    loadAll()
  }

  async function deleteTrip(id) {
    if (!confirm('Fahrt inkl. aller Buchungen löschen?')) return
    await supabase.rpc('fn_driver_delete_trip', { p_token: token, p_trip_id: id })
    loadAll()
  }

  // Befüllt das "Fahrt veröffentlichen"-Formular mit Strecke und Auto der
  // gewählten Fahrt (egal ob bevorstehend oder vergangen). Datum/Zeit bleiben
  // leer zum Eintragen, nur die Sitzplätze werden aus der Vorlage übernommen.
  function copyTrip(t) {
    setTab('trips')
    setRouteId(t.route_id)
    setCarId(t.car_id)
    setDate('')
    setTime('')
    setSeats(t.total_seats)
    setPublishMsg(null)
    setCopyTemplate(t)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function showBookings(trip) {
    setOpenTripBookings(trip)
    const { data } = await supabase.rpc('fn_driver_list_trip_bookings', { p_token: token, p_trip_id: trip.id })
    setTripBookings(data?.bookings || [])
  }

  if (!token) {
    return (
      <div className="container">
        <div className="notice error">Kein Einladungslink erkannt. Bitte nutze den Link, den du erhalten hast.</div>
      </div>
    )
  }

  if (loading) {
    return <div className="container empty-state">Lädt …</div>
  }

  if (error) {
    return (
      <div className="container">
        <div className="notice error">{error}</div>
      </div>
    )
  }

  if (openTripBookings) {
    return (
      <>
        <div className="app-header">
          <Logo height={36} />
          <p>Hallo {driver?.name} 👋</p>
        </div>
        <div className="container">
          <div className="card">
            <button className="secondary" style={{ marginBottom: 12 }} onClick={() => setOpenTripBookings(null)}>← Zurück</button>
            <h3>{openTripBookings.route_name}</h3>
            <div className="meta">{formatDate(openTripBookings.trip_date)} · {formatTime(openTripBookings.start_time)} Uhr</div>
            {tripBookings.length === 0 && <div className="empty-state">Noch keine Buchungen.</div>}
            {tripBookings.map((b) => {
              const draft = personRatingDraftFor(b)
              const alreadyRated = b.rating_punctuality != null
              return (
                <div key={b.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <strong>{b.person_name}</strong> — {b.from_stop} → {b.to_stop} ({b.seats} Platz/Plätze) · EUR {b.price}
                  {whatsappLink(b.person_phone) && (
                    <div>
                      <a href={whatsappLink(b.person_phone)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                        💬 WhatsApp
                      </a>
                    </div>
                  )}
                  {b.can_rate && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--color-border)' }}>
                      <div className="meta" style={{ marginBottom: 8, fontWeight: 600 }}>
                        {alreadyRated ? 'Deine Bewertung' : 'Mitfahrer bewerten'}
                      </div>
                      {PERSON_RATING_CATEGORIES.map((c) => (
                        <div key={c.key} style={{ marginBottom: 8 }}>
                          <label style={{ margin: '0 0 4px' }}>{c.label}</label>
                          <StarInput value={draft[c.key]} onChange={(v) => updatePersonRatingDraft(b.id, c.key, v)} />
                        </div>
                      ))}
                      <button
                        className="secondary"
                        style={{ width: '100%', marginTop: 6 }}
                        disabled={personRatingBusyId === b.id}
                        onClick={() => submitPersonRating(b)}
                      >
                        {personRatingBusyId === b.id ? 'Wird gespeichert …' : personRatingSavedId === b.id ? '✓ Gespeichert' : alreadyRated ? 'Bewertung aktualisieren' : 'Bewertung senden'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  const bmcValidUntil = driver?.bmc_last_payment_date
    ? new Date(new Date(driver.bmc_last_payment_date).getTime() + 40 * 86400000)
    : null
  const canPublishTrip = Boolean(
    driver?.bmc_subscription_active && bmcValidUntil && bmcValidUntil >= new Date(new Date().toDateString())
  )

  return (
    <>
      <div className="app-header">
        <div className="app-header-text">
          <Logo height={36} />
          <p>Hallo {driver?.name} 👋</p>
        </div>
        <BuyMeACoffeeBadge active={driver?.bmc_subscription_active} projectLink={driver?.project_buymeacoffee_link} onGoToSettings={() => setTab('settings')} />
      </div>

      <div className="container">
        {notifications.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {notifications.map((n) => (
              <div key={n.id} className="notice success" style={{ marginBottom: 8 }}>
                {n.text}
              </div>
            ))}
          </div>
        )}
        <div className="tabs">
          <button className={tab === 'trips' ? 'active' : ''} onClick={() => setTab('trips')}>Meine Fahrten</button>
          <button className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>Meine Strecken</button>
          <button className={tab === 'cars' ? 'active' : ''} onClick={() => setTab('cars')}>Meine Autos</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Einstellungen</button>
        </div>

        {tab === 'settings' && (
          <div className="card">
            <h3>⚙️ Meine Einstellungen</h3>

            <div style={{ margin: '10px 0', padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
              <div className="meta" style={{ fontWeight: 600, marginBottom: 4 }}>🔔 Benachrichtigungen bei neuen Buchungen</div>
              {notificationPermission === 'granted' && (
                <div className="meta">Aktiviert — solange diese Seite offen ist, meldet sich dein Browser bei neuen Buchungen.</div>
              )}
              {notificationPermission === 'denied' && (
                <div className="meta">Blockiert. Bitte in den Browser-Einstellungen für diese Seite erlauben.</div>
              )}
              {notificationPermission === 'default' && (
                <>
                  <div className="meta" style={{ marginBottom: 8 }}>
                    Noch nicht aktiviert. Ohne das siehst du neue Buchungen trotzdem als Hinweis oben auf der Seite,
                    solange sie geöffnet ist — mit Browser-Benachrichtigungen bekommst du es auch mit, wenn ein
                    anderer Tab aktiv ist.
                  </div>
                  <button className="secondary" style={{ width: '100%' }} onClick={requestNotificationPermission}>
                    Browser-Benachrichtigungen aktivieren
                  </button>
                </>
              )}
              {notificationPermission === 'unsupported' && (
                <div className="meta">Dieser Browser unterstützt keine Benachrichtigungen.</div>
              )}
            </div>

            <div style={{ margin: '10px 0', padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
              <div className="meta" style={{ marginBottom: 4, fontWeight: 600 }}>Deine Bewertungen</div>
              {driver?.rating?.count
                ? (
                  <>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: '#f0a500', fontSize: 16 }}>★</span>{' '}
                      <strong>{driver.rating.avg_overall}</strong>{' '}
                      <span className="meta">({driver.rating.count} Bewertung{driver.rating.count === 1 ? '' : 'en'})</span>
                    </div>
                    <div className="meta">
                      Fahrerlebnis {driver.rating.avg_experience} · Pünktlichkeit {driver.rating.avg_punctuality} · Fahrweise {driver.rating.avg_driving} · Sauberkeit {driver.rating.avg_cleanliness} · Kommunikation {driver.rating.avg_communication}
                    </div>
                  </>
                )
                : <div className="meta">Noch keine Bewertungen.</div>}
            </div>
            <form onSubmit={saveSettings} style={{ marginTop: 12 }}>
              <label>Mobilnummer</label>
              <input type="tel" value={driverPhone} onChange={(e) => setDriverPhone(normalizePhoneInput(e.target.value))} placeholder="z.B. +41 79 123 45 67" />
              <div className="meta" style={{ marginTop: -8, marginBottom: 10 }}>
                Bitte mit Ländervorwahl (z.B. +41) angeben, damit der WhatsApp-Kontakt-Link für Mitfahrer korrekt funktioniert.
              </div>
              <label>E-Mail (auch bei Buy Me a Coffee verwenden)</label>
              <input type="email" value={driverEmail} onChange={(e) => setDriverEmail(e.target.value)} placeholder="deine@email.ch" />
              <label>Zahlungshinweis/-link</label>
              <input
                value={paymentInfo}
                onChange={(e) => setPaymentInfo(e.target.value)}
                placeholder="z.B. paypal.me/deinname oder 'Twint an 079 123 45 67'"
              />
              <div style={{ margin: '10px 0', padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
                <div className="meta" style={{ fontWeight: 600, marginBottom: 4 }}>☕ Buy Me a Coffee</div>
                <div className="meta">
                  Status: {driver?.bmc_subscription_active ? 'aktiv' : 'nicht aktiv'}
                  {driver?.bmc_last_payment_date && ` · letztes Zahldatum ${driver.bmc_last_payment_date}`}
                </div>
                <div className="meta" style={{ marginTop: 2, fontStyle: 'italic' }}>
                  Wird vom Admin gepflegt, sobald die Unterstützung aktiv ist.
                </div>
              </div>
              <label>Referenzwährung (ISO 4217)</label>
              <input
                value={referenceCurrency}
                onChange={(e) => setReferenceCurrency(e.target.value.toUpperCase())}
                placeholder="z.B. CHF"
                maxLength={3}
              />
              <label>Deine Rate (EUR pro 100 km)</label>
              <input
                type="number" min="0" step="0.1"
                value={ratePer100km}
                onChange={(e) => setRatePer100km(e.target.value)}
                placeholder="z.B. 5"
              />
              {referenceCurrency && ratePer100km !== '' && (
                <div className="meta">
                  ≈ {formatConverted(Number(ratePer100km), conversionRate, referenceCurrency) || '…'}/100km
                </div>
              )}
              {settingsMsg && <div className={`notice ${settingsMsg.type}`} style={{ marginTop: 12 }}>{settingsMsg.text}</div>}
              <button style={{ marginTop: 12, width: '100%' }} disabled={settingsBusy}>
                {settingsBusy ? 'Wird gespeichert …' : 'Einstellungen speichern'}
              </button>
            </form>
          </div>
        )}

        {tab === 'routes' && (
          <div className="card">
            <DriverRoutesManager token={token} onRoutesChanged={loadAll} driverRate={driver?.rate_eur_per_100km ?? null} />
          </div>
        )}

        {tab === 'cars' && (
          <div className="card">
            <DriverCarsManager token={token} onCarsChanged={loadAll} />
          </div>
        )}

        {tab === 'trips' && (
          <>
            <div className="card">
              <h3>Fahrt veröffentlichen</h3>
              {copyTemplate && (
                <div className="notice" style={{ background: '#eef6f1', color: 'var(--color-primary-dark)', marginBottom: 10 }}>
                  📋 Kopiert von "{copyTemplate.route_name}" ({formatDate(copyTemplate.trip_date)}) — bitte Datum, Startzeit und
                  Plätze prüfen/anpassen.{' '}
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '2px 8px', marginLeft: 6 }}
                    onClick={() => { setCopyTemplate(null); setRouteId(''); setCarId(''); setSeats(3) }}
                  >
                    Vorlage entfernen
                  </button>
                </div>
              )}
              {(cars.length === 0 || routes.length === 0) && (
                <div className="notice error">Es sind noch keine Strecken oder Autos hinterlegt. Bitte den Admin fragen.</div>
              )}
              {(() => {
                if (canPublishTrip) {
                  return (
                    <div className="meta" style={{ marginBottom: 10 }}>
                      ✅ Abo aktiv — Fahrten veröffentlichbar bis einschliesslich {formatDate(bmcValidUntil.toISOString().slice(0, 10))}.
                    </div>
                  )
                }
                return (
                  <div className="notice error" style={{ marginBottom: 10 }}>
                    {!driver?.bmc_subscription_active
                      ? 'Fahrten veröffentlichen ist nur mit aktivem Buy-Me-a-Coffee-Abo möglich. Bitte im Tab „Einstellungen" prüfen bzw. das Abo abschliessen.'
                      : `Dein Abo-Zeitraum ist abgelaufen${bmcValidUntil ? ` (gültig bis ${formatDate(bmcValidUntil.toISOString().slice(0, 10))})` : ''}. Bitte die nächste Zahlung abschliessen.`}
                  </div>
                )
              })()}
              <form onSubmit={publishTrip}>
                <label>Strecke</label>
                <select value={routeId} onChange={(e) => setRouteId(e.target.value)} required disabled={routes.length === 0}>
                  <option value="">Bitte wählen</option>
                  {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <label>Auto</label>
                <select value={carId} onChange={(e) => setCarId(e.target.value)} required disabled={cars.length === 0}>
                  <option value="">Bitte wählen</option>
                  {cars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.notes ? ` (${c.notes})` : ''}</option>)}
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
                {publishMsg && <div className={`notice ${publishMsg.type}`} style={{ marginTop: 12 }}>{publishMsg.text}</div>}
                <button style={{ marginTop: 12, width: '100%' }} disabled={busy || cars.length === 0 || routes.length === 0 || !canPublishTrip}>
                  {calcStatus ? 'Berechne Entfernungen …' : busy ? 'Wird veröffentlicht …' : 'Veröffentlichen'}
                </button>
              </form>
            </div>

            <h3 style={{ margin: '20px 0 8px' }}>Meine Fahrten</h3>
            {trips.length === 0 && <div className="empty-state">Noch keine Fahrten veröffentlicht.</div>}
            {trips.map((t) => (
              <div className="card" key={t.id}>
                <h3>{t.route_name}{t.via_stops && ` (via ${t.via_stops})`} {t.closed && <span className="badge full">geschlossen</span>}</h3>
                <div className="meta">{formatDate(t.trip_date)} · {formatTime(t.start_time)} Uhr</div>
                {t.car_name && <div className="meta">🚗 {t.car_name}{t.car_notes ? ` (${t.car_notes})` : ''}</div>}
                <div style={{ margin: '8px 0' }}>
                  <span className="badge">{t.seats_booked} / {t.total_seats} Plätze gebucht</span>
                </div>
                <div className="row" style={{ alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Freie Plätze gesamt:</label>
                  <button
                    className="secondary"
                    style={{ padding: '4px 12px' }}
                    disabled={seatsUpdatingId === t.id || t.total_seats <= t.min_seats}
                    onClick={() => updateTripSeats(t, t.total_seats - 1)}
                  >−</button>
                  <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{t.total_seats}</span>
                  <button
                    className="secondary"
                    style={{ padding: '4px 12px' }}
                    disabled={seatsUpdatingId === t.id}
                    onClick={() => updateTripSeats(t, t.total_seats + 1)}
                  >+</button>
                </div>
                <div className="row">
                  <button onClick={() => showBookings(t)}>Mitfahrer ansehen</button>
                  <button className="secondary" onClick={() => toggleClosed(t)}>{t.closed ? 'Buchungen wieder zulassen' : 'Neue Buchungen blockieren'}</button>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="secondary" onClick={() => copyTrip(t)}>Kopieren</button>
                  <button className="danger" onClick={() => deleteTrip(t.id)}>Löschen</button>
                </div>
              </div>
            ))}
          </>
        )}
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <Link to="/impressum" target="_blank" style={{ fontSize: 13 }}>Impressum</Link>
        </div>
      </div>
    </>
  )
}
