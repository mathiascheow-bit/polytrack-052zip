import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

interface LeaderboardEntry {
  id: number
  user_id: number
  track_id: string
  frames: number
  verified_state: number
  created_at: string
  users?: { name: string; car_colors: string }
}

interface Banner {
  id: number
  message: string
  duration: number
  frequency: number
  created_at: string
}

interface GameState {
  playerName: string
  userToken: string
  selectedTrack: string | null
  isRacing: boolean
  currentTime: number
}

function App() {
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [gameState, setGameState] = useState<GameState>({
    playerName: '',
    userToken: localStorage.getItem('polytrack_token') || generateToken(),
    selectedTrack: null,
    isRacing: false,
    currentTime: 0,
  })
  const [raceTimer, setRaceTimer] = useState<ReturnType<typeof setInterval> | null>(null)

  function generateToken(): string {
    const chars = '0123456789abcdef'
    let token = ''
    for (let i = 0; i < 64; i++) {
      token += chars[Math.floor(Math.random() * 16)]
    }
    localStorage.setItem('polytrack_token', token)
    return token
  }

  useEffect(() => {
    const initializeGame = async () => {
      try {
        await supabase.from('users').select('count')
        setConnected(true)

        const { data: leaderboardData } = await supabase
          .from('leaderboard')
          .select('*, users!inner(name, car_colors)')
          .order('frames', { ascending: true })
          .limit(10)

        if (leaderboardData) {
          setLeaderboard(leaderboardData)
        }

        const { data: bannerData } = await supabase
          .from('banners')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)

        if (bannerData?.length) {
          setBanner(bannerData[0])
        }
      } catch (err) {
        console.error('Initialization error:', err)
      } finally {
        setLoading(false)
      }
    }

    initializeGame()
  }, [])

  useEffect(() => {
    if (gameState.isRacing) {
      const timer = setInterval(() => {
        setGameState(prev => ({ ...prev, currentTime: prev.currentTime + 16.67 }))
      }, 16.67)
      setRaceTimer(timer)
      return () => clearInterval(timer)
    }
  }, [gameState.isRacing])

  const handleStartGame = () => {
    if (gameState.selectedTrack) {
      setGameState(prev => ({ ...prev, isRacing: true, currentTime: 0 }))
    }
  }

  const handleEndGame = async (frames: number) => {
    if (!gameState.selectedTrack) return

    if (raceTimer) clearInterval(raceTimer)

    try {
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('user_token', gameState.userToken)
        .maybeSingle()

      let userId = userData?.id

      if (!userId) {
        const tokenHash = await hashToken(gameState.userToken)
        const { data: newUser } = await supabase
          .from('users')
          .insert({
            user_token: gameState.userToken,
            token_hash: tokenHash,
            name: gameState.playerName || 'Player',
            car_colors: 'ff0000ff0000ff0000ff0000',
          })
          .select()
          .single()

        userId = newUser?.id
      }

      if (userId) {
        await supabase.from('leaderboard').upsert({
          user_id: userId,
          track_id: gameState.selectedTrack,
          frames,
          verified_state: 0,
        })

        const { data: updated } = await supabase
          .from('leaderboard')
          .select('*, users!inner(name, car_colors)')
          .order('frames', { ascending: true })
          .limit(10)

        if (updated) setLeaderboard(updated)
      }

      setGameState(prev => ({ ...prev, isRacing: false }))
    } catch (err) {
      console.error('Error saving race:', err)
    }
  }

  async function hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '1rem',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
          borderBottom: '2px solid #00d4ff',
          paddingBottom: '1rem',
        }}>
          <h1 style={{ margin: 0, fontSize: '2.5rem', color: '#00d4ff' }}>
            POLYTRACK
          </h1>
          <div>
            <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.7 }}>Status</p>
            <p style={{
              margin: 0,
              color: connected ? '#4ade80' : '#ef4444',
              fontWeight: 'bold',
            }}>
              {loading ? 'Loading...' : connected ? 'Connected' : 'Offline'}
            </p>
          </div>
        </div>

        {banner && (
          <div style={{
            background: 'rgba(0, 255, 255, 0.1)',
            border: '2px solid #00ffff',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '2rem',
            boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)',
          }}>
            <p style={{ margin: 0, fontSize: '1.1rem' }}>{banner.message}</p>
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 350px',
          gap: '2rem',
          marginBottom: '2rem',
        }}>
          <div style={{
            background: 'rgba(0, 20, 40, 0.8)',
            border: '2px solid #00d4ff',
            borderRadius: '12px',
            padding: '1.5rem',
            minHeight: '500px',
          }}>
            <h2 style={{ marginTop: 0, color: '#00d4ff' }}>Game</h2>

            {!gameState.isRacing ? (
              <div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                    Player Name
                  </label>
                  <input
                    type="text"
                    value={gameState.playerName}
                    onChange={e => setGameState(prev => ({ ...prev, playerName: e.target.value }))}
                    placeholder="Enter your name"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#0a1628',
                      border: '1px solid #00d4ff',
                      color: '#fff',
                      borderRadius: '4px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                    Select Track
                  </label>
                  <select
                    value={gameState.selectedTrack || ''}
                    onChange={e => setGameState(prev => ({ ...prev, selectedTrack: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#0a1628',
                      border: '1px solid #00d4ff',
                      color: '#fff',
                      borderRadius: '4px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">Choose a track...</option>
                    <option value="desert1">Desert 1</option>
                    <option value="desert2">Desert 2</option>
                    <option value="summer1">Summer 1</option>
                    <option value="winter1">Winter 1</option>
                  </select>
                </div>

                <button
                  onClick={handleStartGame}
                  disabled={!gameState.selectedTrack}
                  style={{
                    width: '100%',
                    padding: '1rem',
                    background: gameState.selectedTrack ? '#00d4ff' : '#444',
                    color: gameState.selectedTrack ? '#000' : '#666',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    cursor: gameState.selectedTrack ? 'pointer' : 'not-allowed',
                    fontSize: '1.1rem',
                  }}
                >
                  START RACE
                </button>

                <div style={{
                  marginTop: '2rem',
                  padding: '1rem',
                  background: 'rgba(0, 212, 255, 0.1)',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                }}>
                  <p style={{ margin: '0.5rem 0' }}>
                    Token: <code style={{ background: '#000', padding: '0.25rem 0.5rem', borderRadius: '2px' }}>
                      {gameState.userToken.substring(0, 16)}...
                    </code>
                  </p>
                  <p style={{ margin: 0, opacity: 0.7 }}>
                    Fully synced with Supabase
                  </p>
                </div>
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '400px',
              }}>
                <h3 style={{ margin: '1rem 0' }}>Race in Progress</h3>
                <p style={{ fontSize: '3rem', color: '#00d4ff', margin: '1rem 0' }}>
                  {(gameState.currentTime / 1000).toFixed(2)}s
                </p>
                <p style={{ opacity: 0.7 }}>Track: {gameState.selectedTrack}</p>
                <button
                  onClick={() => handleEndGame(Math.floor(gameState.currentTime / 16.67))}
                  style={{
                    marginTop: '2rem',
                    padding: '0.75rem 2rem',
                    background: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  FINISH RACE
                </button>
              </div>
            )}
          </div>

          <div style={{
            background: 'rgba(0, 20, 40, 0.8)',
            border: '2px solid #00d4ff',
            borderRadius: '12px',
            padding: '1.5rem',
            height: 'fit-content',
            maxHeight: '600px',
          }}>
            <h3 style={{ marginTop: 0, color: '#00d4ff' }}>Leaderboard</h3>
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {leaderboard.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {leaderboard.map((entry, idx) => (
                    <li
                      key={entry.id}
                      style={{
                        padding: '0.75rem 0',
                        borderBottom: '1px solid rgba(0, 212, 255, 0.2)',
                        fontSize: '0.9rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#00d4ff' }}>#{idx + 1}</span>
                        <span>{entry.users?.name || 'Anonymous'} - {entry.frames}f</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ opacity: 0.7, textAlign: 'center' }}>No scores yet</p>
              )}
            </div>
          </div>
        </div>

        <div style={{
          textAlign: 'center',
          opacity: 0.6,
          fontSize: '0.85rem',
          marginTop: '2rem',
        }}>
          <p>Fully integrated with Supabase</p>
        </div>
      </div>
    </div>
  )
}

export default App
