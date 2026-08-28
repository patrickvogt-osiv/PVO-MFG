import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const TOKEN_STORAGE_KEY = 'fahrt-buchung:invite-token'

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(timeStr) {
  return timeStr?.slice(0, 5)
}

function formatAddress(s) {
  if (!s) return ''
  const line1 = [s.postal_code, s.name].filter(Boolean).join(' ')
  const line2 = [s.street, s.house_number].filter(Boolean).join(' ')
  return [line1, line2, s.country].filter(Boolean).join(', ')
}

function guessCountryFromBrowser() {
  try {
    const locale = navigator.language || 'de-CH'
    const region = new Intl.Locale(locale).maximize().region
    if (!region) return ''
    const dn = new Intl.DisplayNames(['de'], { type: 'region' })
    return dn.of(region) || ''
  } catch {
    return ''
  }
}

// Europaweite Ortsvorschläge über Photon (komoot.io) — kostenlos, ohne
// API-Key, basiert auf OpenStreetMap-Daten und ist speziell für
// Autovervollständigung mit Teilwörtern gebaut (im Gegensatz zu Nominatim,
// das eher vollständige Ortsnamen erwartet).
async function fetchPlaceSuggestions(query) {
  if (!query || query.trim().length < 2) return []
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=de`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const seen = new Set()
    const results = []
    for (const f of data.features || []) {
      const p = f.properties || {}
      if (p.osm_key !== 'place') continue
      if (!['city', 'town', 'village', 'hamlet', 'municipality'].includes(p.osm_value)) continue
      const city = p.name
      const postcode = p.postcode || ''
      const country = p.country || ''
      const key = `${city}|${postcode}|${country}`
      if (!city || seen.has(key)) continue
      seen.add(key)
      const label = postcode ? `${city} (${postcode}) – ${country}` : `${city} – ${country}`
      results.push({ label, city, postcode, country })
    }
    return results.slice(0, 6)
  } catch {
    return []
  }
}

export default function InvitePage() {
  const { token: tokenFromUrl } = useParams()
  const navigate = useNavigate()
  const token = tokenFromUrl || localStorage.getItem(TOKEN_STORAGE_KEY)

  useEffect(() => {
    if (!tokenFromUrl && !localStorage.getItem(TOKEN_STORAGE_KEY)) {
      const driverToken = localStorage.getItem('fahrt-buchung:driver-token')
      if (driverToken) navigate(`/driver/${driverToken}`, { replace: true })
    }
  }, [tokenFromUrl, navigate])

  const [person, setPerson] = useState(null)
  const [trips, setTrips] = useState([])
  const [myBookings, setMyBookings] = useState([])
  const [tab, setTab] = useState('trips')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [tripDetails, setTripDetails] = useState(null)
  const [fromStop, setFromStop] = useState('')
  const [toStop, setToStop] = useState('')
  const [seats, setSeats] = useState(1)
  const [bookingMsg, setBookingMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const [searchCityInput, setSearchCityInput] = useState('')
  const [searchCountryInput, setSearchCountryInput] = useState(guessCountryFromBrowser())
  const [destCityInput, setDestCityInput] = useState('')
  const [destCountryInput, setDestCountryInput] = useState('')
  const [dateInput, setDateInput] = useState('')
  const [flexDaysInput, setFlexDaysInput] = useState(0)
  const [activeSearch, setActiveSearch] = useState({ city: '', country: '', destCity: '', destCountry: '', date: '', flexDays: 0 })
  const [hasSearched, setHasSearched] = useState(false)

  const [startSuggestions, setStartSuggestions] = useState([])
  const [showStartSuggestions, setShowStartSuggestions] = useState(false)
  const [destSuggestions, setDestSuggestions] = useState([])
  const [showDestSuggestions, setShowDestSuggestions] = useState(false)
  const startDebounceRef = useRef(null)
  const destDebounceRef = useRef(null)

  function handleStartCityChange(value) {
    setSearchCityInput(value)
    setShowStartSuggestions(true)
    if (startDebounceRef.current) clearTimeout(startDebounceRef.current)
    startDebounceRef.current = setTimeout(async () => {
      setStartSuggestions(await fetchPlaceSuggestions(value))
    }, 450)
  }

  function selectStartSuggestion(s) {
    setSearchCityInput(s.city)
    setSearchCountryInput(s.country)
    setShowStartSuggestions(false)
    setStartSuggestions([])
  }

  function handleDestCityChange(value) {
    setDestCityInput(value)
    setShowDestSuggestions(true)
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current)
    destDebounceRef.current = setTimeout(async () => {
      setDestSuggestions(await fetchPlaceSuggestions(value))
    }, 450)
  }

  function selectDestSuggestion(s) {
    setDestCityInput(s.city)
    setDestCountryInput(s.country)
    setShowDestSuggestions(false)
    setDestSuggestions([])
  }

  function runSearch(e) {
    e?.preventDefault()
    setActiveSearch({
      city: searchCityInput.trim(),
      country: searchCountryInput.trim(),
      destCity: destCityInput.trim(),
      destCountry: destCountryInput.trim(),
      date: dateInput,
      flexDays: flexDaysInput,
    })
    setHasSearched(true)
  }

  function resetSearch() {
    setSearchCityInput('')
    setDestCityInput('')
    setDestCountryInput('')
    setDateInput('')
    setFlexDaysInput(0)
    setActiveSearch({ city: '', country: '', destCity: '', destCountry: '', date: '', flexDays: 0 })
    setHasSearched(false)
  }

  function tripMatchesSearch(trip) {
    const stops = trip.stops || []
    const fromCandidates = stops.filter((s) => {
      const nameOk = !activeSearch.city || s.name?.toLowerCase().includes(activeSearch.city.toLowerCase())
      const countryOk = !activeSearch.country || (s.country || '').toLowerCase().includes(activeSearch.country.toLowerCase())
      return nameOk && countryOk
    })
    const toCandidates = stops.filter((s) => {
      const nameOk = !activeSearch.destCity || s.name?.toLowerCase().includes(activeSearch.destCity.toLowerCase())
      const countryOk = !activeSearch.destCountry || (s.country || '').toLowerCase().includes(activeSearch.destCountry.toLowerCase())
      return nameOk && countryOk
    })
    const locationOk = fromCandidates.some((f) => toCandidates.some((t) => f.order_index < t.order_index))
    if (!locationOk) return false

    if (activeSearch.date) {
      const target = new Date(activeSearch.date + 'T00:00:00')
      const tripD = new Date(trip.trip_date + 'T00:00:00')
      const diffDays = Math.round((tripD - target) / 86400000)
      if (Math.abs(diffDays) > activeSearch.flexDays) return false
    }

    return true
  }

  const visibleTrips = hasSearched ? trips.filter(tripMatchesSearch) : []

  // Ermittelt die konkrete Verbindung (Ein-/Ausstieg), die zur aktuellen Orts-
  // Suche passt, damit die Verfügbarkeit dafür (statt für die ganze Strecke)
  // angezeigt werden kann.
  function matchedSegmentFor(trip) {
    if (!activeSearch.city && !activeSearch.country && !activeSearch.destCity && !activeSearch.destCountry) return null
    const stops = [...(trip.stops || [])].sort((a, b) => a.order_index - b.order_index)
    const fromCandidates = stops.filter((s) => {
      const nameOk = !activeSearch.city || s.name?.toLowerCase().includes(activeSearch.city.toLowerCase())
      const countryOk = !activeSearch.country || (s.country || '').toLowerCase().includes(activeSearch.country.toLowerCase())
      return nameOk && countryOk
    })
    const toCandidates = stops.filter((s) => {
      const nameOk = !activeSearch.destCity || s.name?.toLowerCase().includes(activeSearch.destCity.toLowerCase())
      const countryOk = !activeSearch.destCountry || (s.country || '').toLowerCase().includes(activeSearch.destCountry.toLowerCase())
      return nameOk && countryOk
    })
    for (const f of fromCandidates) {
      for (const t of toCandidates) {
        if (f.order_index < t.order_index) return { from: f, to: t }
      }
    }
    return null
  }

  function availableSeatsInRange(trip, fromIdx, toIdx) {
    const segs = []
    for (let i = fromIdx; i < toIdx; i++) {
      const seg = (trip.segment_usage || []).find((s) => s.order_index === i)
      segs.push(seg ? seg.used : 0)
    }
    if (segs.length === 0) return trip.available_seats
    return trip.total_seats - Math.max(...segs)
  }

  useEffect(() => {
    if (tokenFromUrl) {
      localStorage.setItem(TOKEN_STORAGE_KEY, tokenFromUrl)
    }
  }, [tokenFromUrl])

  const loadTrips = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('fn_list_open_trips', { p_token: token })
    setLoading(false)
    if (err) {
      setError('Verbindung fehlgeschlagen. Bitte später erneut versuchen.')
      return
    }
    if (data?.error === 'invalid_token') {
      setError('Dieser Einladungslink ist ungültig oder wurde widerrufen.')
      return
    }
    setPerson(data.person)
    setTrips(data.trips)
  }, [token])

  // Aktualisiert die Fahrtenliste im Hintergrund (z.B. nach einer Buchung),
  // ohne den ganzen Bildschirm kurz durch einen Ladezustand zu ersetzen.
  const refreshTrips = useCallback(async () => {
    if (!token) return
    const { data, error: err } = await supabase.rpc('fn_list_open_trips', { p_token: token })
    if (!err && !data?.error) {
      setTrips(data.trips)
    }
  }, [token])

  const loadMyBookings = useCallback(async () => {
    if (!token) return
    const { data, error: err } = await supabase.rpc('fn_list_my_bookings', { p_token: token })
    if (!err && !data?.error) {
      setMyBookings(data.bookings)
    }
  }, [token])

  useEffect(() => {
    loadTrips()
    loadMyBookings()
  }, [loadTrips, loadMyBookings])

  async function openTrip(trip) {
    setSelectedTrip(trip)
    setFromStop('')
    setToStop('')
    setSeats(1)
    setBookingMsg(null)
    const { data, error: err } = await supabase.rpc('fn_get_trip_details', {
      p_token: token,
      p_trip_id: trip.id,
    })
    if (!err && !data?.error) {
      setTripDetails(data)
    }
  }

  async function reloadTripDetails(trip) {
    const { data, error: err } = await supabase.rpc('fn_get_trip_details', {
      p_token: token,
      p_trip_id: trip.id,
    })
    if (!err && !data?.error) {
      setTripDetails(data)
    }
  }

  function segmentRange(fromIdx, toIdx) {
    if (!tripDetails || fromIdx === '' || toIdx === '' || Number(fromIdx) >= Number(toIdx)) return []
    const result = []
    for (let i = Number(fromIdx); i < Number(toIdx); i++) {
      const seg = tripDetails.segment_usage.find((s) => s.order_index === i)
      result.push(seg || { used: 0, price: 0, distance: null, duration: null })
    }
    return result
  }

  // Distanz/Fahrzeit für einen Abschnitt, nur falls für ALLE beteiligten
  // Teilstrecken bereits Werte berechnet wurden (siehe Admin-Bereich).
  function distanceDurationFor(fromIdx, toIdx) {
    const segs = segmentRange(fromIdx, toIdx)
    if (segs.length === 0 || segs.some((s) => s.distance == null || s.duration == null)) return null
    return {
      distance: Math.round(segs.reduce((sum, s) => sum + Number(s.distance), 0) * 10) / 10,
      duration: segs.reduce((sum, s) => sum + Number(s.duration), 0),
    }
  }

  // Uhrzeit + Minuten, mit Tagesüberlauf
  function addMinutes(timeStr, minutes) {
    const [h, m] = timeStr.split(':').map(Number)
    const total = h * 60 + m + Math.round(minutes)
    const dayMinutes = ((total % 1440) + 1440) % 1440
    const hh = String(Math.floor(dayMinutes / 60)).padStart(2, '0')
    const mm = String(dayMinutes % 60).padStart(2, '0')
    return { time: `${hh}:${mm}`, nextDay: total >= 1440 }
  }

  // Voraussichtliche Uhrzeit an einem Stopp (Startzeit der Fahrt + kumulierte
  // Fahrzeit ab dem allerersten Stopp der Strecke)
  function etaAt(orderIndex) {
    if (!selectedTrip || orderIndex === 0) return selectedTrip ? { time: formatTime(selectedTrip.start_time), nextDay: false } : null
    const cum = distanceDurationFor(0, orderIndex)
    if (!cum) return null
    return addMinutes(selectedTrip.start_time, cum.duration)
  }

  function availableSeatsFor(fromIdx, toIdx) {
    const segs = segmentRange(fromIdx, toIdx)
    if (segs.length === 0) return null
    const maxUsed = Math.max(...segs.map((s) => s.used))
    return tripDetails.total_seats - maxUsed
  }

  function priceFor(fromIdx, toIdx) {
    if (
      tripDetails &&
      tripDetails.stops.length > 0 &&
      Number(fromIdx) === tripDetails.stops[0].order_index &&
      Number(toIdx) === tripDetails.stops[tripDetails.stops.length - 1].order_index
    ) {
      return tripDetails.route_total_price || 0
    }
    const segs = segmentRange(fromIdx, toIdx)
    return segs.reduce((sum, s) => sum + (s.price || 0), 0)
  }

  // Alle buchbaren Verbindungen einer Fahrt: volle Strecke zuerst, danach alle
  // Teilstrecken-Kombinationen zwischen je zwei Stopps.
  function allSegments() {
    const stops = tripDetails?.stops || []
    if (stops.length < 2) return []
    const full = { from: stops[0], to: stops[stops.length - 1], isFull: true }
    const rest = []
    for (let i = 0; i < stops.length - 1; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        if (i === 0 && j === stops.length - 1) continue
        rest.push({ from: stops[i], to: stops[j], isFull: false })
      }
    }
    return [full, ...rest]
  }

  async function submitBooking() {
    if (!fromStop || !toStop) return
    setBusy(true)
    setBookingMsg(null)
    const { data, error: err } = await supabase.rpc('fn_create_booking', {
      p_token: token,
      p_trip_id: selectedTrip.id,
      p_from_stop_id: fromStop,
      p_to_stop_id: toStop,
      p_seats: Number(seats),
    })
    setBusy(false)
    if (err || data?.error) {
      const map = {
        not_enough_seats: `Nicht genug freie Plätze (noch ${data?.available ?? 0} verfügbar).`,
        invalid_segment: 'Bitte Start- und Zielort korrekt wählen.',
        invalid_token: 'Einladungslink ungültig.',
      }
      setBookingMsg({ type: 'error', text: map[data?.error] || 'Buchung fehlgeschlagen.' })
      return
    }
    setBookingMsg({ type: 'success', text: `Platz erfolgreich gebucht! Mitfahrbeitrag: CHF ${data.price}` })
    setFromStop('')
    setToStop('')
    reloadTripDetails(selectedTrip)
    loadMyBookings()
    refreshTrips()
  }

  async function cancelBooking(id) {
    if (!confirm('Buchung wirklich stornieren?')) return
    await supabase.rpc('fn_cancel_booking', { p_token: token, p_booking_id: id })
    loadMyBookings()
    refreshTrips()
    if (selectedTrip) openTrip(selectedTrip)
  }

  const [signupRole, setSignupRole] = useState(null) // null | 'mitfahrer' | 'fahrer'
  const [signupFirstName, setSignupFirstName] = useState('')
  const [signupLastName, setSignupLastName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupBusy, setSignupBusy] = useState(false)
  const [signupError, setSignupError] = useState(null)
  const [signupResult, setSignupResult] = useState(null)

  async function submitSignup(e) {
    e.preventDefault()
    setSignupBusy(true)
    setSignupError(null)
    const { data, error: err } = await supabase.rpc('fn_signup_request', {
      p_role: signupRole,
      p_first_name: signupFirstName.trim(),
      p_last_name: signupLastName.trim(),
      p_phone: signupPhone.trim(),
      p_email: signupEmail.trim(),
    })
    setSignupBusy(false)
    if (err || data?.error) {
      setSignupError('Anmeldung fehlgeschlagen. Bitte später erneut versuchen.')
      return
    }
    const link = `${window.location.origin}/${data.role === 'fahrer' ? 'driver' : 'invite'}/${data.token}`
    setSignupResult({ ...data, link })
  }

  function buildAdminMailto() {
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || ''
    const roleLabel = signupRole === 'fahrer' ? 'Fahrer/-in' : 'Mitfahrer/-in'
    const subject = `Neue Anmeldung als ${roleLabel}: ${signupFirstName} ${signupLastName}`
    const body = [
      `Name: ${signupFirstName} ${signupLastName}`,
      `Mobilnummer: ${signupPhone}`,
      `E-Mail: ${signupEmail}`,
      '',
      `Einladungslink (nach Freischaltung gültig): ${signupResult?.link}`,
      '',
      `Bitte den Zugang im Admin-Bereich freischalten (Tab „${signupRole === 'fahrer' ? 'Fahrer' : 'Mitfahrer'}" → Zugang wiederherstellen).`,
    ].join('\n')
    return `mailto:${adminEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  function startOver() {
    setSignupRole(null)
    setSignupResult(null)
    setSignupFirstName('')
    setSignupLastName('')
    setSignupPhone('')
    setSignupEmail('')
    setSignupError(null)
  }

  if (!token) {
    return (
      <>
        <div className="app-header">
          <h1>Mitfahrt buchen</h1>
          <p>Willkommen 👋</p>
        </div>
        <div className="container">
          {!signupRole && !signupResult && (
            <div className="card">
              <h3>Noch keinen Einladungslink?</h3>
              <div className="meta" style={{ marginBottom: 12 }}>
                Melde dich hier an — der Admin schaltet deinen Zugang danach frei.
              </div>
              <button style={{ width: '100%', marginBottom: 10 }} onClick={() => setSignupRole('mitfahrer')}>
                Anmeldung als Mitfahrer/-in
              </button>
              <button className="secondary" style={{ width: '100%' }} onClick={() => setSignupRole('fahrer')}>
                Anmeldung als Fahrer/-in
              </button>
            </div>
          )}

          {signupRole && !signupResult && (
            <div className="card">
              <h3>Anmeldung als {signupRole === 'fahrer' ? 'Fahrer/-in' : 'Mitfahrer/-in'}</h3>
              <form onSubmit={submitSignup}>
                <label>Vorname</label>
                <input value={signupFirstName} onChange={(e) => setSignupFirstName(e.target.value)} required />
                <label>Name</label>
                <input value={signupLastName} onChange={(e) => setSignupLastName(e.target.value)} required />
                <label>Mobilnummer</label>
                <input type="tel" value={signupPhone} onChange={(e) => setSignupPhone(e.target.value)} required />
                <label>E-Mail</label>
                <input type="email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required />
                {signupError && <div className="notice error" style={{ marginTop: 12 }}>{signupError}</div>}
                <div className="row" style={{ marginTop: 12 }}>
                  <button type="submit" disabled={signupBusy}>{signupBusy ? 'Wird gesendet …' : 'Anmeldung senden'}</button>
                  <button type="button" className="secondary" onClick={startOver}>Abbrechen</button>
                </div>
              </form>
            </div>
          )}

          {signupResult && (
            <div className="card">
              <h3>Danke für deine Anmeldung!</h3>
              <div className="meta" style={{ marginBottom: 12 }}>
                Der Admin schaltet deinen Zugang frei, sobald er deine Anfrage erhalten hat. Damit er
                Bescheid weiß, schick ihm bitte kurz die vorausgefüllte E-Mail:
              </div>
              <a href={buildAdminMailto()}>
                <button style={{ width: '100%' }}>📧 E-Mail an Admin senden</button>
              </a>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={startOver}>
                Zurück
              </button>
            </div>
          )}
        </div>
      </>
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

  return (
    <>
      <div className="app-header">
        <h1>Mitfahrt buchen</h1>
        <p>Hallo {person?.name} 👋</p>
      </div>

      <div className="container">
        <div className="tabs">
          <button className={tab === 'trips' ? 'active' : ''} onClick={() => { setTab('trips'); setSelectedTrip(null) }}>
            Fahrten
          </button>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            Meine Buchungen
          </button>
        </div>

        {tab === 'trips' && !selectedTrip && (
          <>
            <form onSubmit={runSearch} className="card">
              <label>Startort</label>
              <div style={{ position: 'relative' }}>
                <input
                  value={searchCityInput}
                  onChange={(e) => handleStartCityChange(e.target.value)}
                  onFocus={() => setShowStartSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowStartSuggestions(false), 150)}
                  placeholder="z.B. Münch…"
                  autoComplete="off"
                />
                {showStartSuggestions && startSuggestions.length > 0 && (
                  <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', marginTop: 4, padding: 4 }}>
                    {startSuggestions.map((s, i) => (
                      <div
                        key={i}
                        onMouseDown={() => selectStartSuggestion(s)}
                        style={{ padding: '8px 10px', fontSize: 14, cursor: 'pointer', borderRadius: 8 }}
                      >
                        {s.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <label>Startland</label>
              <input
                value={searchCountryInput}
                onChange={(e) => setSearchCountryInput(e.target.value)}
                placeholder="z.B. Schweiz"
              />
              <label>Zielort</label>
              <div style={{ position: 'relative' }}>
                <input
                  value={destCityInput}
                  onChange={(e) => handleDestCityChange(e.target.value)}
                  onFocus={() => setShowDestSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowDestSuggestions(false), 150)}
                  placeholder="z.B. Münch…"
                  autoComplete="off"
                />
                {showDestSuggestions && destSuggestions.length > 0 && (
                  <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', marginTop: 4, padding: 4 }}>
                    {destSuggestions.map((s, i) => (
                      <div
                        key={i}
                        onMouseDown={() => selectDestSuggestion(s)}
                        style={{ padding: '8px 10px', fontSize: 14, cursor: 'pointer', borderRadius: 8 }}
                      >
                        {s.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <label>Zielland</label>
              <input
                value={destCountryInput}
                onChange={(e) => setDestCountryInput(e.target.value)}
                placeholder="z.B. Deutschland"
              />
              <label>Datum</label>
              <input
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
              />
              <label>Flexibilität</label>
              <div className="row">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={flexDaysInput === n ? '' : 'secondary'}
                    onClick={() => setFlexDaysInput(flexDaysInput === n ? 0 : n)}
                    disabled={!dateInput}
                  >
                    ±{n} Tag{n > 1 ? 'e' : ''}
                  </button>
                ))}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="submit">Suchen</button>
                {hasSearched && (
                  <button type="button" className="secondary" onClick={resetSearch}>Zurücksetzen</button>
                )}
              </div>
            </form>

            {visibleTrips.length === 0 && (
              <div className="empty-state">
                {!hasSearched
                  ? 'Nutze die Suche oben, um verfügbare Fahrten zu finden. Suche ohne Angaben zeigt alle Fahrten.'
                  : trips.length === 0
                    ? 'Aktuell sind keine Fahrten geplant.'
                    : 'Keine Fahrten für diese Suche gefunden.'}
              </div>
            )}
            {visibleTrips.map((t) => {
              const seg = matchedSegmentFor(t)
              const avail = seg ? availableSeatsInRange(t, seg.from.order_index, seg.to.order_index) : t.available_seats
              const label = seg
                ? (avail > 0 ? `${avail} Platz/Plätze frei für ${seg.from.name} → ${seg.to.name}` : `Ausgebucht für ${seg.from.name} → ${seg.to.name}`)
                : (avail > 0 ? `${avail} von ${t.total_seats} Plätzen frei` : 'Ausgebucht')
              return (
                <div className="card" key={t.id}>
                  <h3>{t.route_name}{t.via_stops && ` (via ${t.via_stops})`}</h3>
                  <div className="meta">{formatDate(t.trip_date)} · {formatTime(t.start_time)} Uhr</div>
                  {t.car_name && <div className="meta">🚗 {t.car_name}{t.car_notes ? ` (${t.car_notes})` : ''}</div>}
                  <div style={{ margin: '8px 0' }}>
                    <span className={`badge ${avail <= 0 ? 'full' : ''}`}>{label}</span>
                  </div>
                  <button style={{ width: '100%' }} onClick={() => openTrip(t)}>Buchen</button>
                </div>
              )
            })}
          </>
        )}

        {tab === 'trips' && selectedTrip && tripDetails && (
          <div className="card">
            <button className="secondary" style={{ marginBottom: 12 }} onClick={() => setSelectedTrip(null)}>
              ← Zurück
            </button>
            <h3>{selectedTrip.route_name}</h3>
            <div className="meta">{formatDate(selectedTrip.trip_date)} · {formatTime(selectedTrip.start_time)} Uhr</div>
            {tripDetails.car_name && <div className="meta">🚗 {tripDetails.car_name}{tripDetails.car_notes ? ` (${tripDetails.car_notes})` : ''}</div>}

            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--color-muted)' }}>Streckenverlauf & Adressen anzeigen</summary>
              <div style={{ marginTop: 8 }}>
                {tripDetails.stops.map((s) => (
                  <div key={s.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <strong>{s.name}</strong>
                    {(s.street || s.postal_code) && <div className="meta">{formatAddress(s)}</div>}
                    {s.maps_link && (
                      <a href={s.maps_link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>📍 Auf Google Maps öffnen</a>
                    )}
                  </div>
                ))}
              </div>
            </details>

            {bookingMsg && <div className={`notice ${bookingMsg.type}`} style={{ margin: '12px 0' }}>{bookingMsg.text}</div>}

            {!fromStop || !toStop ? (
              <>
                <h3 style={{ marginTop: 16 }}>Verbindung wählen</h3>
                {allSegments().map((seg) => {
                  const avail = availableSeatsFor(seg.from.order_index, seg.to.order_index)
                  const price = priceFor(seg.from.order_index, seg.to.order_index)
                  const soldOut = avail <= 0
                  const distDur = distanceDurationFor(seg.from.order_index, seg.to.order_index)
                  const departure = etaAt(seg.from.order_index)
                  const arrival = etaAt(seg.to.order_index)
                  return (
                    <div
                      key={`${seg.from.id}-${seg.to.id}`}
                      className="card"
                      style={{
                        marginBottom: 8,
                        cursor: soldOut ? 'default' : 'pointer',
                        opacity: soldOut ? 0.55 : 1,
                        background: soldOut ? '#eceef0' : undefined,
                      }}
                      onClick={() => { if (!soldOut) { setFromStop(seg.from.id); setToStop(seg.to.id); setSeats(1) } }}
                    >
                      <h3 style={{ fontSize: 15, margin: 0 }}>
                        {seg.from.name} – {seg.to.name}
                        <span className="meta" style={{ fontWeight: 400 }}> ({seg.isFull ? 'Volle Distanz' : 'Teil-Distanz'})</span>
                      </h3>
                      {departure && arrival && (
                        <div className="meta" style={{ marginTop: 4 }}>
                          ab {departure.time}{departure.nextDay ? ' (+1 Tag)' : ''} Uhr · an ca. {arrival.time}{arrival.nextDay ? ' (+1 Tag)' : ''} Uhr
                          {distDur && ` · ${distDur.distance} km`}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        <span className={`badge ${soldOut ? 'full' : ''}`}>
                          {soldOut ? 'Ausgebucht' : `${avail} Platz/Plätze frei`}
                        </span>
                        <span className="badge">CHF {price}</span>
                      </div>
                    </div>
                  )
                })}
              </>
            ) : (() => {
              const fromIdx = tripDetails.stops.find((s) => s.id === fromStop).order_index
              const toIdx = tripDetails.stops.find((s) => s.id === toStop).order_index
              const fromName = tripDetails.stops.find((s) => s.id === fromStop).name
              const toName = tripDetails.stops.find((s) => s.id === toStop).name
              const avail = availableSeatsFor(fromIdx, toIdx)
              const price = priceFor(fromIdx, toIdx)
              const distDur = distanceDurationFor(fromIdx, toIdx)
              const departure = etaAt(fromIdx)
              const arrival = etaAt(toIdx)
              return (
                <div style={{ marginTop: 16 }}>
                  <button className="secondary" style={{ marginBottom: 12 }} onClick={() => { setFromStop(''); setToStop('') }}>
                    ← Andere Verbindung wählen
                  </button>
                  <h3>{fromName} – {toName}</h3>
                  {departure && arrival && (
                    <div className="meta">
                      ab {departure.time}{departure.nextDay ? ' (+1 Tag)' : ''} Uhr · an ca. {arrival.time}{arrival.nextDay ? ' (+1 Tag)' : ''} Uhr
                      {distDur && ` · ${distDur.distance} km`}
                    </div>
                  )}
                  <div style={{ margin: '10px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`badge ${avail <= 0 ? 'full' : ''}`}>
                      {avail > 0 ? `${avail} Platz/Plätze frei` : 'Für diesen Abschnitt ausgebucht'}
                    </span>
                    <span className="badge">Mitfahrbeitrag: CHF {price}</span>
                  </div>

                  <label>Anzahl Plätze</label>
                  <input type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} />

                  <button
                    style={{ marginTop: 12, width: '100%' }}
                    disabled={busy}
                    onClick={submitBooking}
                  >
                    {busy ? 'Wird gebucht …' : 'Platz buchen'}
                  </button>
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'mine' && (
          <>
            {myBookings.length === 0 && <div className="empty-state">Du hast noch keine Buchungen.</div>}
            {myBookings.map((b) => {
              const departure = b.duration_to_from_min != null ? addMinutes(b.start_time, b.duration_to_from_min) : null
              const arrival = b.duration_to_to_min != null ? addMinutes(b.start_time, b.duration_to_to_min) : null
              return (
                <div className="card" key={b.id}>
                  <h3>{b.from_stop} → {b.to_stop} · {b.seats} Platz/Plätze</h3>
                  <div className="meta">{formatDate(b.trip_date)} · {formatTime(b.start_time)} Uhr</div>
                  {b.car_name && <div className="meta">🚗 {b.car_name}{b.car_notes ? ` (${b.car_notes})` : ''}</div>}
                  {departure && arrival && (
                    <div className="meta">
                      ab {departure.time}{departure.nextDay ? ' (+1 Tag)' : ''} Uhr · an ca. {arrival.time}{arrival.nextDay ? ' (+1 Tag)' : ''} Uhr
                      {b.distance_km != null && ` · ${b.distance_km} km`}
                    </div>
                  )}
                  <div className="meta">Mitfahrbeitrag: CHF {b.price}</div>
                  <button className="danger" onClick={() => cancelBooking(b.id)}>Stornieren</button>
                </div>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}
