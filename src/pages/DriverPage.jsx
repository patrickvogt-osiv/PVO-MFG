import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { getEuroExchangeRate, formatConverted } from '../lib/currency'

const TOKEN_STORAGE_KEY = 'fahrt-buchung:driver-token'

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(timeStr) {
  return timeStr?.slice(0, 5)
}

function emptyAddress() {
  return { name: '', postal_code: '', street: '', house_number: '', country: '', maps_link: '' }
}

function AddressFields({ value, onChange, prefix }) {
  return (
    <>
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
function DriverRoutesManager({ token, onRoutesChanged }) {
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
    await supabase.rpc('fn_driver_remove_stop', { p_token: token, p_stop_id: stop.id })
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
      for (let i = 0; i < stops.length; i++) {
        const distanceKm = i < legs.length ? Math.round((legs[i].distance / 1000) * 10) / 10 : null
        const durationMin = i < legs.length ? Math.round(legs[i].duration / 60) : null
        await supabase.rpc('fn_driver_update_stop_distance', {
          p_token: token, p_stop_id: stops[i].id, p_distance_km: distanceKm, p_duration_min: durationMin,
          p_latitude: coords[i].lat, p_longitude: coords[i].lon,
        })
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
        <button className="secondary" style={{ marginBottom: 12 }} onClick={() => setOpenRoute(null)}>← Zurück zu meinen Strecken</button>

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

              {i > 0 && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ margin: '0 0 2px' }}>Mitfahrbeitrag bis „{s.name}" (EUR)</label>
                  <input type="number" min="0" step="1" defaultValue={stops[i - 1].price_to_next} onBlur={(e) => updatePrice(stops[i - 1], e.target.value)} />
                  {stops[i - 1].distance_to_next_km != null && (
                    <div className="meta" style={{ marginTop: 4 }}>≈ {stops[i - 1].distance_to_next_km} km · {stops[i - 1].duration_to_next_min} Min</div>
                  )}
                </div>
              )}

              <label style={{ marginTop: 12 }}>Adresse</label>
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

  const [openTripBookings, setOpenTripBookings] = useState(null)
  const [tripBookings, setTripBookings] = useState([])

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
  }, [token])

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

  useEffect(() => { loadAll() }, [loadAll])

  async function publishTrip(e) {
    e.preventDefault()
    if (!routeId || !carId || !date || !time || !seats) return
    setBusy(true)
    setPublishMsg(null)
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
      setPublishMsg({ type: 'error', text: 'Fahrt konnte nicht veröffentlicht werden.' })
      return
    }
    setPublishMsg({ type: 'success', text: 'Fahrt veröffentlicht!' })
    setRouteId(''); setCarId(''); setDate(''); setTime(''); setSeats(3)
    loadAll()
  }

  async function deleteTrip(id) {
    if (!confirm('Fahrt inkl. aller Buchungen löschen?')) return
    await supabase.rpc('fn_driver_delete_trip', { p_token: token, p_trip_id: id })
    loadAll()
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
          <h1>Meine Fahrten</h1>
          <p>Hallo {driver?.name} 👋</p>
        </div>
        <div className="container">
          <div className="card">
            <button className="secondary" style={{ marginBottom: 12 }} onClick={() => setOpenTripBookings(null)}>← Zurück</button>
            <h3>{openTripBookings.route_name}</h3>
            <div className="meta">{formatDate(openTripBookings.trip_date)} · {formatTime(openTripBookings.start_time)} Uhr</div>
            {tripBookings.length === 0 && <div className="empty-state">Noch keine Buchungen.</div>}
            {tripBookings.map((b) => (
              <div key={b.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <strong>{b.person_name}</strong> — {b.from_stop} → {b.to_stop} ({b.seats} Platz/Plätze) · EUR {b.price}
              </div>
            ))}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="app-header">
        <h1>Meine Fahrten</h1>
        <p>Hallo {driver?.name} 👋</p>
      </div>

      <div className="container">
        <div className="tabs">
          <button className={tab === 'trips' ? 'active' : ''} onClick={() => setTab('trips')}>Meine Fahrten</button>
          <button className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>Meine Strecken</button>
          <button className={tab === 'cars' ? 'active' : ''} onClick={() => setTab('cars')}>Meine Autos</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Einstellungen</button>
        </div>

        {tab === 'settings' && (
          <div className="card">
            <h3>⚙️ Meine Einstellungen</h3>
            <form onSubmit={saveSettings} style={{ marginTop: 12 }}>
              <label>Mobilnummer</label>
              <input type="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="z.B. 079 123 45 67" />
              <label>E-Mail</label>
              <input type="email" value={driverEmail} onChange={(e) => setDriverEmail(e.target.value)} placeholder="deine@email.ch" />
              <label>Zahlungshinweis/-link</label>
              <input
                value={paymentInfo}
                onChange={(e) => setPaymentInfo(e.target.value)}
                placeholder="z.B. paypal.me/deinname oder 'Twint an 079 123 45 67'"
              />
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
            <DriverRoutesManager token={token} onRoutesChanged={loadAll} />
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
              {(cars.length === 0 || routes.length === 0) && (
                <div className="notice error">Es sind noch keine Strecken oder Autos hinterlegt. Bitte den Admin fragen.</div>
              )}
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
                {publishMsg && <div className={`notice ${publishMsg.type}`} style={{ marginTop: 12 }}>{publishMsg.text}</div>}
                <button style={{ marginTop: 12, width: '100%' }} disabled={busy || cars.length === 0 || routes.length === 0}>
                  {busy ? 'Wird veröffentlicht …' : 'Veröffentlichen'}
                </button>
              </form>
            </div>

            <h3 style={{ margin: '20px 0 8px' }}>Meine Fahrten</h3>
            {trips.length === 0 && <div className="empty-state">Noch keine Fahrten veröffentlicht.</div>}
            {trips.map((t) => (
              <div className="card" key={t.id}>
                <h3>{t.route_name} {t.closed && <span className="badge full">geschlossen</span>}</h3>
                <div className="meta">{formatDate(t.trip_date)} · {formatTime(t.start_time)} Uhr</div>
                {t.car_name && <div className="meta">🚗 {t.car_name}{t.car_notes ? ` (${t.car_notes})` : ''}</div>}
                <div style={{ margin: '8px 0' }}>
                  <span className="badge">{t.seats_booked} / {t.total_seats} Plätze gebucht</span>
                </div>
                <div className="row">
                  <button onClick={() => showBookings(t)}>Mitfahrer ansehen</button>
                  <button className="secondary" onClick={() => toggleClosed(t)}>{t.closed ? 'Buchungen wieder zulassen' : 'Neue Buchungen blockieren'}</button>
                  <button className="danger" onClick={() => deleteTrip(t.id)}>Löschen</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}
