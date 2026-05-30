import { useEffect, useRef, useState, useCallback } from 'react';
import socket from './socket';
import { AppView, Player, RoomState, TrackInfo } from './types';
import { exchangeCodeForToken, redirectToSpotifyAuth } from './spotifyAuth';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import SongSelector from './pages/SongSelector';
import GamePlay from './pages/GamePlay';
import Results from './pages/Results';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('musinary-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [view, setView] = useState<AppView>('home');
  const [playerName, setPlayerName] = useState('');
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [finalScores, setFinalScores] = useState<{ id: string; name: string; score: number }[]>([]);
  const [rematchVotes, setRematchVotes] = useState<string[]>([]);
  const [rematchRequired, setRematchRequired] = useState(0);

  const isHost = !!(room && socket.id && room.hostId === socket.id);

  const pendingCreateRef = useRef<{ name: string } | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('musinary-theme', theme);
  }, [theme]);

  // ─── Spotify OAuth callback handler ────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');

    if (oauthError) {
      setError('Spotify login was denied or failed.');
      setIsConnecting(false);
      pendingCreateRef.current = null;
      sessionStorage.removeItem('pending_host_name');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (code) {
      // Clear code from URL immediately to prevent re-use on refresh
      window.history.replaceState({}, '', window.location.pathname);

      exchangeCodeForToken(code)
        .then((token) => {
          setSpotifyToken(token);
          const pendingName = pendingCreateRef.current?.name || sessionStorage.getItem('pending_host_name');

          // If there's a pending room creation, proceed now.
          if (pendingName) {
            doCreateRoom(pendingName, token);
            pendingCreateRef.current = null;
            sessionStorage.removeItem('pending_host_name');
          } else {
            setIsConnecting(false);
          }
        })
        .catch((e) => {
          setIsConnecting(false);
          pendingCreateRef.current = null;
          sessionStorage.removeItem('pending_host_name');
          setError(`Spotify auth error: ${e instanceof Error ? e.message : 'Unknown'}`);
        });
    }
  }, []);

  // ─── Socket lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    socket.connect();

    socket.on('connect_error', (err) => {
      setIsConnecting(false);
      setError(`Connection error: ${err.message}`);
    });

    socket.on('disconnect', () => {
      setError('Disconnected from server. Check that backend is running, then try again.');
    });

    socket.on('room-update', (updatedRoom: RoomState) => {
      setRoom(updatedRoom);
      const me = updatedRoom.players.find((p) => p.id === socket.id);
      setCurrentPlayer(me ?? null);
    });

    socket.on('game-started', () => {
      setView('gameplay');
    });

    socket.on('all-songs-ready', () => {
      // Notify host subtly — they'll see the green indicator in lobby
    });

    socket.on('game-over', (payload: { scores: { id: string; name: string; score: number }[] }) => {
      setFinalScores(payload.scores);
      setRematchVotes([]);
      setRematchRequired(0);
      setView('results');
    });

    socket.on('play-again-update', (payload: { votes: string[]; required: number }) => {
      setRematchVotes(payload.votes ?? []);
      setRematchRequired(payload.required ?? 0);
    });

    socket.on('rematch-started', () => {
      setFinalScores([]);
      setRematchVotes([]);
      setRematchRequired(0);
      setView('lobby');
    });

    socket.on('room-closed', (payload: { reason?: string }) => {
      setError(payload?.reason ?? 'Room closed');
      setRoom(null);
      setCurrentPlayer(null);
      setFinalScores([]);
      setView('home');
    });

    return () => {
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off('room-update');
      socket.off('game-started');
      socket.off('all-songs-ready');
      socket.off('game-over');
      socket.off('play-again-update');
      socket.off('rematch-started');
      socket.off('room-closed');
      socket.disconnect();
    };
  }, []);

  // Sync current player whenever room updates
  useEffect(() => {
    if (room && socket.id) {
      const me = room.players.find((p) => p.id === socket.id);
      if (me) setCurrentPlayer(me);
    }
  }, [room]);

  // Send host token to server whenever it becomes available
  useEffect(() => {
    if (spotifyToken && room?.code && isHost) {
      socket.emit('host-token', { roomCode: room.code, accessToken: spotifyToken });
    }
  }, [spotifyToken, room?.code, isHost]);

  // ─── Room actions ────────────────────────────────────────────────────────────
  function doCreateRoom(name = 'Host', token?: string | null) {
    setIsConnecting(true);
    setError(null);

    socket.timeout(8000).emit('create-room', { hostName: name }, (err: Error | null, res: { success: boolean; roomCode: string; room: RoomState; error?: string }) => {
      setIsConnecting(false);
      if (err) {
        setError('Server did not respond in time. Check backend/CORS and try again.');
        return;
      }
      if (!res.success) {
        setError(res.error ?? 'Failed to create room');
        return;
      }
      setPlayerName(name);
      setCurrentPlayer(null);
      setRoom(res.room);
      // Send token immediately if we have one
      if (token) {
        socket.emit('host-token', { roomCode: res.roomCode, accessToken: token });
      }
      setView('lobby');
    });
  }

  async function handleConnectSpotifyHost() {
    setError(null);

    // If we already have a token, skip OAuth and create immediately.
    if (spotifyToken) {
      doCreateRoom('Host', spotifyToken);
      return;
    }

    pendingCreateRef.current = { name: 'Host' };
    sessionStorage.setItem('pending_host_name', 'Host');
    setIsConnecting(true);

    try {
      await redirectToSpotifyAuth();
    } catch (e) {
      pendingCreateRef.current = null;
      sessionStorage.removeItem('pending_host_name');
      setIsConnecting(false);
      setError(e instanceof Error ? e.message : 'Failed to start Spotify login');
    }
  }

  function handleJoinRoom(code: string, name: string) {
    setIsConnecting(true);
    setError(null);

    socket.timeout(8000).emit('join-room', { roomCode: code, playerName: name }, (err: Error | null, res: { success: boolean; player: Player; room: RoomState; error?: string }) => {
      setIsConnecting(false);
      if (err) {
        setError('Join request timed out. Verify server is reachable and room code is valid.');
        return;
      }
      if (!res.success) {
        setError(res.error ?? 'Failed to join room');
        return;
      }
      setPlayerName(name);
      setCurrentPlayer(res.player);
      setRoom(res.room);
      setView('lobby');
    });
  }

  const handleStartGame = useCallback(() => {
    if (!room) return;
    socket.timeout(8000).emit('start-game', { roomCode: room.code }, (err: Error | null, res: { success: boolean; error?: string }) => {
      if (err) {
        setError('Start game request timed out.');
        return;
      }
      if (!res.success) setError(res.error ?? 'Failed to start game');
    });
  }, [room]);

  const handleSubmitSong = useCallback(
    (songData: TrackInfo & { startTimeMs: number }) => {
      if (!room) return;
      socket.timeout(8000).emit('submit-song', { roomCode: room.code, songData }, (err: Error | null, res: { success: boolean; error?: string }) => {
        if (err) {
          setError('Song submission timed out. Try again.');
          return;
        }
        if (!res.success) {
          setError(res.error ?? 'Failed to submit song');
        } else {
          setView('lobby');
        }
      });
    },
    [room],
  );

  const handleGameOver = useCallback((scores: { id: string; name: string; score: number }[]) => {
    setFinalScores(scores);
    setView('results');
  }, []);

  function handlePlayAgain() {
    if (!room) return;
    socket.timeout(8000).emit('play-again', { roomCode: room.code }, (err: Error | null, res: { success: boolean; error?: string }) => {
      if (err) {
        setError('Play again request timed out.');
        return;
      }
      if (!res?.success) {
        setError(res?.error ?? 'Failed to vote for play again.');
      }
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell min-h-screen">
      <button
        type="button"
        onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        className="fixed right-4 top-4 z-[60] btn-secondary px-3 py-2 text-sm"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </button>

      {view === 'home' && (
        <Home
          onConnectSpotifyHost={handleConnectSpotifyHost}
          onJoinRoom={handleJoinRoom}
          isConnecting={isConnecting}
          error={error}
        />
      )}

      {view === 'lobby' && room && (
        <>
          <Lobby
            room={room}
            currentPlayer={currentPlayer}
            isHost={isHost}
            onAddSong={() => setView('song-selector')}
            onStartGame={handleStartGame}
            error={error}
          />
        </>
      )}

      {view === 'song-selector' && room && (
        <SongSelector
          roomCode={room.code}
          spotifyToken={spotifyToken}
          onSubmit={handleSubmitSong}
          onCancel={() => setView('lobby')}
        />
      )}

      {view === 'gameplay' && room && (
        <GamePlay
          roomCode={room.code}
          isHost={isHost}
          currentPlayer={currentPlayer}
          spotifyToken={spotifyToken}
          onGameOver={handleGameOver}
        />
      )}

      {view === 'results' && (
        <Results
          scores={finalScores}
          currentPlayerId={socket.id ?? ''}
          rematchVotes={rematchVotes}
          rematchRequired={rematchRequired}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}
