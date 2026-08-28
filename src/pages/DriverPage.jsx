import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const TOKEN_STORAGE_KEY = 'fahrt-buchung:driver-token'

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(timeStr) {
  return timeStr?.slice(0, 5)
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
  }, [token])

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
                <strong>{b.person_name}</strong> — {b.from_stop} → {b.to_stop} ({b.seats} Platz/Plätze) · CHF {b.price}
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
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
            <h3>{t.route_name}</h3>
            <div className="meta">{formatDate(t.trip_date)} · {formatTime(t.start_time)} Uhr</div>
            {t.car_name && <div className="meta">🚗 {t.car_name}{t.car_notes ? ` (${t.car_notes})` : ''}</div>}
            <div style={{ margin: '8px 0' }}>
              <span className="badge">{t.seats_booked} / {t.total_seats} Plätze gebucht</span>
            </div>
            <div className="row">
              <button onClick={() => showBookings(t)}>Mitfahrer ansehen</button>
              <button className="danger" onClick={() => deleteTrip(t.id)}>Löschen</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
