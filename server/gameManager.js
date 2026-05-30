const crypto = require('crypto');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function calculatePoints(timeMs) {
  if (timeMs <= 5000) return 1000;
  if (timeMs <= 10000) return 800;
  if (timeMs <= 15000) return 600;
  if (timeMs <= 20000) return 500;
  if (timeMs <= 25000) return 300;
  return 100;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Strips punctuation, feat. tags, brackets, and lowercases for comparison */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/feat\.?.*$/i, '')
    .replace(/ft\.?.*$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkGuess(guess, trackName) {
  const g = normalizeTitle(guess);
  const t = normalizeTitle(trackName);
  if (!g || !t) return false;
  // Strict mode: only exact normalized title matches are correct.
  return g === t;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

class Room {
  constructor(code, hostId, hostName) {
    this.code = code;
    this.hostId = hostId;
    this.hostName = hostName || 'Host';
    this.hostConnected = true;
    this.hostToken = null;
    /** @type {'lobby'|'song-selection'|'playing'|'game-over'} */
    this.phase = 'lobby';
    this.players = [];
    /** @type {Array<{trackId,trackUri,trackName,artistName,albumArt,durationMs,startTimeMs,submittedBy}>} */
    this.songs = [];
    this.currentRoundIndex = -1;
    this.roundStartTime = null;
    /** @type {Map<string,{guess:string,correct:boolean,points:number,timeMs:number}>} */
    this.roundGuesses = new Map();
    /** @type {Set<string>} */
    this.rematchVotes = new Set();
    /** @type {number[]} */
    this.hintRevealOrder = [];
    /** @type {Set<number>} */
    this.hintRevealedIndexes = new Set();
    this.hintMaxReveals = 0;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  allSongsSubmitted() {
    const connected = this.players.filter((p) => p.connected && p.participates);
    return connected.length > 0 && connected.every((p) => p.songSubmitted);
  }

  getPublicState() {
    return {
      code: this.code,
      phase: this.phase,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        songSubmitted: p.songSubmitted,
        participates: p.participates,
        connected: p.connected,
      })),
      hostId: this.hostId,
      hostName: this.hostName,
      hostConnected: this.hostConnected,
      // Only expose full song info after the round is revealed (phase != playing)
      songs: this.songs.map((s, i) => {
        const revealed = this.phase !== 'playing' || i < this.currentRoundIndex;
        return revealed
          ? s
          : {
              submittedBy: s.submittedBy,
              trackId: null,
              trackUri: null,
              trackName: null,
              artistName: null,
              albumArt: null,
              durationMs: null,
              startTimeMs: null,
            };
      }),
      currentRoundIndex: this.currentRoundIndex,
      roundStartTime: this.roundStartTime,
      totalRounds: this.songs.length,
    };
  }
}

// ─── GameManager ──────────────────────────────────────────────────────────────

class GameManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Map<string, string>} playerId → roomCode */
    this.playerRooms = new Map();
  }

  createRoom(hostId, hostName) {
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code, hostId, hostName);
    this.rooms.set(code, room);
    this.playerRooms.set(hostId, code);
    return { room };
  }

  joinRoom(roomCode, playerId, playerName) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.phase === 'playing' || room.phase === 'game-over') {
      return { success: false, error: 'Game already in progress' };
    }
    const nameTaken = room.players.find(
      (p) => p.name.toLowerCase() === playerName.toLowerCase() && p.id !== playerId,
    );
    if (nameTaken) return { success: false, error: 'Name already taken in this room' };

    // Allow re-join by same socket only if somehow re-connecting
    const existing = room.getPlayer(playerId);
    if (existing) {
      existing.connected = true;
      this.playerRooms.set(playerId, roomCode);
      return { success: true, room, player: existing };
    }

    const player = {
      id: playerId,
      name: playerName,
      score: 0,
      songSubmitted: false,
      participates: true,
      connected: true,
    };
    room.players.push(player);
    this.playerRooms.set(playerId, roomCode);
    return { success: true, room, player };
  }

  setHostToken(roomCode, accessToken) {
    const room = this.rooms.get(roomCode);
    if (room) room.hostToken = accessToken;
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode) || null;
  }

  submitSong(roomCode, playerId, songData) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    const player = room.getPlayer(playerId);
    if (!player) return { success: false, error: 'Player not in room' };
    if (!player.participates) return { success: false, error: 'Host does not submit songs' };
    if (!songData?.trackId) return { success: false, error: 'Invalid song data' };

    // Replace any previous submission from this player
    room.songs = room.songs.filter((s) => s.submittedBy !== playerId);
    room.songs.push({
      trackId: songData.trackId,
      trackUri: songData.trackUri,
      trackName: songData.trackName,
      artistName: songData.artistName,
      albumArt: songData.albumArt,
      durationMs: songData.durationMs,
      startTimeMs: Math.max(0, Math.min(songData.startTimeMs, songData.durationMs - 30000)),
      submittedBy: playerId,
    });
    player.songSubmitted = true;

    return { success: true, room, allSubmitted: room.allSongsSubmitted() };
  }

  startGame(roomCode, requesterId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId) return { success: false, error: 'Only the host can start the game' };

    const activePlayers = room.players.filter((p) => p.connected && p.participates);
    if (activePlayers.length === 0) {
      return { success: false, error: 'Need at least one player in the room to start' };
    }
    if (room.songs.length === 0) return { success: false, error: 'No songs have been submitted yet' };

    // Shuffle songs
    for (let i = room.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.songs[i], room.songs[j]] = [room.songs[j], room.songs[i]];
    }

    room.phase = 'playing';
    room.currentRoundIndex = -1;
    room.rematchVotes.clear();
    return { success: true, room };
  }

  startRound(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false };

    room.currentRoundIndex += 1;
    if (room.currentRoundIndex >= room.songs.length) {
      return { success: false, gameOver: true };
    }

    room.roundStartTime = Date.now();
    room.roundGuesses = new Map();

    const song = room.songs[room.currentRoundIndex];
    this.initializeRoundHints(room);

    return {
      success: true,
      roundData: {
        roundIndex: room.currentRoundIndex,
        totalRounds: room.songs.length,
        song: {
          trackId: song.trackId,
          trackUri: song.trackUri,
          startTimeMs: song.startTimeMs,
          submittedBy: song.submittedBy,
          // Title/artist are deliberately omitted — players must guess
        },
        roundStartTime: room.roundStartTime,
        hintMask: this.getCurrentHintMask(room),
        hintMaxReveals: room.hintMaxReveals,
      },
    };
  }

  initializeRoundHints(room) {
    const song = room.songs[room.currentRoundIndex];
    const title = song?.trackName || '';

    const revealableIndexes = [];
    for (let i = 0; i < title.length; i++) {
      if (/[A-Za-z0-9]/.test(title[i])) {
        revealableIndexes.push(i);
      }
    }

    room.hintMaxReveals = Math.floor(revealableIndexes.length * 0.2);
    room.hintRevealOrder = shuffleArray([...revealableIndexes]);
    room.hintRevealedIndexes = new Set();
  }

  getCurrentHintMask(roomOrCode) {
    const room = typeof roomOrCode === 'string' ? this.rooms.get(roomOrCode) : roomOrCode;
    if (!room) return '';

    const song = room.songs[room.currentRoundIndex];
    if (!song?.trackName) return '';

    const title = song.trackName;
    let mask = '';
    for (let i = 0; i < title.length; i++) {
      const ch = title[i];
      if (!/[A-Za-z0-9]/.test(ch)) {
        mask += ch;
      } else {
        mask += room.hintRevealedIndexes.has(i) ? ch : '_';
      }
    }
    return mask;
  }

  revealNextHint(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing') {
      return { success: false, done: true, hintMask: '' };
    }

    if (room.hintRevealedIndexes.size >= room.hintMaxReveals) {
      return {
        success: true,
        done: true,
        hintMask: this.getCurrentHintMask(room),
        revealed: room.hintRevealedIndexes.size,
        maxReveals: room.hintMaxReveals,
      };
    }

    while (room.hintRevealOrder.length > 0 && room.hintRevealedIndexes.size < room.hintMaxReveals) {
      const idx = room.hintRevealOrder.shift();
      if (typeof idx === 'number' && !room.hintRevealedIndexes.has(idx)) {
        room.hintRevealedIndexes.add(idx);
        return {
          success: true,
          done: room.hintRevealedIndexes.size >= room.hintMaxReveals,
          hintMask: this.getCurrentHintMask(room),
          revealed: room.hintRevealedIndexes.size,
          maxReveals: room.hintMaxReveals,
        };
      }
    }

    return {
      success: true,
      done: true,
      hintMask: this.getCurrentHintMask(room),
      revealed: room.hintRevealedIndexes.size,
      maxReveals: room.hintMaxReveals,
    };
  }

  submitGuess(roomCode, playerId, guess) {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return null;

    const previousGuess = room.roundGuesses.get(playerId);
    // Allow multiple guesses, but once a player is correct, lock them for this round.
    if (previousGuess?.correct) return null;

    const song = room.songs[room.currentRoundIndex];
    if (!song) return null;

    // Players cannot guess their own submitted song.
    if (song.submittedBy === playerId) return null;

    const timeMs = Date.now() - room.roundStartTime;
    if (timeMs > 30000) return null; // round over

    const correct = checkGuess(guess, song.trackName);
    const points = correct ? calculatePoints(timeMs) : 0;

    const player = room.getPlayer(playerId);
    if (!player) return null;
    if (!player.participates) return null;

    if (correct) player.score += points;
    room.roundGuesses.set(playerId, { guess, correct, points, timeMs });

    return { correct, points, timeMs, playerName: player.name };
  }

  endRound(roomCode, requesterId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false };
    if (room.hostId !== requesterId) return { success: false };

    const song = room.songs[room.currentRoundIndex];
    const guesses = Array.from(room.roundGuesses.entries()).map(([playerId, data]) => ({
      playerId,
      playerName: room.getPlayer(playerId)?.name ?? 'Unknown',
      ...data,
    }));
    const scores = room.players
      .filter((p) => p.participates)
      .map((p) => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);

    const gameOver = room.currentRoundIndex >= room.songs.length - 1;
    if (gameOver) room.phase = 'game-over';

    return { success: true, song, guesses, scores, gameOver };
  }

  nextRound(roomCode, requesterId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false };
    if (room.hostId !== requesterId) return { success: false };

    if (room.currentRoundIndex >= room.songs.length - 1) {
      room.phase = 'game-over';
      const scores = room.players
        .filter((p) => p.participates)
        .map((p) => ({ id: p.id, name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score);
      return { success: true, gameOver: true, scores };
    }

    return this.startRound(roomCode);
  }

  votePlayAgain(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.phase !== 'game-over') return { success: false, error: 'Game is not over yet' };

    const player = room.getPlayer(playerId);
    if (!player || !player.connected) {
      return { success: false, error: 'Player not in room' };
    }

    room.rematchVotes.add(playerId);

    const connectedPlayers = room.players.filter((p) => p.connected);
    const allVoted = connectedPlayers.length > 0
      && connectedPlayers.every((p) => room.rematchVotes.has(p.id));

    if (allVoted) {
      room.phase = 'lobby';
      room.songs = [];
      room.currentRoundIndex = -1;
      room.roundStartTime = null;
      room.roundGuesses = new Map();
      room.rematchVotes.clear();

      room.players.forEach((p) => {
        p.score = 0;
        p.songSubmitted = p.participates ? false : true;
      });
    }

    return {
      success: true,
      room,
      allVoted,
      votes: Array.from(room.rematchVotes),
      required: connectedPlayers.length,
    };
  }

  handleDisconnect(playerId) {
    const roomCode = this.playerRooms.get(playerId);
    if (!roomCode) return [];

    this.playerRooms.delete(playerId);

    const room = this.rooms.get(roomCode);
    if (!room) return [];

    if (room.hostId === playerId) {
      this.rooms.delete(roomCode);
      return [{ roomCode, room: null, hostDisconnected: true }];
    }

    const player = room.getPlayer(playerId);
    if (player) player.connected = false;
    room.rematchVotes.delete(playerId);

    // Clean up empty rooms
    if (room.players.every((p) => !p.connected)) {
      this.rooms.delete(roomCode);
      return [{ roomCode, room: null }];
    }

    return [{ roomCode, room }];
  }
}

module.exports = GameManager;
