import { useEffect, useRef, useState, useCallback } from 'react';
import { RoundData, RoundEndedPayload, Player } from '../types';
import { playTrack, playTrackOnActiveDevice, pausePlayback, transferPlayback } from '../spotifyAuth';
import socket from '../socket';

interface Props {
  roomCode: string;
  isHost: boolean;
  currentPlayer: Player | null;
  spotifyToken: string | null;
  onGameOver: (scores: { id: string; name: string; score: number }[]) => void;
}

interface LiveGuess {
  playerName: string;
  points: number;
  timeMs: number;
}

const ROUND_DURATION_MS = 30_000;

export default function GamePlay({ roomCode, isHost, currentPlayer, spotifyToken, onGameOver }: Props) {
  const [hostVolume, setHostVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 85;
    const saved = Number(window.localStorage.getItem('musinary-host-volume'));
    if (!Number.isFinite(saved)) return 85;
    return Math.min(100, Math.max(0, Math.round(saved)));
  });
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [round, setRound] = useState<RoundData | null>(null);
  const [roundResult, setRoundResult] = useState<RoundEndedPayload | null>(null);
  const [guess, setGuess] = useState('');
  const [guessStatus, setGuessStatus] = useState<'idle' | 'correct' | 'wrong' | 'sent'>('idle');
  const [liveGuesses, setLiveGuesses] = useState<LiveGuess[]>([]);
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION_MS);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [phase, setPhase] = useState<'countdown' | 'playing' | 'result'>('countdown');
  const [audioArmed, setAudioArmed] = useState(false);
  const [hintMask, setHintMask] = useState('');
  const [hintMaxReveals, setHintMaxReveals] = useState(0);

  const playerRef = useRef<SpotifyPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roundEndedRef = useRef(false);

  // ─── Spotify Web Playback SDK (host only) ──────────────────────────────────
  useEffect(() => {
    if (!isHost || !spotifyToken) return;

    function initPlayer() {
      const player = new window.Spotify.Player({
        name: 'Musinary Party Game',
        getOAuthToken: (cb) => cb(spotifyToken!),
        volume: hostVolume / 100,
      });

      player.addListener('initialization_error', ({ message }) => {
        setSdkError(`Init error: ${message}. Using active Spotify app fallback.`);
      });
      player.addListener('authentication_error', ({ message }) => setSdkError(`Auth error: ${message}`));
      player.addListener('account_error', () =>
        setSdkError('Spotify Premium is required for audio playback.'),
      );
      player.addListener('ready', ({ device_id }) => {
        console.log('[Spotify SDK] Ready, device:', device_id);
        setDeviceId(device_id);
        setSdkReady(true);

        // Force Spotify playback to this browser device so rounds are audible.
        if (spotifyToken) {
          transferPlayback(spotifyToken, device_id, false).catch((e) => {
            setSdkError(e instanceof Error ? e.message : 'Could not transfer playback to web player');
          });
        }
      });
      player.addListener('not_ready', () => {
        console.warn('[Spotify SDK] Not ready');
        setSdkReady(false);
      });

      player.connect();
      playerRef.current = player;
    }

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
    }

    return () => {
      playerRef.current?.disconnect();
    };
  }, [isHost, spotifyToken]);

  // Host volume control for Spotify Web Playback SDK.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('musinary-host-volume', String(hostVolume));
    }

    if (!isHost || !sdkReady || !playerRef.current) return;

    playerRef.current.setVolume(hostVolume / 100).catch(() => {
      setSdkError('Could not adjust host volume on Spotify Web Player.');
    });
  }, [hostVolume, isHost, sdkReady]);

  // ─── Socket event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const onRoundStart = (data: RoundData) => {
      setRound(data);
      setRoundResult(null);
      setGuess('');
      setGuessStatus('idle');
      setLiveGuesses([]);
      roundEndedRef.current = false;
      setPhase('countdown');
      setCountdown(3);
      setTimeLeft(ROUND_DURATION_MS);
      setHintMask(data.hintMask ?? '');
      setHintMaxReveals(data.hintMaxReveals ?? 0);
    };

    const onHintUpdate = (payload: { hintMask: string; maxReveals: number }) => {
      setHintMask(payload.hintMask ?? '');
      setHintMaxReveals(payload.maxReveals ?? 0);
    };

    const onPlayerGuessed = (payload: LiveGuess) => {
      setLiveGuesses((prev) => [...prev, payload]);
    };

    const onRoundEnded = (payload: RoundEndedPayload) => {
      clearTimer();
      setRoundResult(payload);
      setPhase('result');
    };

    const handleGameOverEvent = (payload: { scores: { id: string; name: string; score: number }[] }) => {
      onGameOver(payload.scores);
    };

    socket.on('round-start', onRoundStart);
    socket.on('player-guessed', onPlayerGuessed);
    socket.on('round-ended', onRoundEnded);
    socket.on('game-over', handleGameOverEvent);
    socket.on('hint-update', onHintUpdate);

    return () => {
      socket.off('round-start', onRoundStart);
      socket.off('player-guessed', onPlayerGuessed);
      socket.off('round-ended', onRoundEnded);
      socket.off('game-over', handleGameOverEvent);
      socket.off('hint-update', onHintUpdate);
    };
  }, [onGameOver]);

  // ─── Pre-round countdown ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown' || !round) return;
    if (countdown <= 0) {
      setPhase('playing');
      startRoundTimer();
      if (isHost && spotifyToken) {
        const playPromise = deviceId && audioArmed
          ? transferPlayback(spotifyToken, deviceId, false).then(() =>
              playTrack(spotifyToken, deviceId, round.song.trackUri, round.song.startTimeMs),
            )
          : playTrackOnActiveDevice(spotifyToken, round.song.trackUri, round.song.startTimeMs);

        playPromise.catch((e) => {
          const msg = e instanceof Error ? e.message : 'Playback error';
          setSdkError(msg);
          console.error('Playback error:', e);
        });
      }
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, round, isHost, spotifyToken, deviceId, audioArmed]);

  async function armAudio() {
    if (!isHost || !playerRef.current || !spotifyToken || !deviceId) return;
    try {
      // Required on some browsers (autoplay policy) before programmatic playback.
      playerRef.current.activateElement?.();
      await transferPlayback(spotifyToken, deviceId, false);
      setAudioArmed(true);
      setSdkError(null);
    } catch (e) {
      setSdkError(e instanceof Error ? e.message : 'Failed to enable host audio');
    }
  }

  function startRoundTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, ROUND_DURATION_MS - elapsed);
      setTimeLeft(left);
      if (left === 0) {
        clearTimer();
        if (isHost && !roundEndedRef.current) {
          roundEndedRef.current = true;
          endRound();
        }
      }
    }, 100);
  }

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function endRound() {
    if (isHost && spotifyToken) {
      pausePlayback(spotifyToken).catch(() => {});
    }
    socket.emit('end-round', { roomCode });
  }

  function handleNextRound() {
    socket.emit('next-round', { roomCode });
  }

  const isOwnSongRound = !!(round && currentPlayer && round.song.submittedBy === currentPlayer.id);

  const submitGuess = useCallback(() => {
    if (!guess.trim() || guessStatus !== 'idle' || isHost || isOwnSongRound) return;
    setGuessStatus('sent');
    socket.emit('submit-guess', { roomCode, guess: guess.trim() }, (res: { success: boolean; correct?: boolean; points?: number }) => {
      if (!res?.success) {
        setGuessStatus('idle');
        return;
      }
      if (res.correct) {
        setGuessStatus('correct');
      } else {
        setGuessStatus('wrong');
        setTimeout(() => setGuessStatus('idle'), 1500);
      }
    });
  }, [guess, guessStatus, roomCode, isHost, isOwnSongRound]);

  const progressPct = (timeLeft / ROUND_DURATION_MS) * 100;
  const timerColor =
    timeLeft > 15000 ? 'bg-green-500' : timeLeft > 7000 ? 'bg-yellow-400' : 'bg-red-500';

  // ─── Countdown screen ───────────────────────────────────────────────────────
  if (phase === 'countdown' || !round) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <div className="text-center">
          <p className="text-gray-400 text-lg">
            Round {(round?.roundIndex ?? 0) + 1} of {round?.totalRounds ?? '?'}
          </p>
          <div className="text-9xl font-black text-brand-400 mt-4 animate-bounce-in">{countdown}</div>
          <p className="text-gray-300 mt-4 text-xl">Get ready to listen…</p>
        </div>
        {sdkError && (
          <div className="text-red-400 text-sm bg-red-950/50 border border-red-800 rounded-xl p-3 max-w-sm text-center">
            Playback issue: {sdkError}
          </div>
        )}
      </div>
    );
  }

  // ─── Round result screen ────────────────────────────────────────────────────
  if (phase === 'result' && roundResult) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg space-y-6 animate-bounce-in">
          <div className="text-center">
            <p className="text-gray-400">Round {round.roundIndex + 1} result</p>
            <h2 className="text-2xl font-bold mt-1">The song was…</h2>
          </div>

          {/* Song reveal */}
          <div className="card flex gap-4 items-center">
            {roundResult.song.albumArt && (
              <img
                src={roundResult.song.albumArt}
                alt=""
                className="w-24 h-24 rounded-xl flex-shrink-0 shadow-xl"
              />
            )}
            <div>
              <p className="text-xl font-black">{roundResult.song.trackName}</p>
              <p className="text-gray-400">{roundResult.song.artistName}</p>
            </div>
          </div>

          {/* Guesses */}
          <div className="card space-y-2">
            <h3 className="text-sm text-gray-500 uppercase font-semibold tracking-wider mb-3">Results</h3>
            {roundResult.guesses.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-2">No correct guesses this round.</p>
            )}
            {roundResult.guesses
              .sort((a, b) => (b.correct ? 1 : 0) - (a.correct ? 1 : 0) || a.timeMs - b.timeMs)
              .map((g, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-xl ${
                    g.correct ? 'bg-green-900/40 border border-green-700/50' : 'bg-gray-800'
                  }`}
                >
                  <div>
                    <span className="font-semibold">{g.playerName}</span>
                    <span className={`ml-2 text-sm ${g.correct ? 'text-green-400' : 'text-gray-500'}`}>
                      {g.correct ? `"${g.guess}"` : `"${g.guess}"`}
                    </span>
                  </div>
                  {g.correct && (
                    <span className="text-brand-400 font-bold">+{g.points} pts</span>
                  )}
                </div>
              ))}
          </div>

          {/* Scoreboard */}
          <div className="card space-y-2">
            <h3 className="text-sm text-gray-500 uppercase font-semibold tracking-wider mb-3">Scoreboard</h3>
            {roundResult.scores.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-5 text-sm">{i + 1}.</span>
                  <span className={s.id === currentPlayer?.id ? 'text-brand-400 font-bold' : ''}>{s.name}</span>
                </div>
                <span className="font-bold text-lg">{s.score}</span>
              </div>
            ))}
          </div>

          {isHost && (
            <button onClick={handleNextRound} className="btn-primary w-full py-4 text-lg">
              {round.roundIndex + 1 >= round.totalRounds ? 'See Final Scores' : 'Next Round'}
            </button>
          )}
          {!isHost && (
            <p className="text-center text-gray-500 text-sm">Waiting for host to advance…</p>
          )}
        </div>
      </div>
    );
  }

  // ─── Active round ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-start px-4 pt-8 pb-12">
      <div className="w-full max-w-lg space-y-6">
        {/* Round header */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-200">
            Round {round.roundIndex + 1} / {round.totalRounds}
          </h2>
          <span className={`font-mono text-2xl font-black ${timeLeft < 10000 ? 'text-red-400 animate-pulse' : 'text-brand-400'}`}>
            {Math.ceil(timeLeft / 1000)}s
          </span>
        </div>

        {/* Timer bar */}
        <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full ${timerColor} rounded-full transition-all duration-100`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Mystery album art */}
        <div className="flex justify-center">
          <div className="w-48 h-48 bg-gray-800 rounded-2xl shadow-2xl flex items-center justify-center border-2 border-gray-700">
            <span className="text-2xl font-semibold tracking-widest text-gray-500">MUSINARY</span>
          </div>
        </div>

        {/* Hangman-style hint */}
        <div className="card text-center">
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Title Hint</p>
          <p className="font-mono text-2xl md:text-3xl tracking-[0.2em] text-brand-300 break-words">
            {hintMask || '____'}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            {hintMaxReveals > 0
              ? `Letters reveal over time (max ${hintMaxReveals} this round, capped at 20%).`
              : 'No letter reveals for this short title (20% cap).'}
          </p>
        </div>

        {/* Live guesses feed */}
        {liveGuesses.length > 0 && (
          <div className="card space-y-2">
            <h3 className="text-xs text-gray-500 uppercase font-semibold">Correct guesses</h3>
            {liveGuesses.map((g, i) => (
              <div key={i} className="flex justify-between text-sm animate-bounce-in">
                <span className="text-green-400 font-semibold">{g.playerName}</span>
                <span className="text-brand-400 font-bold">+{g.points} pts ({(g.timeMs / 1000).toFixed(1)}s)</span>
              </div>
            ))}
          </div>
        )}

        {/* Guess input */}
        <div className="space-y-3">
          {isHost && (
            <div className="card text-center text-brand-300 font-semibold py-4">
              Host display mode: players guess on their own devices.
            </div>
          )}
          {isOwnSongRound && (
            <div className="card text-center text-yellow-300 font-semibold py-4">
              This is your submitted song. You cannot guess this round.
            </div>
          )}
          {guessStatus === 'correct' ? (
            <div className="card text-center text-green-400 font-bold text-lg animate-bounce-in py-6">
              You got it!
            </div>
          ) : (
            <>
              <input
                className={`input text-center text-xl py-4 font-semibold transition-colors ${
                  guessStatus === 'wrong' ? 'border-red-500 bg-red-950/30' : ''
                }`}
                placeholder="Song title…"
                value={guess}
                onChange={(e) => {
                  setGuess(e.target.value);
                  if (guessStatus === 'wrong') setGuessStatus('idle');
                }}
                onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
                disabled={guessStatus === 'sent' || isOwnSongRound || isHost}
                autoFocus
              />
              <button
                onClick={submitGuess}
                disabled={!guess.trim() || guessStatus === 'sent' || isOwnSongRound || isHost}
                className="btn-primary w-full py-4 text-lg"
              >
                {guessStatus === 'wrong' ? 'Try again' : 'Submit Guess'}
              </button>
              {guessStatus === 'wrong' && (
                <p className="text-red-400 text-sm text-center animate-bounce-in">
                  Not quite — try again!
                </p>
              )}
            </>
          )}
        </div>

        {/* Host controls */}
        {isHost && (
          <div className="space-y-3 pt-2">
            <div className="flex gap-3 items-center">
              {!audioArmed && sdkReady && (
                <button onClick={armAudio} className="btn-primary text-sm whitespace-nowrap">
                  Enable Host Audio
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowVolumeControl((prev) => !prev)}
                className="btn-secondary text-sm whitespace-nowrap"
                disabled={!sdkReady}
              >
                {showVolumeControl ? 'Hide Volume' : 'Volume'}
              </button>
              <button
                onClick={endRound}
                className="btn-secondary flex-1 text-sm"
              >
                Skip Round
              </button>
            </div>

            {showVolumeControl && (
              <div className="card py-4">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="host-volume" className="text-sm text-gray-400 font-semibold">
                    Host Volume
                  </label>
                  <span className="text-sm font-mono text-brand-400">{hostVolume}%</span>
                </div>
                <input
                  id="host-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={hostVolume}
                  onChange={(e) => setHostVolume(Number(e.target.value))}
                  className="w-full mt-3"
                  disabled={!sdkReady}
                />
              </div>
            )}

            {sdkError && (
              <div className="text-xs text-red-400 self-center">Playback issue: {sdkError}</div>
            )}
            {isHost && spotifyToken && !sdkReady && !sdkError && (
              <div className="text-xs text-yellow-400 self-center">Connecting to Spotify…</div>
            )}
            {isHost && sdkReady && !audioArmed && !sdkError && (
              <div className="text-xs text-yellow-300 self-center">Tap "Enable Host Audio" before round starts.</div>
            )}
          </div>
        )}

        {!isHost && (
          <p className="text-center text-xs text-gray-600">
            Listen to the audio playing in the room and guess the song title!
          </p>
        )}
      </div>
    </div>
  );
}
