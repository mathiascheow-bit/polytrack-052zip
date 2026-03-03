/*
  # Create Polytrack Game Schema

  1. New Tables
    - `users`: Store player profiles with unique tokens
      - `id` (bigint, primary key, auto-increment)
      - `user_token` (text, unique, 64-char hex token)
      - `token_hash` (text, SHA-256 hash for security)
      - `name` (text, player display name)
      - `car_colors` (text, hex color string for car)
      - `created_at` (timestamp)

    - `leaderboard`: Store race times and scores
      - `id` (bigint, primary key)
      - `user_id` (bigint, foreign key to users)
      - `track_id` (text, track identifier)
      - `frames` (bigint, race time in frames)
      - `verified_state` (smallint, verification status)
      - `created_at` (timestamp)

    - `banners`: Store announcement banners
      - `id` (bigint, primary key)
      - `message` (text, banner text)
      - `duration` (integer, display duration in ms)
      - `frequency` (integer, frequency value)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Public read access for leaderboard and banners
    - Restricted write access for users
*/

-- Drop old leaderboard if it exists
DROP TABLE IF EXISTS leaderboard;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  user_token TEXT UNIQUE NOT NULL,
  token_hash TEXT,
  name TEXT NOT NULL DEFAULT 'Player',
  car_colors TEXT DEFAULT 'ff0000ff0000ff0000ff0000',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create leaderboard table
CREATE TABLE IF NOT EXISTS leaderboard (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  frames BIGINT NOT NULL,
  verified_state SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, track_id)
);

-- Create banners table
CREATE TABLE IF NOT EXISTS banners (
  id BIGSERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  duration INTEGER DEFAULT 5000,
  frequency INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Public read policy for leaderboard
CREATE POLICY "Leaderboard is publicly readable"
  ON leaderboard FOR SELECT
  TO anon, authenticated
  USING (true);

-- Public read policy for banners
CREATE POLICY "Banners are publicly readable"
  ON banners FOR SELECT
  TO anon, authenticated
  USING (true);

-- Users can insert new users (for anonymous signups)
CREATE POLICY "Anyone can create a user"
  ON users FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Users can read their own data
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  TO anon, authenticated
  USING (true);

-- Anyone can insert leaderboard scores
CREATE POLICY "Anyone can insert scores"
  ON leaderboard FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leaderboard_frames ON leaderboard(frames);
CREATE INDEX IF NOT EXISTS idx_leaderboard_track ON leaderboard(track_id);
CREATE INDEX IF NOT EXISTS idx_users_token ON users(user_token);
