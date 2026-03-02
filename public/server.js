const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const pako = require('pako');

const app = express();
const PORT = 3000;

// Log environment
console.log('🔍 Checking environment...');
console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('ADMIN_PASSWORD set:', !!process.env.ADMIN_PASSWORD);

if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL is not set in .env file');
  process.exit(1);
}

if (!process.env.ADMIN_PASSWORD) {
  console.error('❌ ERROR: ADMIN_PASSWORD is not set in .env file');
  process.exit(1);
}

// Create pool with proper Replit configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'polytrack_app'
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

pool.on('connect', () => {
  console.log('✅ New database connection established');
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/leaderboard') || req.path.startsWith('/user') || req.path.startsWith('/recordings')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// Official track filenames
const OFFICIAL_TRACK_FILES = [
  "desert1.track", "desert2.track", "desert3.track", "desert4.track",
  "summer1.track", "summer2.track", "summer3.track", "summer4.track", 
  "summer5.track", "summer6.track", "summer7.track",
  "winter1.track", "winter2.track", "winter3.track", "winter4.track",
  "winter5.track"
];

let officialTrackIds = new Set();

async function initDatabase() {
  console.log('🔄 Initializing database...');

  try {
    // Test connection
    const testRes = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');
  } catch (err) {
    console.error('❌ Failed to connect to database:', err.message);
    console.error('Connection string:', process.env.DATABASE_URL);
    throw err;
  }

  try {
    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_settings (
        key VARCHAR(255) PRIMARY KEY,
        value VARCHAR(255) NOT NULL
      )
    `);
    console.log('✅ game_settings table ready');

    const result = await pool.query(`SELECT value FROM game_settings WHERE key = 'locked'`);
    if (result.rows.length === 0) {
      await pool.query(`INSERT INTO game_settings (key, value) VALUES ('locked', 'false')`);
    }

    const countdownResult = await pool.query(`SELECT value FROM game_settings WHERE key = 'countdown_end'`);
    if (countdownResult.rows.length === 0) {
      const endTime = Date.now() + (100 * 60 * 60 * 1000);
      await pool.query(`INSERT INTO game_settings (key, value) VALUES ('countdown_end', $1)`, [endTime.toString()]);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_token VARCHAR(64) UNIQUE NOT NULL,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(50) NOT NULL DEFAULT 'Player',
        car_colors VARCHAR(24) NOT NULL DEFAULT 'ff0000ff0000ff0000ff0000',
        is_verifier BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ users table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        track_id VARCHAR(255) NOT NULL,
        frames INTEGER NOT NULL,
        recording TEXT,
        verified_state INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, track_id)
      )
    `);
    console.log('✅ leaderboard table ready');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_track ON leaderboard(track_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS track_mapping (
        track_id VARCHAR(64) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        is_official BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ track_mapping table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        duration INTEGER NOT NULL,
        frequency INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ banners table ready');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_frames ON leaderboard(track_id, frames)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ chat_messages table ready');

    const trackMappings = await pool.query(`SELECT track_id FROM track_mapping WHERE is_official = TRUE`);
    for (const row of trackMappings.rows) {
      officialTrackIds.add(row.track_id);
    }
    console.log(`✅ Loaded ${officialTrackIds.size} official track IDs from database`);
    console.log('✅ Database fully initialized');
  } catch (err) {
    console.error('❌ Error initializing database:', err.message);
    throw err;
  }
}

// ===== BANNER SYSTEM =====

async function loadBannerOnStartup() {
  try {
    const result = await pool.query('SELECT * FROM banners ORDER BY created_at DESC LIMIT 1');
    if (result.rows.length > 0) {
      console.log("✅ Banner loaded:", result.rows[0].message);
    } else {
      console.log("ℹ️  No banner set");
    }
  } catch (e) {
    console.error("⚠️  Error loading banner:", e.message);
  }
}

app.get('/api/admin/banner/current', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM banners ORDER BY created_at DESC LIMIT 1');
    if (result.rows.length > 0) {
      res.json({
        message: result.rows[0].message,
        duration: result.rows[0].duration,
        frequency: result.rows[0].frequency
      });
    } else {
      res.json({ message: "", duration: 10, frequency: 30 });
    }
  } catch (error) {
    console.error('Error fetching banner:', error.message);
    res.json({ message: "", duration: 10, frequency: 30 });
  }
});

app.post('/api/admin/banner', async (req, res) => {
  const { password, message, duration, frequency } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await pool.query('DELETE FROM banners');
    await pool.query(
      'INSERT INTO banners (message, duration, frequency) VALUES ($1, $2, $3)',
      [message, parseInt(duration), parseInt(frequency)]
    );
    console.log('✅ Banner saved:', message);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving banner:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/banner', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await pool.query('DELETE FROM banners');
    console.log('✅ Banner deleted');
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting banner:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== HELPER FUNCTIONS =====

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function getOrCreateUser(userToken) {
  const tokenHash = hashToken(userToken);
  let result = await pool.query('SELECT * FROM users WHERE user_token = $1', [userToken]);
  if (result.rows.length === 0) {
    result = await pool.query(
      "INSERT INTO users (user_token, token_hash, name) VALUES ($1, $2, 'Player') RETURNING *",
      [userToken, tokenHash]
    );
  }
  return result.rows[0];
}

function encodeRecordingFromRawInput(rawText) {
  const lines = rawText.trim().split('\n').map(line => {
    const [ms, keys] = line.trim().split(',');
    return { ms: parseInt(ms), keys: (keys || '').trim() };
  }).filter(e => !isNaN(e.ms)).sort((a, b) => a.ms - b.ms);

  if (lines.length === 0) return null;

  const frames = lines.map(e => ({
    frame: Math.round(e.ms * 60 / 1000),
    w: e.keys.includes('w'),
    a: e.keys.includes('a'),
    s: e.keys.includes('s'),
    d: e.keys.includes('d')
  }));

  function getToggleFrames(frames, key) {
    const toggles = [];
    let state = false;
    for (const f of frames) {
      if (f[key] !== state) {
        toggles.push(f.frame);
        state = f[key];
      }
    }
    return toggles;
  }

  const channels = [
    getToggleFrames(frames, 'd'),
    getToggleFrames(frames, 'w'),
    getToggleFrames(frames, 's'),
    getToggleFrames(frames, 'a'),
    []
  ];

  function encodeChannel(toggles) {
    const bytes = [];
    bytes.push(toggles.length & 0xFF);
    bytes.push((toggles.length >> 8) & 0xFF);
    bytes.push((toggles.length >> 16) & 0xFF);
    let prev = 0;
    for (const frame of toggles) {
      const delta = frame - prev;
      bytes.push(delta & 0xFF);
      bytes.push((delta >> 8) & 0xFF);
      bytes.push((delta >> 16) & 0xFF);
      prev = frame;
    }
    return bytes;
  }

  const buffer = [];
  for (const ch of channels) {
    buffer.push(...encodeChannel(ch));
  }

  const compressed = pako.deflate(new Uint8Array(buffer));
  const b64 = Buffer.from(compressed).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const lastFrame = frames[frames.length - 1].frame;
  return { recording: b64, frames: lastFrame };
}

// ===== STATIC FILES =====

app.get('/tracks/official/', (req, res) => {
  const trackDir = path.join(__dirname, 'tracks', 'official');
  try {
    const files = fs.readdirSync(trackDir).filter(f => f.endsWith('.track')).sort();
    const links = files.map(f => `<a href="${f}">${f}</a>`).join('\n');
    res.send(`<html><body>${links}</body></html>`);
  } catch (e) {
    res.status(500).send('Error listing tracks');
  }
});

app.get('/tracks/community/', (req, res) => {
  const trackDir = path.join(__dirname, 'tracks', 'community');
  try {
    const files = fs.readdirSync(trackDir).filter(f => f.endsWith('.track')).sort();
    const links = files.map(f => `<a href="${f}">${f}</a>`).join('\n');
    res.send(`<html><body>${links}</body></html>`);
  } catch (e) {
    res.status(500).send('Error listing tracks');
  }
});

app.use(express.static('.'));

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ===== GAME API =====

app.get('/api/countdown', async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM game_settings WHERE key = 'countdown_end'`);
    if (result.rows.length > 0) {
      res.json({ endTime: parseInt(result.rows[0].value) });
    } else {
      const endTime = Date.now() + (100 * 60 * 60 * 1000);
      await pool.query(`INSERT INTO game_settings (key, value) VALUES ('countdown_end', $1)`, [endTime.toString()]);
      res.json({ endTime });
    }
  } catch (error) {
    console.error('Error getting countdown:', error.message);
    res.json({ endTime: Date.now() + (100 * 60 * 60 * 1000) });
  }
});

app.get('/api/lock-status', async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM game_settings WHERE key = 'locked'`);
    const locked = result.rows.length > 0 ? result.rows[0].value === 'true' : false;
    res.json({ locked });
  } catch (error) {
    console.error('Error getting lock status:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/verify-local-unlock', (req, res) => {
  const { password } = req.body;
  if (password === process.env.LOCAL_UNLOCK_PASSWORD) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

app.post('/api/lock', async (req, res) => {
  const { password, action } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    const newValue = action === 'lock' ? 'true' : 'false';
    await pool.query(`UPDATE game_settings SET value = $1 WHERE key = 'locked'`, [newValue]);
    res.json({ success: true, locked: action === 'lock' });
  } catch (error) {
    console.error('Error updating lock status:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== LEADERBOARD =====

app.get('/leaderboard', async (req, res) => {
  try {
    const { trackId, skip = 0, userTokenHash } = req.query;
    const amount = 1000;

    if (!trackId) {
      return res.json({ total: 0, entries: [] });
    }

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM leaderboard WHERE track_id = $1',
      [trackId]
    );
    const total = parseInt(countResult.rows[0].count);

    const entriesResult = await pool.query(`
      SELECT l.id, u.token_hash as "userId", u.name, l.frames, u.car_colors as "carColors"
      FROM leaderboard l
      JOIN users u ON l.user_id = u.id
      WHERE l.track_id = $1
      ORDER BY l.frames ASC
      OFFSET $2 LIMIT $3
    `, [trackId, parseInt(skip), parseInt(amount)]);

    const entries = entriesResult.rows.map(row => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      frames: row.frames,
      carColors: row.carColors
    }));

    let userEntry = null;
    if (userTokenHash) {
      const userResult = await pool.query(`
        SELECT l.id, l.frames,
          (SELECT COUNT(*) + 1 FROM leaderboard l2 
           WHERE l2.track_id = $1 AND l2.frames < l.frames) as position
        FROM leaderboard l
        JOIN users u ON l.user_id = u.id
        WHERE l.track_id = $1 AND u.token_hash = $2
      `, [trackId, userTokenHash]);

      if (userResult.rows.length > 0) {
        userEntry = {
          position: parseInt(userResult.rows[0].position) - 1,
          frames: userResult.rows[0].frames,
          id: userResult.rows[0].id
        };
      }
    }

    res.json({ total, entries, userEntry });
  } catch (error) {
    console.error('Error fetching leaderboard:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/leaderboard', async (req, res) => {
  try {
    const { userToken, name, carColors, trackId, frames, recording } = req.body;

    if (!userToken || !trackId || frames === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const user = await getOrCreateUser(userToken);

    if (name) {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name.substring(0, 50), user.id]);
    }
    if (carColors && carColors.length === 24) {
      await pool.query('UPDATE users SET car_colors = $1 WHERE id = $2', [carColors, user.id]);
    }

    const existingResult = await pool.query(
      'SELECT id, frames FROM leaderboard WHERE user_id = $1 AND track_id = $2',
      [user.id, trackId]
    );

    let uploadId;
    let previousPosition = null;
    let newPosition = null;

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (parseInt(frames) < existing.frames) {
        const prevPosResult = await pool.query(`
          SELECT COUNT(*) + 1 as pos FROM leaderboard 
          WHERE track_id = $1 AND frames < $2
        `, [trackId, existing.frames]);
        previousPosition = parseInt(prevPosResult.rows[0].pos);

        await pool.query(
          'UPDATE leaderboard SET frames = $1, recording = $2 WHERE id = $3',
          [parseInt(frames), recording || '', existing.id]
        );
        uploadId = existing.id;

        const newPosResult = await pool.query(`
          SELECT COUNT(*) + 1 as pos FROM leaderboard 
          WHERE track_id = $1 AND frames < $2
        `, [trackId, parseInt(frames)]);
        newPosition = parseInt(newPosResult.rows[0].pos);
      } else {
        uploadId = existing.id;
      }
    } else {
      const insertResult = await pool.query(
        'INSERT INTO leaderboard (user_id, track_id, frames, recording) VALUES ($1, $2, $3, $4) RETURNING id',
        [user.id, trackId, parseInt(frames), recording || '']
      );
      uploadId = insertResult.rows[0].id;

      const newPosResult = await pool.query(`
        SELECT COUNT(*) + 1 as pos FROM leaderboard 
        WHERE track_id = $1 AND frames < $2
      `, [trackId, parseInt(frames)]);
      newPosition = parseInt(newPosResult.rows[0].pos);
    }

    if (previousPosition !== null || newPosition !== null) {
      res.json({ uploadId, previousPosition, newPosition });
    } else {
      res.json(uploadId);
    }
  } catch (error) {
    console.error('Error submitting to leaderboard:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/recordings', async (req, res) => {
  try {
    const { recordingIds } = req.query;

    if (!recordingIds) {
      return res.json([]);
    }

    const ids = recordingIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    if (ids.length === 0) {
      return res.json([]);
    }

    const results = [];
    for (const id of ids) {
      const result = await pool.query(`
        SELECT l.recording, l.verified_state as "verifiedState", l.frames, u.car_colors as "carColors"
        FROM leaderboard l
        JOIN users u ON l.user_id = u.id
        WHERE l.id = $1
      `, [id]);

      if (result.rows.length > 0) {
        results.push({
          recording: result.rows[0].recording,
          verifiedState: result.rows[0].verifiedState,
          frames: result.rows[0].frames,
          carColors: result.rows[0].carColors
        });
      } else {
        results.push(null);
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error fetching recordings:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user', async (req, res) => {
  try {
    const { userToken } = req.query;

    if (!userToken) {
      return res.json(null);
    }

    const result = await pool.query(
      'SELECT name, car_colors as "carColors", is_verifier as "isVerifier" FROM users WHERE user_token = $1',
      [userToken]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json({
      name: result.rows[0].name,
      carColors: result.rows[0].carColors,
      isVerifier: result.rows[0].isVerifier
    });
  } catch (error) {
    console.error('Error fetching user:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/user', async (req, res) => {
  try {
    const { userToken, name, carColors } = req.body;

    if (!userToken) {
      return res.status(400).send('Missing userToken');
    }

    const user = await getOrCreateUser(userToken);

    if (name && name.length >= 1 && name.length <= 50) {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, user.id]);
    }
    if (carColors && carColors.length === 24) {
      await pool.query('UPDATE users SET car_colors = $1 WHERE id = $2', [carColors, user.id]);
    }

    res.status(200).send('');
  } catch (error) {
    console.error('Error updating user:', error.message);
    res.status(500).send('Internal server error');
  }
});

app.post('/verifyRecordings', async (req, res) => {
  res.json({ exhaustive: 1, estimatedRemaining: 0, unverifiedRecordings: [] });
});

// ===== CHAT API =====

app.get('/api/chat', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.message, c.created_at, u.name, u.token_hash as "userId"
      FROM chat_messages c
      JOIN users u ON c.user_id = u.id
      ORDER BY c.created_at DESC
      LIMIT 50
    `);
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Error fetching chat:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { userToken, message } = req.body;
  if (!userToken || !message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Missing token or message' });
  }

  try {
    // 1. Get the user from the database using the token
    const user = await getOrCreateUser(userToken);

    // 2. Insert the message tied to that user's ID
    // The GET /api/chat route already handles joining this with the users table to get the name
    await pool.query(
      'INSERT INTO chat_messages (user_id, message) VALUES ($1, $2)',
      [user.id, message.substring(0, 500)]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== CHAT SYSTEM =====

app.get('/api/chat', async (req, res) => {
  const { userToken } = req.query;
  try {
    const result = await pool.query(`
      SELECT c.id, u.name, u.token_hash, c.message, c.created_at
      FROM chat_messages c
      JOIN users u ON c.user_id = u.id
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    let myTokenHash = null;
    if (userToken && userToken !== 'null' && userToken !== 'undefined') {
      myTokenHash = hashToken(userToken);
    }

    const messages = result.rows.reverse().map(row => ({
      id: row.id,
      name: row.name,
      message: row.message,
      isOwn: myTokenHash && row.token_hash === myTokenHash,
      createdAt: row.created_at
    }));

    res.json(messages);
  } catch (error) {
    console.error('Error fetching chat:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { userToken, message } = req.body;
  if (!userToken || !message) {
    return res.status(400).json({ error: 'Missing userToken or message' });
  }

  try {
    const user = await getOrCreateUser(userToken);
    await pool.query(
      'INSERT INTO chat_messages (user_id, message) VALUES ($1, $2)',
      [user.id, message]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending chat message:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== TRACKS =====

app.post('/api/register-track', async (req, res) => {
  try {
    const { trackId, filename } = req.body;

    if (!trackId || !filename) {
      return res.status(400).json({ error: 'Missing trackId or filename' });
    }

    const isOfficial = OFFICIAL_TRACK_FILES.includes(filename);

    await pool.query(`
      INSERT INTO track_mapping (track_id, filename, is_official)
      VALUES ($1, $2, $3)
      ON CONFLICT (track_id) DO UPDATE SET filename = $2, is_official = $3
    `, [trackId, filename, isOfficial]);

    if (isOfficial) {
      officialTrackIds.add(trackId);
    }

    res.json({ success: true, isOfficial });
  } catch (error) {
    console.error('Error registering track:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/track-stats', async (req, res) => {
  res.json({
    officialCount: officialTrackIds.size,
    totalOfficial: OFFICIAL_TRACK_FILES.length,
    officialIds: Array.from(officialTrackIds)
  });
});

app.get('/api/overall-leaderboard', async (req, res) => {
  try {
    const useAllTracks = officialTrackIds.size === 0;

    let tracksResult;
    if (useAllTracks) {
      tracksResult = await pool.query(`
        SELECT track_id, COUNT(*) as racer_count
        FROM leaderboard
        GROUP BY track_id
      `);
    } else {
      tracksResult = await pool.query(`
        SELECT track_id, COUNT(*) as racer_count
        FROM leaderboard
        WHERE track_id = ANY($1)
        GROUP BY track_id
      `, [Array.from(officialTrackIds)]);
    }

    const tracks = tracksResult.rows;
    const totalTracks = useAllTracks ? tracks.length : OFFICIAL_TRACK_FILES.length;

    if (totalTracks === 0) {
      return res.json({ entries: [] });
    }

    const playersResult = await pool.query(`
      SELECT DISTINCT u.id, u.name, u.car_colors
      FROM users u
      JOIN leaderboard l ON u.id = l.user_id
    `);
    const players = playersResult.rows;

    const ranksResult = await pool.query(`
      SELECT 
        l.user_id,
        l.track_id,
        RANK() OVER (PARTITION BY l.track_id ORDER BY l.frames ASC) as track_rank
      FROM leaderboard l
    `);

    const playerRanks = {};
    for (const row of ranksResult.rows) {
      if (!playerRanks[row.user_id]) {
        playerRanks[row.user_id] = {};
      }
      playerRanks[row.user_id][row.track_id] = parseInt(row.track_rank);
    }

    const entries = players.map(player => {
      let totalRank = 0;
      let racedCount = 0;

      for (const track of tracks) {
        const playerTrackRanks = playerRanks[player.id] || {};
        if (playerTrackRanks[track.track_id] !== undefined) {
          totalRank += playerTrackRanks[track.track_id];
          racedCount++;
        } else {
          totalRank += parseInt(track.racer_count) + 1;
        }
      }

      const averageRank = totalRank / totalTracks;

      return {
        id: player.id,
        name: player.name,
        carColors: player.car_colors,
        raceCount: racedCount,
        totalTracks: totalTracks,
        totalRank: totalRank,
        averageRank: averageRank
      };
    });

    entries.sort((a, b) => a.averageRank - b.averageRank);

    const finalEntries = entries.slice(0, 100).map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      carColors: entry.carColors,
      raceCount: entry.raceCount,
      totalTracks: entry.totalTracks,
      averageRank: parseFloat(entry.averageRank.toFixed(2))
    }));

    res.json({ entries: finalEntries });
  } catch (error) {
    console.error('Error fetching overall leaderboard:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== ADMIN =====

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(403).json({ error: 'Invalid password' });
  }
});

app.post('/api/admin/players', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Invalid password' });

  try {
    const result = await pool.query(`
      SELECT l.id, u.name, l.track_id, l.frames, l.created_at,
        COALESCE(tm.filename, l.track_id) as track_name,
        u.car_colors, u.id as user_id
      FROM leaderboard l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN track_mapping tm ON l.track_id = tm.track_id
      ORDER BY l.created_at DESC
    `);
    res.json({ entries: result.rows });
  } catch (error) {
    console.error('Error fetching admin players:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/tracks', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Invalid password' });

  try {
    const result = await pool.query(`
      SELECT l.track_id, 
        COALESCE(tm.filename, '') as track_name,
        COUNT(*) as player_count
      FROM leaderboard l
      LEFT JOIN track_mapping tm ON l.track_id = tm.track_id
      GROUP BY l.track_id, tm.filename
      ORDER BY tm.filename NULLS LAST
    `);
    res.json({ tracks: result.rows });
  } catch (error) {
    console.error('Error fetching tracks:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/add-recording', async (req, res) => {
  const { password, playerName, trackId, rawRecording, carColors, existingUserId } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Invalid password' });

  if (!playerName || !trackId || !rawRecording) {
    return res.status(400).json({ error: 'Missing player name, track ID, or recording data' });
  }

  try {
    const encoded = encodeRecordingFromRawInput(rawRecording);
    if (!encoded) {
      return res.status(400).json({ error: 'Invalid recording format' });
    }

    let userId;
    const colors = carColors && carColors.length === 24 ? carColors : 'ff0000ff0000ff0000ff0000';

    if (existingUserId) {
      const existing = await pool.query('SELECT id FROM users WHERE id = $1', [existingUserId]);
      if (existing.rows.length === 0) {
        return res.status(400).json({ error: 'User not found' });
      }
      userId = existingUserId;
      await pool.query('UPDATE users SET name = $1, car_colors = $2 WHERE id = $3',
        [playerName.substring(0, 50), colors, userId]);
    } else {
      const token = 'admin_' + crypto.randomBytes(16).toString('hex');
      const tokenHash = hashToken(token);
      const userResult = await pool.query(
        'INSERT INTO users (user_token, token_hash, name, car_colors) VALUES ($1, $2, $3, $4) RETURNING *',
        [token, tokenHash, playerName.substring(0, 50), colors]
      );
      userId = userResult.rows[0].id;
    }

    await pool.query(`
      INSERT INTO leaderboard (user_id, track_id, frames, recording) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, track_id) DO UPDATE SET frames = $3, recording = $4
    `, [userId, trackId, encoded.frames, encoded.recording]);

    res.json({ success: true, frames: encoded.frames, playerName });
  } catch (error) {
    console.error('Error adding recording:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/delete-recording', async (req, res) => {
  const { password, leaderboardId } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Invalid password' });

  try {
    const entry = await pool.query('SELECT user_id FROM leaderboard WHERE id = $1', [leaderboardId]);
    if (entry.rows.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const userId = entry.rows[0].user_id;
    await pool.query('DELETE FROM leaderboard WHERE id = $1', [leaderboardId]);

    const remaining = await pool.query('SELECT COUNT(*) FROM leaderboard WHERE user_id = $1', [userId]);
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting recording:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== DEFAULT ROUTE =====

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== START SERVER =====

initDatabase().th  en(() => {
  loadBannerOnStartup();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`Visit: https://${process.env.REPLIT_OWNER}.${process.env.REPLIT_SLUG}.repl.co`);
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});