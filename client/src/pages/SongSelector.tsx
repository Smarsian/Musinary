import { useEffect, useRef, useState } from 'react';
import SegmentSlider from '../components/SegmentSlider';
import { TrackInfo } from '../types';
import { pausePlayback, playTrackOnActiveDevice } from '../spotifyAuth';

const API_BASE = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function toApiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function startHostPreview(roomCode: string, trackUri: string, positionMs: number): Promise<void> {
  const res = await fetch(toApiUrl('/api/preview/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, trackUri, positionMs }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to start host preview');
  }
}

async function stopHostPreview(roomCode: string): Promise<void> {
  const res = await fetch(toApiUrl('/api/preview/stop'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to stop host preview');
  }
}

interface Props {
  roomCode: string;
  spotifyToken: string | null;
  onSubmit: (song: TrackInfo & { startTimeMs: number }) => void;
  onCancel: () => void;
}

function extractTrackId(input: string): string | null {
  // Handles: https://open.spotify.com/track/ID, spotify:track:ID, or raw ID
  const urlMatch = input.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = input.match(/spotify:track:([A-Za-z0-9]{22})/);
  if (uriMatch) return uriMatch[1];
  if (/^[A-Za-z0-9]{22}$/.test(input.trim())) return input.trim();
  return null;
}

export default function SongSelector({ roomCode, spotifyToken, onSubmit, onCancel }: Props) {
  const [url, setUrl] = useState('');
  const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null);
  const [startTimeMs, setStartTimeMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchTrack() {
    setError(null);
    const trackId = extractTrackId(url.trim());
    if (!trackId) {
      setError('Paste a valid Spotify track link (e.g. https://open.spotify.com/track/…)');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        toApiUrl(`/api/track/${encodeURIComponent(roomCode)}/${encodeURIComponent(trackId)}`),
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to fetch track');
      }
      const data: TrackInfo = await res.json();
      setTrackInfo(data);
      // Default start: midpoint of the track (more interesting than the start)
      const mid = Math.max(0, Math.floor(data.durationMs / 2 / 1000) * 1000 - 15000);
      setStartTimeMs(Math.min(mid, data.durationMs - 30000));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function stopPreview() {
    if (previewStopTimerRef.current) {
      clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    if (spotifyToken) {
      try {
        await pausePlayback(spotifyToken);
      } catch {
        // ignore pause errors here; preview state should still reset
      }
    } else {
      try {
        await stopHostPreview(roomCode);
      } catch {
        // ignore host pause errors here; preview state should still reset
      }
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPreviewing(false);
  }

  async function togglePreview() {
    if (previewing) {
      await stopPreview();
      return;
    }
    if (!trackInfo) return;
    setError(null);

    try {
      setPreviewing(true);
      if (spotifyToken) {
        await playTrackOnActiveDevice(spotifyToken, trackInfo.trackUri, startTimeMs);
      } else {
        await startHostPreview(roomCode, trackInfo.trackUri, startTimeMs);
      }

      // Auto-stop after 30 seconds so preview matches game clip length.
      previewStopTimerRef.current = setTimeout(() => {
        stopPreview();
      }, 30_000);
    } catch (e) {
      if (!spotifyToken && trackInfo.previewUrl) {
        try {
          const audio = new Audio(trackInfo.previewUrl);
          audioRef.current = audio;
          await audio.play();
          previewStopTimerRef.current = setTimeout(() => {
            stopPreview();
          }, 30_000);
          return;
        } catch {
          // continue and show original error message
        }
      }
      setPreviewing(false);
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  }

  useEffect(() => {
    return () => {
      if (previewStopTimerRef.current) {
        clearTimeout(previewStopTimerRef.current);
      }
      if (spotifyToken) {
        pausePlayback(spotifyToken).catch(() => {});
      } else {
        stopHostPreview(roomCode).catch(() => {});
      }
    };
  }, [spotifyToken, roomCode]);

  useEffect(() => {
    // If the user drags the segment while previewing, stop and let them re-preview.
    if (previewing) {
      stopPreview();
    }
  }, [startTimeMs]);

  function handleSubmit() {
    if (!trackInfo) return;
    onSubmit({ ...trackInfo, startTimeMs });
  }

  function msToTime(ms: number) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">🎵 Pick Your Song</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-brand-600 text-2xl leading-none">
            ×
          </button>
        </div>

        {/* URL input */}
        <div className="space-y-3">
          <label className="block text-sm text-gray-400">Paste a Spotify track link</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="https://open.spotify.com/track/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchTrack()}
            />
            <button
              onClick={fetchTrack}
              disabled={loading || !url.trim()}
              className="btn-primary px-4 whitespace-nowrap"
            >
              {loading ? '…' : 'Load'}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Track info + segment selector */}
        {trackInfo && (
          <div className="mt-6 space-y-5 animate-bounce-in">
            {/* Album card */}
            <div className="flex gap-4 bg-gray-800 rounded-xl p-4">
              {trackInfo.albumArt && (
                <img
                  src={trackInfo.albumArt}
                  alt={trackInfo.trackName}
                  className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="font-bold text-lg leading-tight truncate">{trackInfo.trackName}</p>
                <p className="text-gray-400 truncate">{trackInfo.artistName}</p>
                <p className="text-gray-500 text-sm mt-1">Duration: {msToTime(trackInfo.durationMs)}</p>
              </div>
            </div>

            {/* Segment slider */}
            <div>
              <h3 className="text-sm text-gray-400 mb-3 font-semibold uppercase tracking-wider">
                Select your 30-second segment
              </h3>
              <SegmentSlider
                durationMs={trackInfo.durationMs}
                startTimeMs={startTimeMs}
                onChange={setStartTimeMs}
              />
            </div>

            <button
              onClick={togglePreview}
              disabled={!trackInfo}
              className="btn-secondary w-full py-3"
            >
              {previewing ? '⏹ Stop Preview' : '▶ Preview This 30-Second Clip'}
            </button>

            {/* Preview note */}
            <div className="text-xs text-gray-500 bg-gray-800/50 rounded-xl p-3">
              💡 <strong>Tip:</strong> Drag the purple window to choose the part that will play during the
              game. Pick something catchy — or deviously obscure!
              <br />
              <span className="text-gray-600 mt-1 block">
                Preview plays on the host's Spotify device.
              </span>
            </div>

            {/* Submit */}
            <button onClick={handleSubmit} className="btn-primary w-full py-4 text-lg">
              ✅ Submit Song
            </button>
          </div>
        )}

        {/* How-to if nothing loaded yet */}
        {!trackInfo && !loading && (
          <div className="mt-8 text-center text-gray-600 text-sm space-y-2">
            <div className="text-4xl">🔗</div>
            <p>Open Spotify, find any track, tap <strong>Share → Copy Link</strong>, then paste it above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
