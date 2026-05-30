# Musinary 🎵

> The party game where your music taste is on trial — pick your 30-second segment, stump your friends, and score points for being first to guess!

## How It Works

1. **Host creates a room** and shares the 6-character code with friends
2. **Everyone joins** on their phones or laptops
3. **Each player submits a Spotify track** and drags a slider to pick their sneaky 30-second segment
4. **The game plays each segment** through the host's speakers, one at a time
5. **Players race to type the correct song title** — the faster you guess, the more points you earn
6. **After all songs play**, a final podium reveals the winner

### Scoring

| Guess time | Points |
|---|---|
| 0–5 seconds | 1000 |
| 5–10 seconds | 800 |
| 10–15 seconds | 600 |
| 15–20 seconds | 500 |
| 20–25 seconds | 300 |
| 25–30 seconds | 100 |

---

## Setup

### Prerequisites

- **Node.js 18+**
- A **Spotify Developer** account (free): [developer.spotify.com](https://developer.spotify.com/dashboard)
- **Spotify Premium** on the host's account (required for Web Playback SDK)

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. Fill in any name/description
4. Under **Redirect URIs**, add: `http://localhost:5173`
5. Save and copy your **Client ID**

### 2. Configure environment

```bash
# Client — edit client/.env
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
VITE_REDIRECT_URI=http://localhost:5173
VITE_SERVER_URL=http://localhost:3001

# Server — edit server/.env (optional, values already defaulted)
PORT=3001
CLIENT_URL=http://localhost:5173
```

### 3. Install & run

```bash
# Install all dependencies
npm run install:all

# Start both server and client simultaneously
npm run dev
```

- **Client**: http://localhost:5173
- **Server**: http://localhost:3001

---

## Playing the Game

### Host setup
1. Open http://localhost:5173 on the device connected to speakers/TV
2. Click **"Connect Spotify & Host Game"** → log in with your Premium account
3. Share the room code (shown in big letters) with all players
4. Once everyone has submitted a song, click **Start Game**

### Guest setup
1. Open http://localhost:5173 on your phone/laptop
2. Click **Join Room**, enter your name and the room code
3. Click **Pick My Song**, paste a Spotify track link, drag the slider
4. Submit — then wait for the game to begin

### During gameplay
- The 30-second clip plays through the **host's device** (make sure it's connected to speakers!)
- Type your guess in the text box and hit Enter
- Partial/fuzzy matches count — "Bohemian" will match "Bohemian Rhapsody"
- You only get one correct guess per round

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Backend | Node.js + Express |
| Real-time | Socket.io |
| Audio | Spotify Web Playback SDK |
| Auth | Spotify OAuth 2.0 (PKCE) |

---

## Project Structure

```
musinary/
├── server/
│   ├── index.js          # Express + Socket.io server
│   └── gameManager.js    # Room/game state, guess scoring
└── client/
    └── src/
        ├── App.tsx                      # Main state machine & routing
        ├── socket.ts                    # Socket.io client
        ├── spotifyAuth.ts               # PKCE OAuth + Playback API helpers
        ├── pages/
        │   ├── Home.tsx                 # Create/join lobby
        │   ├── Lobby.tsx                # Player list, song submission status
        │   ├── SongSelector.tsx         # Spotify URL input + segment picker
        │   ├── GamePlay.tsx             # Live round: timer, guess input, results
        │   └── Results.tsx              # Final podium
        └── components/
            └── SegmentSlider.tsx        # Draggable 30-second window selector
```

---

## Notes

- The host **must** have Spotify Premium for audio playback; guests do not need it
- Spotify access tokens expire after **1 hour** — re-login for longer sessions
- For production, update `VITE_REDIRECT_URI` and `CLIENT_URL` to your domain and register it in the Spotify dashboard
