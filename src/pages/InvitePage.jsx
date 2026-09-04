import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import Logo from '../components/Logo'

const TOKEN_STORAGE_KEY = 'fahrt-buchung:invite-token'

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(timeStr) {
  return timeStr?.slice(0, 5)
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Baut einen wa.me-Link aus einer Telefonnummer. Funktioniert zuverlässig nur
// bei internationalem Format (z.B. "+41 79 123 45 67") — wa.me braucht die
// Nummer ohne führende 0, ohne Leerzeichen/Klammern, ohne "+".
function whatsappLink(phone, message) {
  if (!phone) return null
  let digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  if (!digits) return null
  const base = `https://wa.me/${digits}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

// Schickt eine E-Mail über die Supabase Edge Function "send-email" (SMTP im
// Hintergrund). Schlägt der Versand fehl (z.B. Function noch nicht
// eingerichtet), wird das nur geloggt — die Buchung selbst darf davon nicht
// abhängen.
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

// Lädt Leaflet (OpenStreetMap-Kartenbibliothek) einmalig per CDN nach —
// kostenlos, kein API-Key nötig.
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (window.__leafletLoading) return window.__leafletLoading
  window.__leafletLoading = new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => resolve(window.L)
    script.onerror = reject
    document.head.appendChild(script)
  })
  return window.__leafletLoading
}

function googleMapsRouteUrl(stops) {
  const withCoords = stops.filter((s) => s.latitude != null && s.longitude != null)
  if (withCoords.length < 2) return null
  const first = withCoords[0]
  const last = withCoords[withCoords.length - 1]
  const middle = withCoords.slice(1, -1)
  const params = new URLSearchParams({
    api: '1',
    origin: `${first.latitude},${first.longitude}`,
    destination: `${last.latitude},${last.longitude}`,
    travelmode: 'driving',
  })
  if (middle.length > 0) {
    params.set('waypoints', middle.map((s) => `${s.latitude},${s.longitude}`).join('|'))
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

function RouteMap({ stops }) {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const withCoords = stops.filter((s) => s.latitude != null && s.longitude != null)

  useEffect(() => {
    let cancelled = false
    if (withCoords.length < 2) return
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
        const map = L.map(containerRef.current)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap-Mitwirkende',
          maxZoom: 19,
        }).addTo(map)
        const latlngs = withCoords.map((s) => [s.latitude, s.longitude])
        withCoords.forEach((s, i) => {
          L.marker([s.latitude, s.longitude]).addTo(map).bindPopup(`${i + 1}. ${s.name}`)
        })
        L.polyline(latlngs, { color: '#1d5f4a', weight: 4, opacity: 0.7 }).addTo(map)
        map.fitBounds(latlngs, { padding: [24, 24] })
        mapRef.current = map
        setReady(true)
      })
      .catch(() => setError('Karte konnte nicht geladen werden.'))
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops])

  if (withCoords.length < 2) {
    return <div className="meta">Für diese Strecke wurden noch keine Koordinaten berechnet.</div>
  }
  if (error) {
    return <div className="notice error">{error}</div>
  }

  return (
    <>
      <div ref={containerRef} style={{ height: 260, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }} />
      {!ready && <div className="meta" style={{ marginTop: 6 }}>Lädt Karte …</div>}
    </>
  )
}


const RATING_CATEGORIES = [
  { key: 'experience', label: 'Fahrerlebnis' },
  { key: 'punctuality', label: 'Pünktlichkeit am Startpunkt' },
  { key: 'driving', label: 'Fahrweise' },
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
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 24, lineHeight: 1, cursor: 'pointer', color: n <= value ? '#f0a500' : '#d8dbe0' }}
        >★</button>
      ))}
    </div>
  )
}

function StarDisplaySummary({ rating }) {
  if (!rating || !rating.count) return <div className="meta">Noch keine Bewertungen.</div>
  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: '#f0a500', fontSize: 16 }}>★</span>{' '}
        <strong>{rating.avg_overall}</strong> <span className="meta">({rating.count} Bewertung{rating.count === 1 ? '' : 'en'})</span>
      </div>
      <div className="meta">
        {RATING_CATEGORIES.map((c) => `${c.label}: ${rating['avg_' + c.key]}`).join(' · ')}
      </div>
    </div>
  )
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
// Distanz zwischen zwei Koordinaten in km (Luftlinie), für die Umkreissuche.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

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
      const [lon, lat] = f.geometry?.coordinates || [null, null]
      const label = postcode ? `${city} (${postcode}) – ${country}` : `${city} – ${country}`
      results.push({ label, city, postcode, country, lat, lon })
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
  const [lastBookingNotify, setLastBookingNotify] = useState(null)
  const [streckenverlaufOpen, setStreckenverlaufOpen] = useState(false)

  const [settingsPhone, setSettingsPhone] = useState('')
  const [ratingDrafts, setRatingDrafts] = useState({}) // { [bookingId]: { experience, punctuality, driving, cleanliness, communication } }
  const [ratingBusyId, setRatingBusyId] = useState(null)
  const [ratingSavedId, setRatingSavedId] = useState(null)

  useEffect(() => {
    setRatingDrafts((prev) => {
      const next = { ...prev }
      for (const b of myBookings) {
        if (!next[b.id]) {
          next[b.id] = {
            experience: b.rating_experience || 0,
            punctuality: b.rating_punctuality || 0,
            driving: b.rating_driving || 0,
            cleanliness: b.rating_cleanliness || 0,
            communication: b.rating_communication || 0,
          }
        }
      }
      return next
    })
  }, [myBookings])

  function ratingDraftFor(b) {
    return ratingDrafts[b.id] || { experience: 0, punctuality: 0, driving: 0, cleanliness: 0, communication: 0 }
  }

  function updateRatingDraft(bookingId, key, value) {
    setRatingDrafts((prev) => ({ ...prev, [bookingId]: { ...prev[bookingId], [key]: value } }))
  }

  async function submitRating(b) {
    const draft = ratingDraftFor(b)
    if (!draft.experience || !draft.punctuality || !draft.driving || !draft.cleanliness || !draft.communication) {
      alert('Bitte alle fünf Kategorien mit 1-5 Sternen bewerten.')
      return
    }
    setRatingBusyId(b.id)
    const { data, error: err } = await supabase.rpc('fn_submit_rating', {
      p_token: token,
      p_booking_id: b.id,
      p_experience: draft.experience,
      p_punctuality: draft.punctuality,
      p_driving: draft.driving,
      p_cleanliness: draft.cleanliness,
      p_communication: draft.communication,
    })
    setRatingBusyId(null)
    if (err || data?.error) {
      alert('Bewertung konnte nicht gespeichert werden.')
      return
    }
    setRatingSavedId(b.id)
    setTimeout(() => setRatingSavedId(null), 1500)
    loadMyBookings()
  }

  const [settingsEmail, setSettingsEmail] = useState('')
  const [settingsMsg, setSettingsMsg] = useState(null)
  const [settingsBusy, setSettingsBusy] = useState(false)

  async function saveProfileSettings(e) {
    e.preventDefault()
    setSettingsBusy(true)
    setSettingsMsg(null)
    const { data, error: err } = await supabase.rpc('fn_person_update_profile', {
      p_token: token,
      p_phone: settingsPhone,
      p_email: settingsEmail,
    })
    setSettingsBusy(false)
    if (err || data?.error) {
      setSettingsMsg({ type: 'error', text: 'Einstellungen konnten nicht gespeichert werden.' })
      return
    }
    setSettingsMsg({ type: 'success', text: 'Einstellungen gespeichert!' })
    setPerson((prev) => ({ ...prev, phone: settingsPhone, email: settingsEmail }))
  }
  const [busy, setBusy] = useState(false)

  const [searchCityInput, setSearchCityInput] = useState('')
  const [searchCountryInput, setSearchCountryInput] = useState(guessCountryFromBrowser())
  const [destCityInput, setDestCityInput] = useState('')
  const [destCountryInput, setDestCountryInput] = useState('')
  const [dateInput, setDateInput] = useState('')
  const [flexDaysInput, setFlexDaysInput] = useState(0)
  const [searchStartCoords, setSearchStartCoords] = useState(null)
  const [searchDestCoords, setSearchDestCoords] = useState(null)
  const [radiusKmStartInput, setRadiusKmStartInput] = useState(10)
  const [radiusKmDestInput, setRadiusKmDestInput] = useState(10)
  const [activeSearch, setActiveSearch] = useState({
    city: '', country: '', destCity: '', destCountry: '', date: '', flexDays: 0,
    startCoords: null, destCoords: null, startRadiusKm: 10, destRadiusKm: 10,
  })
  const [hasSearched, setHasSearched] = useState(false)

  const [startSuggestions, setStartSuggestions] = useState([])
  const [showStartSuggestions, setShowStartSuggestions] = useState(false)
  const [destSuggestions, setDestSuggestions] = useState([])
  const [showDestSuggestions, setShowDestSuggestions] = useState(false)
  const startDebounceRef = useRef(null)
  const destDebounceRef = useRef(null)

  function handleStartCityChange(value) {
    setSearchCityInput(value)
    setSearchStartCoords(null)
    setShowStartSuggestions(true)
    if (startDebounceRef.current) clearTimeout(startDebounceRef.current)
    startDebounceRef.current = setTimeout(async () => {
      setStartSuggestions(await fetchPlaceSuggestions(value))
    }, 450)
  }

  function selectStartSuggestion(s) {
    setSearchCityInput(s.city)
    setSearchCountryInput(s.country)
    setSearchStartCoords(s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null)
    setShowStartSuggestions(false)
    setStartSuggestions([])
  }

  function handleDestCityChange(value) {
    setDestCityInput(value)
    setSearchDestCoords(null)
    setShowDestSuggestions(true)
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current)
    destDebounceRef.current = setTimeout(async () => {
      setDestSuggestions(await fetchPlaceSuggestions(value))
    }, 450)
  }

  function selectDestSuggestion(s) {
    setDestCityInput(s.city)
    setDestCountryInput(s.country)
    setSearchDestCoords(s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null)
    setShowDestSuggestions(false)
    setDestSuggestions([])
  }

  function runSearch(e) {
    e?.preventDefault()
    setAlertSaved(false)
    setActiveSearch({
      city: searchCityInput.trim(),
      country: searchCountryInput.trim(),
      destCity: destCityInput.trim(),
      destCountry: destCountryInput.trim(),
      date: dateInput,
      flexDays: flexDaysInput,
      startCoords: searchStartCoords,
      destCoords: searchDestCoords,
      startRadiusKm: radiusKmStartInput,
      destRadiusKm: radiusKmDestInput,
    })
    setHasSearched(true)
  }

  function resetSearch() {
    setSearchCityInput('')
    setDestCityInput('')
    setDestCountryInput('')
    setDateInput('')
    setFlexDaysInput(0)
    setSearchStartCoords(null)
    setSearchDestCoords(null)
    setRadiusKmStartInput(10)
    setRadiusKmDestInput(10)
    setActiveSearch({
      city: '', country: '', destCity: '', destCountry: '', date: '', flexDays: 0,
      startCoords: null, destCoords: null, startRadiusKm: 10, destRadiusKm: 10,
    })
    setHasSearched(false)
  }

  // Ein Stopp gilt als Treffer, wenn der Name (+ ggf. Land) passt, ODER —
  // falls ein Ort aus den Vorschlägen gewählt wurde — wenn er innerhalb des
  // gewählten km-Radius liegt.
  function stopMatchesQuery(stop, query, countryQuery, coords, radiusKm) {
    const nameOk = !query || stop.name?.toLowerCase().includes(query.toLowerCase())
    const countryOk = !countryQuery || (stop.country || '').toLowerCase().includes(countryQuery.toLowerCase())
    if (nameOk && countryOk) return true
    if (radiusKm > 0 && coords && stop.latitude != null && stop.longitude != null) {
      return haversineKm(coords.lat, coords.lon, stop.latitude, stop.longitude) <= radiusKm
    }
    return false
  }

  function tripMatchesSearch(trip) {
    // Grundsätzlich nie Fahrten vor heute anzeigen (Server filtert bereits
    // serverseitig, das hier ist eine zusätzliche clientseitige Absicherung,
    // v.a. relevant bei der Flexibilitäts-Suche mit "früher"-Option).
    if (trip.trip_date < todayIso()) return false

    const stops = trip.stops || []
    const fromCandidates = stops.filter((s) =>
      stopMatchesQuery(s, activeSearch.city, activeSearch.country, activeSearch.startCoords, activeSearch.startRadiusKm)
    )
    const toCandidates = stops.filter((s) =>
      stopMatchesQuery(s, activeSearch.destCity, activeSearch.destCountry, activeSearch.destCoords, activeSearch.destRadiusKm)
    )
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

  const [alertBusy, setAlertBusy] = useState(false)
  const [alertSaved, setAlertSaved] = useState(false)
  const [mySearchAlerts, setMySearchAlerts] = useState([])
  const [deletingAlertId, setDeletingAlertId] = useState(null)

  const loadMySearchAlerts = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('fn_list_my_search_alerts', { p_token: token })
    setMySearchAlerts(data?.alerts || [])
  }, [token])

  useEffect(() => { loadMySearchAlerts() }, [loadMySearchAlerts])

  async function deleteSearchAlert(id) {
    if (!confirm('Diesen Suchauftrag wirklich löschen?')) return
    setDeletingAlertId(id)
    await supabase.rpc('fn_delete_search_alert', { p_token: token, p_alert_id: id })
    setDeletingAlertId(null)
    loadMySearchAlerts()
  }

  async function createSearchAlert() {
    if (!activeSearch.startCoords || !activeSearch.destCoords) return
    setAlertBusy(true)
    const { data, error: err } = await supabase.rpc('fn_create_search_alert', {
      p_token: token,
      p_start_lat: activeSearch.startCoords.lat,
      p_start_lon: activeSearch.startCoords.lon,
      p_start_label: activeSearch.city,
      p_dest_lat: activeSearch.destCoords.lat,
      p_dest_lon: activeSearch.destCoords.lon,
      p_dest_label: activeSearch.destCity,
    })
    setAlertBusy(false)
    if (err || data?.error) {
      alert('Suchauftrag konnte nicht gespeichert werden.')
      return
    }
    setAlertSaved(true)
    loadMySearchAlerts()
  }

  // Abweichung (in Tagen) zwischen gesuchtem Datum und tatsächlichem
  // Fahrtdatum, für den Hinweistext bei flexibler Datumssuche.
  function dateOffsetHint(trip) {
    if (!activeSearch.date) return null
    const target = new Date(activeSearch.date + 'T00:00:00')
    const tripD = new Date(trip.trip_date + 'T00:00:00')
    const diffDays = Math.round((tripD - target) / 86400000)
    if (diffDays === 0) return null
    const n = Math.abs(diffDays)
    const dayWord = n === 1 ? 'Tag' : 'Tage'
    const direction = diffDays > 0 ? 'später' : 'früher'
    return `Diese Fahrt findet ${n} ${dayWord} ${direction} statt als gesucht.`
  }

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
    setSettingsPhone(data.person?.phone || '')
    setSettingsEmail(data.person?.email || '')
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
    const fromName = tripDetails?.stops.find((s) => s.id === fromStop)?.name
    const toName = tripDetails?.stops.find((s) => s.id === toStop)?.name
    const message = [
      `Hallo ${tripDetails?.driver_name || ''}!`.replace('Hallo !', 'Hallo!'),
      `Ich habe soeben ${seats} Platz/Plätze für die Fahrt ${selectedTrip?.route_name} am ${formatDate(selectedTrip?.trip_date)} (${formatTime(selectedTrip?.start_time)} Uhr) gebucht.`,
      `Abschnitt: ${fromName} → ${toName}`,
      `Mitfahrbeitrag: EUR ${data.price}`,
      `Viele Grüße, ${person?.name || ''}`,
    ].join('\n')
    setLastBookingNotify({ phone: tripDetails?.driver_phone, message })

    console.log('[E-Mail] Buchung abgeschlossen — geprüfte Adressen:', {
      driver_email: tripDetails?.driver_email ?? '(keine hinterlegt)',
      person_email: person?.email ?? '(keine hinterlegt)',
    })

    const emailNotes = []
    if (person?.email) emailNotes.push('du erhältst eine Bestätigung per E-Mail')
    if (tripDetails?.driver_email) emailNotes.push('der Fahrer wurde per E-Mail informiert')
    const emailHint = emailNotes.length > 0 ? ` (${emailNotes.join(' und ')}.)` : ''
    setBookingMsg({ type: 'success', text: `Platz erfolgreich gebucht! Mitfahrbeitrag: EUR ${data.price}${emailHint}` })

    if (tripDetails?.driver_email) {
      sendEmailNotification(
        tripDetails.driver_email,
        `Neue Buchung: ${selectedTrip?.route_name}`,
        message
      )
    }
    if (person?.email) {
      sendEmailNotification(
        person.email,
        `Buchungsbestätigung: ${selectedTrip?.route_name}`,
        [
          `Hallo ${person.name}!`,
          `Deine Buchung wurde bestätigt.`,
          `Fahrt: ${selectedTrip?.route_name} am ${formatDate(selectedTrip?.trip_date)} (${formatTime(selectedTrip?.start_time)} Uhr)`,
          `Abschnitt: ${fromName} → ${toName}`,
          `Mitfahrbeitrag: EUR ${data.price}`,
          `Fahrer: ${tripDetails?.driver_name || '—'}`,
        ].join('\n')
      )
    }

    setFromStop('')
    setToStop('')
    reloadTripDetails(selectedTrip)
    loadMyBookings()
    refreshTrips()
  }

  async function cancelBooking(id) {
    if (!confirm('Buchung wirklich stornieren?')) return
    const b = myBookings.find((x) => x.id === id)
    await supabase.rpc('fn_cancel_booking', { p_token: token, p_booking_id: id })
    loadMyBookings()
    refreshTrips()
    if (selectedTrip) openTrip(selectedTrip)

    console.log('[E-Mail] Stornierung abgeschlossen — geprüfte Fahrer-Adresse:', b?.driver_email ?? '(keine hinterlegt)')

    if (b?.driver_email) {
      sendEmailNotification(
        b.driver_email,
        `Buchung storniert: ${b.route_name}`,
        [
          `Hallo ${b.driver_name || ''}!`.replace('Hallo !', 'Hallo!'),
          `${person?.name || 'Ein Mitfahrer'} hat die Buchung für deine Fahrt storniert.`,
          `Fahrt: ${b.route_name} am ${formatDate(b.trip_date)} (${formatTime(b.start_time)} Uhr)`,
          `Abschnitt: ${b.from_stop} → ${b.to_stop} · ${b.seats} Platz/Plätze`,
        ].join('\n')
      )
    }
  }

  const [signupRole, setSignupRole] = useState(null) // null | 'mitfahrer' | 'fahrer'
  const [showLandingDetails, setShowLandingDetails] = useState(false)
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
          <Logo height={40} />
          <p>Willkommen 👋</p>
        </div>
        <div className="container">
          {!signupRole && !signupResult && (
            <div className="card">
              <p style={{ margin: '0 0 12px' }}>
                Du möchtest einfach eine Mitfahrgelegenheit buchen? Oder als Fahrer deine
                freien Plätze anbieten, um Fahrtkosten zu teilen und neue Leute kennenzulernen?
                Dann bist du hier genau richtig!
              </p>
              <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Schön, dass du da bist — gute Fahrt!</p>

              <button
                className="secondary"
                style={{ width: '100%', marginBottom: showLandingDetails ? 12 : 0 }}
                onClick={() => setShowLandingDetails(!showLandingDetails)}
              >
                {showLandingDetails ? 'Weniger anzeigen' : 'Warum - Wie - Kosten'}
              </button>

              {showLandingDetails && (
                <>
                  <p style={{ margin: '0 0 12px' }}>
                    Ich habe diese Plattform ins Leben gerufen, um eine schlanke, preiswerte und
                    unkomplizierte Alternative zu den grossen Anbietern zu schaffen. Für Mitfahrer
                    ist die Nutzung komplett gebührenfrei. Ganz umsonst lässt sich ein solches
                    Projekt im Hintergrund aber leider nicht betreiben.
                  </p>
                  <p style={{ margin: '0 0 12px' }}>
                    Damit die Webseite rund um die Uhr sicher online bleibt, fallen laufende
                    Kosten an — zum Beispiel für die Domain, das Webhosting, verschlüsselte
                    SSL-Zertifikate, den automatischen E-Mail-Versand (Buchungsbestätigungen)
                    sowie für Rechtstexte und die Transaktionsgebühren der Zahlungsanbieter.
                  </p>
                  <p style={{ margin: '0 0 8px' }}>
                    Um diese Ausgaben fair zu decken, setzen wir auf ein einfaches
                    Unterstützer-Modell:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li style={{ marginBottom: 8 }}>
                      Als Fahrer schliesst du für lediglich 1 € pro Monat ein kleines Abo ab.
                      Damit kannst du flexibel Fahrten für den laufenden und den Folgemonat
                      veröffentlichen.
                    </li>
                    <li>
                      Als Mitfahrer buchst du komplett kostenlos. Wenn dir der Dienst gefällt,
                      freuen wir uns natürlich über ein freiwilliges Trinkgeld.
                    </li>
                  </ul>
                </>
              )}
            </div>
          )}

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
                <input type="tel" value={signupPhone} onChange={(e) => setSignupPhone(e.target.value)} placeholder="z.B. +41 79 123 45 67" required />
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
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to="/impressum" target="_blank" style={{ fontSize: 13 }}>Impressum</Link>
          </div>
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
        <div className="app-header-text">
          <Logo height={36} />
          <p>Hallo {person?.name} 👋</p>
        </div>
        <BuyMeACoffeeBadge active={person?.bmc_subscription_active} projectLink={person?.project_buymeacoffee_link} onGoToSettings={() => setTab('settings')} />
      </div>

      <div className="container">
        <div className="tabs">
          <button className={tab === 'trips' ? 'active' : ''} onClick={() => { setTab('trips'); setSelectedTrip(null) }}>
            Fahrten
          </button>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            Meine Buchungen
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            Einstellungen
          </button>
        </div>

        {tab === 'trips' && !selectedTrip && (
          <>
            <form onSubmit={runSearch} className="card">
              <label>Umkreis um den Startort: ± {radiusKmStartInput} km</label>
              <input
                type="range"
                min={10}
                max={50}
                step={10}
                value={radiusKmStartInput}
                onChange={(e) => setRadiusKmStartInput(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <label style={{ marginTop: 12 }}>Startort</label>
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
              {!searchStartCoords && (
                <div className="meta" style={{ marginTop: 6, marginBottom: 10 }}>
                  Umkreis wirkt nur, wenn der Startort aus den Vorschlägen ausgewählt wird.
                </div>
              )}
              <label>Startland</label>
              <input
                value={searchCountryInput}
                onChange={(e) => setSearchCountryInput(e.target.value)}
                placeholder="z.B. Schweiz"
              />

              <label style={{ marginTop: 20 }}>Umkreis um den Zielort: ± {radiusKmDestInput} km</label>
              <input
                type="range"
                min={10}
                max={50}
                step={10}
                value={radiusKmDestInput}
                onChange={(e) => setRadiusKmDestInput(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <label style={{ marginTop: 12 }}>Zielort</label>
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
              {!searchDestCoords && (
                <div className="meta" style={{ marginTop: 6, marginBottom: 10 }}>
                  Umkreis wirkt nur, wenn der Zielort aus den Vorschlägen ausgewählt wird.
                </div>
              )}
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
                min={todayIso()}
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

            {hasSearched && (
              <div className="card">
                {!person?.email ? (
                  <div className="meta">
                    🔔 Um bei neuen passenden Fahrten per E-Mail informiert zu werden, hinterlege zuerst
                    eine E-Mail-Adresse im Tab „Einstellungen".
                  </div>
                ) : activeSearch.startCoords && activeSearch.destCoords ? (
                  <button
                    type="button"
                    className={alertSaved ? 'secondary' : ''}
                    style={{ width: '100%' }}
                    disabled={alertBusy || alertSaved}
                    onClick={createSearchAlert}
                  >
                    {alertSaved
                      ? '✓ Du wirst benachrichtigt, sobald eine passende Fahrt eingestellt wird'
                      : alertBusy
                        ? 'Wird gespeichert …'
                        : '🔔 Informiere mich, wenn neue Fahrten eingestellt werden!'}
                  </button>
                ) : (
                  <div className="meta">
                    🔔 Um bei neuen passenden Fahrten per E-Mail informiert zu werden, wähle Start- und
                    Zielort oben aus den Vorschlägen aus (nicht nur eintippen).
                  </div>
                )}
              </div>
            )}

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
              const soldOut = avail <= 0
              const closedWithSeats = t.closed && !soldOut
              const label = seg
                ? (soldOut ? `Ausgebucht für ${seg.from.name} → ${seg.to.name}` : `${avail} Platz/Plätze frei für ${seg.from.name} → ${seg.to.name}`)
                : (soldOut ? 'Ausgebucht' : `${avail} von ${t.total_seats} Plätzen frei`)
              const dateHint = dateOffsetHint(t)
              return (
                <div className="card" key={t.id}>
                  <h3>{t.route_name}{t.via_stops && ` (via ${t.via_stops})`}</h3>
                  <div className="meta">{formatDate(t.trip_date)} · {formatTime(t.start_time)} Uhr</div>
                  {t.car_name && <div className="meta">🚗 {t.car_name}{t.car_notes ? ` (${t.car_notes})` : ''}</div>}
                  {t.driver_name && (
                    <div className="meta">
                      👤 {t.driver_name}{t.driver_phone ? ` · ${t.driver_phone}` : ''}
                      {whatsappLink(t.driver_phone) && (
                        <a href={whatsappLink(t.driver_phone)} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }} onClick={(e) => e.stopPropagation()}>
                          💬 WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                  {dateHint && <div className="notice" style={{ background: '#fff4e0', color: '#8a5a00', marginTop: 8 }}>{dateHint}</div>}
                  {closedWithSeats && (
                    <div className="notice error" style={{ marginTop: 8 }}>
                      Die Rest-Plätze dieser Fahrt sind auf dieser Plattform nicht mehr buchbar. Diese können
                      evtl. auf alternativen professionellen Plattformen gebucht werden.
                    </div>
                  )}
                  <div style={{ margin: '8px 0' }}>
                    <span className={`badge ${soldOut || closedWithSeats ? 'full' : ''}`}>{label}</span>
                  </div>
                  <button style={{ width: '100%' }} onClick={() => openTrip(t)}>
                    {t.closed ? 'Details ansehen' : 'Buchen'}
                  </button>
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
            {tripDetails.driver_name && (
              <div className="meta">
                👤 {tripDetails.driver_name}{tripDetails.driver_phone ? ` · ${tripDetails.driver_phone}` : ''}
                {whatsappLink(tripDetails.driver_phone) && (
                  <a href={whatsappLink(tripDetails.driver_phone)} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
                    💬 WhatsApp
                  </a>
                )}
              </div>
            )}
            {tripDetails.driver_payment_info && (
              <div className="meta">💳 Bezahlung: {
                /^https?:\/\//i.test(tripDetails.driver_payment_info)
                  ? <a href={tripDetails.driver_payment_info} target="_blank" rel="noreferrer">{tripDetails.driver_payment_info}</a>
                  : tripDetails.driver_payment_info
              }</div>
            )}
            {tripDetails.closed && (
              <div className="notice" style={{ background: '#fff4e0', color: '#8a5a00', marginTop: 8 }}>
                Diese Fahrt ist geschlossen — noch freie Restplätze können auf alternativen professionellen Plattformen gebucht werden.
              </div>
            )}

            <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
              <div className="meta" style={{ marginBottom: 4, fontWeight: 600 }}>Bewertungen des Fahrers</div>
              <StarDisplaySummary rating={tripDetails.driver_rating} />
            </div>

            <details style={{ marginTop: 10 }} onToggle={(e) => setStreckenverlaufOpen(e.target.open)}>
              <summary style={{ fontSize: 13, color: 'var(--color-muted)', fontWeight: 600 }}>
                <span className="summary-chevron">▶</span> Streckenverlauf & Adressen anzeigen
              </summary>
              {streckenverlaufOpen && (
                <>
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
                  <div style={{ marginTop: 12 }}>
                    <RouteMap stops={tripDetails.stops} />
                    {googleMapsRouteUrl(tripDetails.stops) && (
                      <a href={googleMapsRouteUrl(tripDetails.stops)} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 8 }}>
                        <button type="button" className="secondary" style={{ width: '100%' }}>🗺️ Komplette Route in Google Maps öffnen</button>
                      </a>
                    )}
                  </div>
                </>
              )}
            </details>

            {bookingMsg && <div className={`notice ${bookingMsg.type}`} style={{ margin: '12px 0' }}>{bookingMsg.text}</div>}
            {bookingMsg?.type === 'success' && lastBookingNotify && whatsappLink(lastBookingNotify.phone, lastBookingNotify.message) && (
              <a href={whatsappLink(lastBookingNotify.phone, lastBookingNotify.message)} target="_blank" rel="noreferrer">
                <button type="button" style={{ width: '100%', marginBottom: 12 }}>💬 Fahrer per WhatsApp informieren</button>
              </a>
            )}

            {!fromStop || !toStop ? (
              <>
                <h3 style={{ marginTop: 16 }}>Verbindung wählen</h3>
                {allSegments().map((seg) => {
                  const avail = availableSeatsFor(seg.from.order_index, seg.to.order_index)
                  const price = priceFor(seg.from.order_index, seg.to.order_index)
                  const soldOut = avail <= 0
                  const blocked = soldOut || tripDetails.closed
                  const distDur = distanceDurationFor(seg.from.order_index, seg.to.order_index)
                  const departure = etaAt(seg.from.order_index)
                  const arrival = etaAt(seg.to.order_index)
                  let badgeText
                  if (soldOut) badgeText = 'Ausgebucht'
                  else badgeText = `${avail} Platz/Plätze frei`
                  return (
                    <div
                      key={`${seg.from.id}-${seg.to.id}`}
                      className="card"
                      style={{
                        marginBottom: 8,
                        cursor: blocked ? 'default' : 'pointer',
                        opacity: blocked ? 0.55 : 1,
                        background: blocked ? '#eceef0' : undefined,
                      }}
                      onClick={() => { if (!blocked) { setFromStop(seg.from.id); setToStop(seg.to.id); setSeats(1) } }}
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
                      {tripDetails.closed && !soldOut && (
                        <div className="notice error" style={{ marginTop: 8 }}>
                          Die Rest-Plätze dieser Fahrt sind auf dieser Plattform nicht mehr buchbar. Diese können
                          evtl. auf alternativen professionellen Plattformen gebucht werden.
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        <span className={`badge ${blocked ? 'full' : ''}`}>{badgeText}</span>
                        <span className="badge">EUR {price}</span>
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
                    <span className="badge">Mitfahrbeitrag: EUR {price}</span>
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
                  {b.driver_name && (
                    <div className="meta">
                      👤 {b.driver_name}{b.driver_phone ? ` · ${b.driver_phone}` : ''}
                      {whatsappLink(b.driver_phone) && (
                        <a href={whatsappLink(b.driver_phone)} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
                          💬 WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                  {departure && arrival && (
                    <div className="meta">
                      ab {departure.time}{departure.nextDay ? ' (+1 Tag)' : ''} Uhr · an ca. {arrival.time}{arrival.nextDay ? ' (+1 Tag)' : ''} Uhr
                      {b.distance_km != null && ` · ${b.distance_km} km`}
                    </div>
                  )}
                  <div className="meta">Mitfahrbeitrag: EUR {b.price}</div>
                  <button className="danger" onClick={() => cancelBooking(b.id)}>Stornieren</button>

                  {b.can_rate && (() => {
                    const draft = ratingDraftFor(b)
                    const alreadyRated = b.rating_experience != null
                    return (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                        <div className="meta" style={{ marginBottom: 8, fontWeight: 600 }}>
                          {alreadyRated ? 'Deine Bewertung' : 'Fahrer bewerten'}
                        </div>
                        {RATING_CATEGORIES.map((c) => (
                          <div key={c.key} style={{ marginBottom: 8 }}>
                            <label style={{ margin: '0 0 4px' }}>{c.label}</label>
                            <StarInput value={draft[c.key]} onChange={(v) => updateRatingDraft(b.id, c.key, v)} />
                          </div>
                        ))}
                        <button
                          className="secondary"
                          style={{ width: '100%', marginTop: 6 }}
                          disabled={ratingBusyId === b.id}
                          onClick={() => submitRating(b)}
                        >
                          {ratingBusyId === b.id ? 'Wird gespeichert …' : ratingSavedId === b.id ? '✓ Gespeichert' : alreadyRated ? 'Bewertung aktualisieren' : 'Bewertung senden'}
                        </button>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </>
        )}

        {tab === 'settings' && (
          <div className="card">
            <h3>⚙️ Meine Einstellungen</h3>
            <div style={{ margin: '10px 0', padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
              <div className="meta" style={{ marginBottom: 4, fontWeight: 600 }}>Deine Bewertungen</div>
              {person?.rating?.count
                ? (
                  <>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: '#f0a500', fontSize: 16 }}>★</span>{' '}
                      <strong>{person.rating.avg_overall}</strong>{' '}
                      <span className="meta">({person.rating.count} Bewertung{person.rating.count === 1 ? '' : 'en'})</span>
                    </div>
                    <div className="meta">
                      Pünktlichkeit {person.rating.avg_punctuality} · Sauberkeit {person.rating.avg_cleanliness} · Kommunikation {person.rating.avg_communication}
                    </div>
                  </>
                )
                : <div className="meta">Noch keine Bewertungen.</div>}
            </div>
            <form onSubmit={saveProfileSettings} style={{ marginTop: 12 }}>
              <label>Mobilnummer</label>
              <input type="tel" value={settingsPhone} onChange={(e) => setSettingsPhone(e.target.value)} placeholder="z.B. +41 79 123 45 67" />
              <div className="meta" style={{ marginTop: -8, marginBottom: 10 }}>
                Bitte mit Ländervorwahl (z.B. +41) angeben, damit der WhatsApp-Kontakt-Link korrekt funktioniert.
              </div>
              <label>E-Mail</label>
              <input type="email" value={settingsEmail} onChange={(e) => setSettingsEmail(e.target.value)} placeholder="deine@email.ch" />
              <div style={{ margin: '10px 0', padding: '10px 12px', background: '#f0f2f4', borderRadius: 10 }}>
                <div className="meta" style={{ fontWeight: 600, marginBottom: 4 }}>☕ Buy Me a Coffee</div>
                <div className="meta">
                  Status: {person?.bmc_subscription_active ? 'aktiv' : 'nicht aktiv'}
                  {person?.bmc_last_payment_date && ` · letztes Zahldatum ${person.bmc_last_payment_date}`}
                </div>
                <div className="meta" style={{ marginTop: 2, fontStyle: 'italic' }}>
                  Wird vom Admin gepflegt, sobald die Unterstützung aktiv ist.
                </div>
              </div>
              {settingsMsg && <div className={`notice ${settingsMsg.type}`} style={{ marginTop: 12 }}>{settingsMsg.text}</div>}
              <button style={{ marginTop: 12, width: '100%' }} disabled={settingsBusy}>
                {settingsBusy ? 'Wird gespeichert …' : 'Einstellungen speichern'}
              </button>
            </form>
          </div>
        )}

        {tab === 'settings' && (
          <div className="card">
            <h3>🔔 Meine Suchaufträge</h3>
            <div className="meta" style={{ marginBottom: 10 }}>
              Bei diesen Suchen wirst du per E-Mail informiert, sobald eine passende neue Fahrt eingestellt wird.
            </div>
            {mySearchAlerts.length === 0 && <div className="empty-state">Noch keine Suchaufträge gespeichert.</div>}
            {mySearchAlerts.map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div>
                  <div>{a.start_label || '—'} → {a.dest_label || '—'}</div>
                  <div className="meta">± {a.radius_km} km · gespeichert am {formatDate(a.created_at.slice(0, 10))}</div>
                </div>
                <button className="danger" style={{ padding: '6px 10px' }} onClick={() => deleteSearchAlert(a.id)} disabled={deletingAlertId === a.id}>
                  {deletingAlertId === a.id ? '…' : 'Löschen'}
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <Link to="/impressum" target="_blank" style={{ fontSize: 13 }}>Impressum</Link>
        </div>
      </div>
    </>
  )
}
