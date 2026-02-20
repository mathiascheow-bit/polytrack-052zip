# PolyTrack 0.5.2

## Overview

PolyTrack is a browser-based 3D racing game (version 0.5.2) originally built by Kodub. This project hosts the static game assets and provides a custom Express backend server that replaces the original Kodub API. The game runs entirely in the browser using WebGL/Three.js for rendering and Ammo.js (WebAssembly) for physics simulation. The backend handles a custom leaderboard system, user profiles, global game locking, and overall rankings across official tracks.

The game features official tracks (16 tracks across summer, winter, and desert themes) and community-created tracks. The main game bundle (`main.bundle.js`) is pre-built and not re-compiled — modifications are done via string replacement scripts or by patching the bundle directly.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (Static Game Client)
- **Entry point**: `index.html` loads the pre-bundled game
- **Core bundle**: `main.bundle.js` — contains all game logic, UI, rendering, physics setup, and API client code. This is a pre-built webpack bundle that is not rebuilt from source; instead, helper scripts patch it in place (e.g., updating track fallback arrays)
- **Physics worker**: `simulation_worker.bundle.js` — runs physics simulation in a Web Worker for performance isolation
- **Error handling**: `error_screen.bundle.js` — displays error UI when something goes wrong
- **3D engine**: Three.js for WebGL rendering
- **Physics engine**: Ammo.js (WebAssembly port of Bullet Physics), loaded from `/lib/ammo.wasm.js`
- **Model compression**: Draco decoder in `/lib/draco/` for compressed GLB 3D models
- **Assets**: `/audio/` for sound, `/images/` for UI, `/models/` for 3D models (GLB format), `/tracks/` for track files

### Backend (Express Server)
- **File**: `server.js` — single Express server on port 5000
- **Purpose**: Serves static game files AND provides the custom leaderboard/user API
- **API replacement**: The game client's API calls (originally pointing to `vps.kodub.com`) are redirected to this backend. The bundle has been patched so all API requests go to the same origin
- **Endpoints provided**:
  - `GET /leaderboard` — paginated leaderboard with filtering by track, verification status, and user identification via token hash
  - `POST /user` — user profile management (nickname, car colors)
  - `POST /recordings` — race recording submission
  - Overall rankings endpoint — computes average rank across the 16 official tracks
- **Admin functionality**: `admin.html` provides an admin interface for game management

### Database (PostgreSQL)
- **Connection**: Uses `pg` library with `DATABASE_URL` environment variable
- **Schema** (initialized in `initDatabase()`):
  - Users table: stores user tokens (64-char hex), nicknames, car colors (24-char hex for 4 RGB values)
  - Leaderboard entries: track ID, user ID, frame count (time), verification status, recordings
  - Lock state: global lock mechanism stored in database
- **Official tracks**: 16 track files are tracked by filename and mapped to track IDs for the overall rankings system

### Global Lock System
- Allows an admin to lock the game for all visitors
- **Global password**: Set via `ADMIN_PASSWORD` environment secret — locks/unlocks for everyone
- **Local password**: Set via `LOCAL_UNLOCK_PASSWORD` environment secret — unlocks only on the specific browser (stored in localStorage)
- Lock state is persisted in PostgreSQL and checked by all clients

### Track Management
- Tracks are stored as `.track` files in `tracks/official/` and `tracks/community/`
- Since GitHub Pages (and static hosting) doesn't support directory listing, track filenames are embedded as fallback arrays in `main.bundle.js`
- `npm run update-fallbacks` runs `scripts/update-track-fallbacks.js` to scan track directories and patch the arrays in the bundle
- `npm test` runs `scripts/run-tests.js` for smoke tests (artifact existence, track presence, bundle integrity)

### Key Design Decisions
- **Pre-built bundle approach**: The game source is not available; modifications are done by patching the compiled bundle. This is fragile but necessary given the constraints.
- **API interception**: Rather than modifying game networking code extensively, the API base URL in the bundle was changed to point to the local server, making it a drop-in replacement for the Kodub backend.
- **Recording validation**: Race recordings use a deterministic replay system — inputs are recorded as toggle deltas, compressed with deflate, and base64 encoded. The server validates recordings under a 10,000 byte limit.

## External Dependencies

### Runtime Dependencies
- **Express 5.x** — HTTP server and API routing
- **pg (node-postgres)** — PostgreSQL client for database operations
- **pako** — Zlib deflate/inflate for recording compression
- **serve** — Static file serving utility (available but Express handles serving in practice)

### Environment Variables / Secrets
- `DATABASE_URL` — PostgreSQL connection string (required)
- `ADMIN_PASSWORD` — Password for global lock/unlock admin functionality
- `LOCAL_UNLOCK_PASSWORD` — Password for per-browser unlock capability

### Client-Side Libraries (bundled)
- **Three.js** — 3D rendering (bundled in main.bundle.js)
- **Ammo.js** — Physics engine via WebAssembly (`lib/ammo.wasm.js` + `.wasm` file)
- **Draco** — 3D model decompression (`lib/draco/`)
- **js-sha256** — SHA-256 hashing for user token management (bundled in simulation worker)

### Infrastructure
- **PostgreSQL database** — Required for leaderboard, user profiles, and lock state
- Server runs on port 5000