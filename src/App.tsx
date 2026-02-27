import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const [connected, setConnected] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { error } = await supabase.from('_healthcheck').select('*').limit(1)
        if (!error || error.code === '42P01') {
          setConnected(true)
        }
      } catch (err) {
        console.error('Connection error:', err)
      } finally {
        setLoading(false)
      }
    }

    checkConnection()
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      <h1>Supabase Connection</h1>
      {loading ? (
        <p>Checking connection...</p>
      ) : connected ? (
        <p style={{ color: '#10b981' }}>✓ Successfully connected to Supabase</p>
      ) : (
        <p style={{ color: '#ef4444' }}>✗ Unable to connect to Supabase</p>
      )}
    </div>
  )
}

export default App
