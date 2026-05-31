require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const GameManager = require('./gameManager');

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const CLIENT_URLS = process.env.CLIENT_URLS || '';

function normalizeToOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

const configuredAllowedOrigins = new Set(
  [CLIENT_URL, ...CLIENT_URLS.split(',')]
    .map((entry) => normalizeToOrigin(entry))
    .filter(Boolean),
);

function isAllowedOrigin(origin) {
  // Allow non-browser requests (no Origin header), e.g. health checks.
  if (!origin) return true;

  const normalizedOrigin = normalizeToOrigin(origin);
  if (normalizedOrigin && configuredAllowedOrigins.has(normalizedOrigin)) return true;

  // In local dev, allow localhost on any port so Vite fallback ports still work.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;

  return false;
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
  },
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
  }),
);
app.use(express.json());

const gameManager = new GameManager();
const hintTimers = new Map();

async function playOnHostDevice(hostToken, trackUri, positionMs) {
  const safePosition = Number.isFinite(positionMs) ? Math.max(0, Math.floor(positionMs)) : 0;

  let playRes;
  try {
    playRes = await axios.put(
      'https://api.spotify.com/v1/me/player/play',
      { uris: [trackUri], position_ms: safePosition },
      { headers: { Authorization: `Bearer ${hostToken}` } },
    );
    return playRes.status;
  } catch (err) {
    if (err.response?.status !== 404) {
      throw err;
    }
  }

  const devicesRes = await axios.get('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${hostToken}` },
  });

  const devices = devicesRes.data?.devices ?? [];
  const targetDevice = devices.find((d) => d?.id && !d?.is_restricted);

  if (!targetDevice?.id) {
    const noDeviceError = new Error('No Spotify devices are available for host playback');
    noDeviceError.statusCode = 404;
    throw noDeviceError;
  }

  await axios.put(
    'https://api.spotify.com/v1/me/player',
    { device_ids: [targetDevice.id], play: false },
    { headers: { Authorization: `Bearer ${hostToken}` } },
  );

  const retryRes = await axios.put(
    `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDevice.id)}`,
    { uris: [trackUri], position_ms: safePosition },
    { headers: { Authorization: `Bearer ${hostToken}` } },
  );

  return retryRes.status;
}

function stopHintTimer(roomCode) {
  const timer = hintTimers.get(roomCode);
  if (timer) {
    clearInterval(timer);
    hintTimers.delete(roomCode);
  }
}

function startHintTimer(roomCode, roundDurationMs = 30000) {
  stopHintTimer(roomCode);

  const hintIntervalMs = Math.max(3000, Math.floor(roundDurationMs / 5));

  // Reveal one character on a cadence tied to round length.
  const timer = setInterval(() => {
    const hint = gameManager.revealNextHint(roomCode);
    if (!hint.success) {
      stopHintTimer(roomCode);
      return;
    }

    io.to(roomCode).emit('hint-update', {
      hintMask: hint.hintMask,
      revealed: hint.revealed,
      maxReveals: hint.maxReveals,
    });

    if (hint.done) {
      stopHintTimer(roomCode);
    }
  }, hintIntervalMs);

  hintTimers.set(roomCode, timer);
}

async function getTrackInfoForRoom(roomCode, trackId) {
  // Validate trackId is a valid Spotify track ID (22 alphanumeric chars)
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) {
    return { success: false, status: 400, error: 'Invalid track ID' };
  }

  const room = gameManager.getRoom(roomCode.toUpperCase());
  if (!room) return { success: false, status: 404, error: 'Room not found' };
  if (!room.hostToken) {
    return { success: false, status: 401, error: 'Host not authenticated with Spotify' };
  }

  try {
    const response = await axios.get(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
      headers: { Authorization: `Bearer ${room.hostToken}` },
    });

    const track = response.data;
    return {
      success: true,
      data: {
        trackId: track.id,
        trackUri: track.uri,
        trackName: track.name,
        artistName: track.artists.map((a) => a.name).join(', '),
        albumArt: track.album.images[0]?.url || '',
        durationMs: track.duration_ms,
        previewUrl: track.preview_url || null,
      },
    };
  } catch (err) {
    if (err.response?.status === 401) {
      return { success: false, status: 401, error: 'Spotify token expired — host must re-authenticate' };
    }
    if (err.response?.status === 404) {
      return { success: false, status: 404, error: 'Track not found on Spotify' };
    }
    return { success: false, status: 500, error: 'Failed to fetch track info' };
  }
}

// Proxy: fetch Spotify track info using the room host's stored token
app.get('/api/track/:roomCode/:trackId', async (req, res) => {
  const { roomCode, trackId } = req.params;
  const result = await getTrackInfoForRoom(roomCode, trackId);
  if (!result.success) return res.status(result.status).json({ error: result.error });
  return res.json(result.data);
});

// Proxy: start a preview clip on the host's Spotify playback device
app.post('/api/preview/start', async (req, res) => {
  const roomCode = typeof req.body?.roomCode === 'string' ? req.body.roomCode.trim().toUpperCase() : '';
  const trackUri = typeof req.body?.trackUri === 'string' ? req.body.trackUri.trim() : '';
  const positionMs = Number(req.body?.positionMs ?? 0);

  if (!roomCode || !trackUri) {
    return res.status(400).json({ error: 'Missing roomCode or trackUri' });
  }

  const room = gameManager.getRoom(roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.hostToken) return res.status(401).json({ error: 'Host not authenticated with Spotify' });

  try {
    await playOnHostDevice(room.hostToken, trackUri, positionMs);
    return res.status(204).send();
  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Spotify token expired — host must re-authenticate' });
    }
    if (err.statusCode === 404 || err.response?.status === 404) {
      return res.status(404).json({
        error: 'No Spotify playback device is active. Host should open Spotify on phone/desktop.',
      });
    }
    return res.status(500).json({ error: 'Failed to start preview on host Spotify device' });
  }
});

// Proxy: stop preview playback on the host's Spotify account
app.post('/api/preview/stop', async (req, res) => {
  const roomCode = typeof req.body?.roomCode === 'string' ? req.body.roomCode.trim().toUpperCase() : '';

  if (!roomCode) {
    return res.status(400).json({ error: 'Missing roomCode' });
  }

  const room = gameManager.getRoom(roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.hostToken) return res.status(401).json({ error: 'Host not authenticated with Spotify' });

  try {
    await axios.put(
      'https://api.spotify.com/v1/me/player/pause',
      {},
      { headers: { Authorization: `Bearer ${room.hostToken}` } },
    );
    return res.status(204).send();
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(204).send();
    }
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Spotify token expired — host must re-authenticate' });
    }
    return res.status(500).json({ error: 'Failed to stop preview playback' });
  }
});

// Root endpoint for quick host checks (e.g., Render URL)
app.get('/', (_req, res) => {
  res.json({
    service: 'musinary-server',
    status: 'ok',
    health: '/health',
  });
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Create a new room (caller becomes host)
  socket.on('create-room', ({ hostName }, callback) => {
    const safeHostName =
      typeof hostName === 'string' && hostName.trim()
        ? hostName.trim().slice(0, 30)
        : 'Host';
    const { room } = gameManager.createRoom(socket.id, safeHostName);
    socket.join(room.code);
    callback?.({ success: true, roomCode: room.code, room: room.getPublicState() });
  });

  // Join an existing room as a guest
  socket.on('join-room', ({ roomCode, playerName }, callback) => {
    if (!roomCode || !playerName) {
      return callback?.({ success: false, error: 'Missing fields' });
    }
    const result = gameManager.joinRoom(
      roomCode.trim().toUpperCase(),
      socket.id,
      playerName.trim().slice(0, 30),
    );
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
    socket.join(result.room.code);
    io.to(result.room.code).emit('room-update', result.room.getPublicState());
    callback?.({ success: true, player: result.player, room: result.room.getPublicState() });
  });

  // Host stores their Spotify access token on the server (used for track lookups)
  socket.on('host-token', ({ roomCode, accessToken }) => {
    if (roomCode && accessToken && typeof accessToken === 'string') {
      gameManager.setHostToken(roomCode.toUpperCase(), accessToken);
    }
  });

  // Fetch track info through socket so room lookup stays on the same process instance.
  socket.on('fetch-track', async ({ roomCode, trackId }, callback) => {
    if (!roomCode || !trackId) {
      return callback?.({ success: false, error: 'Missing roomCode or trackId' });
    }

    const result = await getTrackInfoForRoom(roomCode.trim().toUpperCase(), trackId.trim());
    if (!result.success) {
      return callback?.({ success: false, error: result.error, status: result.status });
    }

    return callback?.({ success: true, track: result.data });
  });

  // Player submits their chosen song + segment start time
  socket.on('submit-song', ({ roomCode, songData }, callback) => {
    const result = gameManager.submitSong(roomCode?.toUpperCase(), socket.id, songData);
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
    io.to(result.room.code).emit('room-update', result.room.getPublicState());
    callback?.({ success: true });

    if (result.allSubmitted) {
      io.to(result.room.code).emit('all-songs-ready');
    }
  });

  // Host updates pre-game room settings.
  socket.on('update-settings', ({ roomCode, settings }, callback) => {
    const normalizedRoomCode = roomCode?.toUpperCase();
    const result = gameManager.updateSettings(normalizedRoomCode, socket.id, settings);
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }

    io.to(result.room.code).emit('room-update', result.room.getPublicState());
    return callback?.({ success: true, settings: result.room.settings });
  });

  // Host starts the game
  socket.on('start-game', ({ roomCode }, callback) => {
    const result = gameManager.startGame(roomCode?.toUpperCase(), socket.id);
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
    io.to(result.room.code).emit('room-update', result.room.getPublicState());
    io.to(result.room.code).emit('game-started');
    callback?.({ success: true });

    // Kick off the first round after a short countdown
    setTimeout(() => {
      const roundResult = gameManager.startRound(result.room.code);
      if (roundResult.success) {
        io.to(result.room.code).emit('round-start', roundResult.roundData);
        startHintTimer(result.room.code, roundResult.roundData.settings?.clipDurationMs);
      }
    }, 3000);
  });

  // Player submits a guess
  socket.on('submit-guess', ({ roomCode, guess, titleGuess, artistGuess }, callback) => {
    const normalizedTitleGuess =
      typeof titleGuess === 'string'
        ? titleGuess.trim().slice(0, 100)
        : typeof guess === 'string'
          ? guess.trim().slice(0, 100)
          : '';

    const normalizedArtistGuess = typeof artistGuess === 'string' ? artistGuess.trim().slice(0, 100) : '';

    if (!normalizedTitleGuess) {
      return callback?.({ success: false });
    }
    const result = gameManager.submitGuess(
      roomCode?.toUpperCase(),
      socket.id,
      normalizedTitleGuess,
      normalizedArtistGuess,
    );
    if (!result) {
      return callback?.({ success: false, alreadyGuessed: true });
    }

    callback?.({
      success: true,
      correct: result.correct,
      artistCorrect: result.artistCorrect,
      points: result.points,
      basePoints: result.basePoints,
      artistBonusPoints: result.artistBonusPoints,
    });

    if (result.correct) {
      io.to(roomCode.toUpperCase()).emit('player-guessed', {
        playerId: socket.id,
        playerName: result.playerName,
        points: result.points,
        artistBonusPoints: result.artistBonusPoints,
        timeMs: result.timeMs,
      });
    }

    const room = gameManager.getRoom(roomCode.toUpperCase());
    if (room) {
      io.to(room.code).emit('room-update', room.getPublicState());
    }
  });

  // Host ends the current round (called after 30 s or manually)
  socket.on('end-round', ({ roomCode }, callback) => {
    const result = gameManager.endRound(roomCode?.toUpperCase(), socket.id);
    if (!result.success) return callback?.({ success: false });

    stopHintTimer(roomCode.toUpperCase());

    callback?.({ success: true });
    io.to(roomCode.toUpperCase()).emit('round-ended', {
      song: result.song,
      guesses: result.guesses,
      scores: result.scores,
    });

    if (result.gameOver) {
      setTimeout(() => {
        io.to(roomCode.toUpperCase()).emit('game-over', { scores: result.scores });
      }, 4000);
    }
  });

  // Host advances to the next round
  socket.on('next-round', ({ roomCode }) => {
    const result = gameManager.nextRound(roomCode?.toUpperCase(), socket.id);
    if (!result.success) return;

    if (result.gameOver) {
      stopHintTimer(roomCode.toUpperCase());
      io.to(roomCode.toUpperCase()).emit('game-over', { scores: result.scores });
    } else {
      io.to(roomCode.toUpperCase()).emit('round-start', result.roundData);
      startHintTimer(roomCode.toUpperCase(), result.roundData.settings?.clipDurationMs);
    }
  });

  // Any player can vote to play again after game over
  socket.on('play-again', ({ roomCode }, callback) => {
    const result = gameManager.votePlayAgain(roomCode?.toUpperCase(), socket.id);
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }

    callback?.({ success: true, allVoted: result.allVoted });

    io.to(result.room.code).emit('play-again-update', {
      votes: result.votes,
      required: result.required,
    });

    if (result.allVoted) {
      stopHintTimer(result.room.code);
      io.to(result.room.code).emit('room-update', result.room.getPublicState());
      io.to(result.room.code).emit('rematch-started');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const affected = gameManager.handleDisconnect(socket.id);
    affected.forEach(({ roomCode, room }) => {
      if (room) {
        io.to(roomCode).emit('room-update', room.getPublicState());
      } else {
        io.to(roomCode).emit('room-closed', {
          reason: 'Host disconnected. Room closed.',
        });
        stopHintTimer(roomCode);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Musinary server listening on http://localhost:${PORT}`);
});
