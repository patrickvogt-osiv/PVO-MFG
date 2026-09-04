import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import InvitePage from './pages/InvitePage'
import DriverPage from './pages/DriverPage'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import ImpressumPage from './pages/ImpressumPage'

function AdminArea() {
  const [session, setSession] = useState(undefined) // undefined = wird geladen

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="container empty-state">Lädt …</div>
  if (!session) return <AdminLogin onLoggedIn={() => {}} />
  return <AdminDashboard />
}

export default function App() {
  return (
    <Routes>
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/driver/:token" element={<DriverPage />} />
      <Route path="/admin" element={<AdminArea />} />
      <Route path="/impressum" element={<ImpressumPage />} />
      <Route path="/" element={<InvitePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
