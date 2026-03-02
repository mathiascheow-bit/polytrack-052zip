# PolyTrack

## Overview
PolyTrack is a 3D racing game built with WebGL and Three.js. It features official and community-created tracks with various themes (summer, winter, desert).

## Project Structure
- `index.html` - Main entry point with API redirect script
- `server.js` - Express backend server for global lock and leaderboard functionality
- `main.bundle.js` - Core game logic (pre-bundled)
- `simulation_worker.bundle.js` - Physics simulation web worker
- `error_screen.bundle.js` - Error handling UI
- `/audio/` - Sound effects and music
- `/images/` - UI images and icons
- `/models/` - 3D models (GLB format)
- `/tracks/` - Official and community tracks
- `/lib/` - Third-party libraries (Draco decoder, Ammo.js physics)

## How to Run
The game is served via Express server using `node server.js` on port 5000.

## Technical Notes
- Uses Three.js for 3D rendering
- Uses Ammo.js (WebAssembly) for physics simulation
- Uses Draco compression for 3D models
- Requires WebGL support in the browser
- Uses PostgreSQL database for global lock state and leaderboard

## Features
- **Global Lock Mode**: Admin can lock the game for all users
  - Lock button in bottom-left corner (discreet, appears on hover)
  - When locked, all visitors see a lock screen until unlocked
  - Lock state is stored in database and synced across all users
  - **Global password**: Stored in ADMIN_PASSWORD secret — locks/unlocks for everyone
  - **Local password**: Stored in LOCAL_UNLOCK_PASSWORD secret — unlocks only on that specific computer/browser (stored in localStorage)

- **Custom Leaderboard**: Fresh leaderboard system replacing the original
  - All API calls redirected from Kodub servers to our custom backend
  - Players can compete and see rankings with friends
  - Leaderboard data stored in PostgreSQL database
  - Supports user profiles, car colors, and race recordings

- **Overall Rankings**: Average rank leaderboard across official tracks only
  - Rankings button injected into game menu (next to Play button)
  - Only counts the 15 official tracks (summer, winter, desert themes)
  - Community tracks are excluded from overall rankings
  - **Penalty system**: Players get rank = (racers + 1) for tracks they didn't race
  - Lower points = better (must race all tracks to get best score)
  - Full-screen overlay when opened
  - Shows top 100 players ranked by average position
  - Displays "X/Y tracks" showing raced vs total tracks
  - Top 3 players highlighted with gold styling
  - **100-hour countdown timer** at top of rankings panel
  - Prize banner announcing mystery prize for top 3 when timer ends
  - Timer persists in database (synced across all users)

- **Admin Panel** (`/admin.html`): Password-protected recording management
  - Add ghost recordings by pasting raw input data (timestamp,keys format)
  - Delete recordings/players from leaderboard
  - Players added here appear as normal players on leaderboard and rankings
  - Protected by admin password (10420120)
  - Recording format: `milliseconds,keys` per line (w=accel, a=left, s=brake, d=right)
  - Server-side encoding: converts raw input to game's 5-channel binary format (compressed with pako)

## Recording Format (Technical)
- Game uses 5 input channels: right(d), accelerate(w), brake(s), left(a), reset
- Each channel: 3-byte count (LE) + 3-byte cumulative frame deltas per toggle
- Compressed with pako.deflate, encoded as URL-safe base64
- Admin panel converts `ms,keys` format to this binary format server-side

## API Endpoints
- `GET /leaderboard` - Fetch leaderboard entries for a track
- `POST /leaderboard` - Submit a new run/time
- `GET /recordings` - Get replay recordings by ID
- `GET /user` - Get user profile
- `POST /user` - Update user profile
- `GET /api/lock-status` - Check if game is locked
- `POST /api/lock` - Lock/unlock the game (requires password)
- `POST /api/admin/verify` - Verify admin password
- `GET /api/admin/players` - List all leaderboard entries (admin)
- `GET /api/admin/tracks` - List tracks with entries (admin)
- `POST /api/admin/add-recording` - Add ghost recording from raw data (admin)
- `POST /api/admin/delete-recording` - Delete a recording (admin)

## Database Tables
- `game_settings` - Stores lock state and countdown timer
- `users` - Player profiles (token, name, car colors)
- `leaderboard` - Race times and recordings per track
- `track_mapping` - Maps track IDs to filenames

## Recent Changes
- 2026-02-10: Removed all "Static" promotional banners, links, and version text from game UI
- 2026-02-10: Moved passwords to environment secrets (ADMIN_PASSWORD, LOCAL_UNLOCK_PASSWORD)
- 2026-02-10: Added directory listing endpoints for track auto-discovery
- 2026-02-06: Added admin panel for managing ghost recordings with raw input encoding
- 2026-02-03: Added custom leaderboard system with full API compatibility
- 2026-02-03: Added global lock mode with server-side state management
- 2026-01-30: Initial import and setup for Replit environment
