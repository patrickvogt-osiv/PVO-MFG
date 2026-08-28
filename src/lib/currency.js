// Kostenlose Wechselkurse (EZB-Referenzkurse) über frankfurter.dev — kein
// API-Key nötig. Ergebnisse werden 12 Stunden im Browser zwischengespeichert,
// um nicht bei jeder Eingabe neu abzufragen.

const CACHE_TTL_MS = 12 * 60 * 60 * 1000

export async function getEuroExchangeRate(toCurrency) {
  const code = (toCurrency || '').toUpperCase().trim()
  if (!code || code === 'EUR') return 1

  const cacheKey = `fahrt-buchung:fx:${code}`
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.rate
  } catch {
    // Cache ignorieren, wenn beschädigt
  }

  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=EUR&to=${code}`)
    if (!res.ok) return null
    const data = await res.json()
    const rate = data.rates?.[code]
    if (!rate) return null
    localStorage.setItem(cacheKey, JSON.stringify({ rate, ts: Date.now() }))
    return rate
  } catch {
    return null
  }
}

export function formatConverted(amountEur, rate, currency) {
  if (rate == null || !currency || amountEur == null || Number.isNaN(amountEur)) return ''
  const converted = amountEur * rate
  const rounded = Math.round(converted * 100) / 100
  return `${rounded.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`
}
