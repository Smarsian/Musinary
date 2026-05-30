# Musinary

The party game where your music taste is on trial.
Pick a 30-second song segment, challenge your friends, and race to guess titles first.

## Current Features

- Real-time multiplayer rooms over Socket.io
- Host-authenticated Spotify playback (Premium required on host)
- Player song submission with draggable 30-second segment selector
- Preview support for joiners without Spotify login via host-relay preview endpoints
- Round timer, live correct-guess feed, and automatic score calculation
- Progressive title hints during rounds (masked title reveals over time)
- Final results + rematch voting
- Toggleable light/dark mode with local persistence

## Game Flow

1. Host creates a room and signs in with Spotify.
2. Players join with room code.
3. Each player submits one track and chooses a 30-second start time.
4. Host starts the game and each round plays one submitted segment.
5. Players type guesses while the timer runs.
6. Scores update by response speed, then final standings are shown.

### Scoring

| Guess time | Points |
|---|---|
| 0-5 seconds | 1000 |
| 5-10 seconds | 800 |
| 10-15 seconds | 600 |
| 15-20 seconds | 500 |
| 20-25 seconds | 300 |
| 25-30 seconds | 100 |

### Guess Matching Rules

- Matching is strict after normalization.
- Normalization removes punctuation/brackets/feat tags and compares full normalized title equality.
- Example: "Bohemian" does not count for "Bohemian Rhapsody".

## Requirements

- Node.js 18+
- Spotify Developer app (for client ID)
- Spotify Premium for host playback

## Spotify App Setup

1. Create an app in the Spotify Dashboard: https://developer.spotify.com/dashboard
2. Add redirect URI: http://localhost:5173
3. Copy your Spotify Client ID

## Environment Configuration

### Client (`client/.env`) required

```bash
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
VITE_REDIRECT_URI=http://localhost:5173
VITE_SERVER_URL=http://localhost:3001
```

### Server (`.env` in repo root) optional

Defaults are already set in code, but you can override:

```bash
PORT=3001
CLIENT_URL=http://localhost:5173
```

You can copy values from `.env.example`.

## Run Locally

```bash
npm run install:all
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001

## Available Scripts

From repo root:

- `npm run dev`: starts server + client concurrently
- `npm run free-ports`: frees common dev ports used by the app
- `npm run install:all`: installs root, server, and client dependencies
- `npm run build`: builds the client app

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Backend | Express + Socket.io |
| Spotify | OAuth PKCE + Web Playback SDK + Web API |

## Project Structure

```text
musinary/
    client/
        src/
            App.tsx
            pages/
                Home.tsx
                Lobby.tsx
                SongSelector.tsx
                GamePlay.tsx
                Results.tsx
            components/
                SegmentSlider.tsx
    server/
        index.js
        gameManager.js
    scripts/
        freePorts.mjs
```

## Notes

- Host tokens are stored in-memory per room on the server.
- If host Spotify token expires, host must re-authenticate.
- For production, set `VITE_REDIRECT_URI` and `CLIENT_URL` to your deployed domain and register that URI in Spotify Dashboard.
- Some of the visual aspects was made with AI. This won't be permananat I just want a quick template for how the game will work.