import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import Logo from '../components/Logo'

export default function ImpressumPage() {
  const [text, setText] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.rpc('fn_get_app_setting', { p_key: 'impressum' }).then(({ data }) => {
      setText(data || '')
      setLoaded(true)
    })
  }, [])

  return (
    <>
      <div className="app-header">
        <div className="app-header-text">
          <Logo height={36} />
          <p>Impressum</p>
        </div>
      </div>
      <div className="container">
        <div className="card">
          {!loaded && <div className="meta">Lädt …</div>}
          {loaded && !text && (
            <div className="meta">
              Der Betreiber hat hier noch keine Angaben hinterlegt. Diese lassen sich im Admin-Bereich
              unter „Einstellungen" → „Impressum" eintragen.
            </div>
          )}
          {loaded && text && (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>{text}</div>
          )}
          <Link to="/" style={{ display: 'block', marginTop: 20 }}>← Zurück</Link>
        </div>
      </div>
    </>
  )
}
