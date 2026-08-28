import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function AdminLogin({ onLoggedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (err) {
      setError('Anmeldung fehlgeschlagen. E-Mail/Passwort prüfen.')
      return
    }
    onLoggedIn()
  }

  return (
    <div className="container">
      <div className="card">
        <h3>Admin-Anmeldung</h3>
        <form onSubmit={submit}>
          <label>E-Mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Passwort</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}
          <button style={{ marginTop: 14, width: '100%' }} disabled={busy}>
            {busy ? 'Prüfe …' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  )
}
