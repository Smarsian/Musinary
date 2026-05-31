import { Player, RoomState, GameSettings } from '../types';

interface Props {
  room: RoomState;
  currentPlayer: Player | null;
  isHost: boolean;
  onAddSong: () => void;
  onStartGame: () => void;
  onUpdateSettings: (settings: Partial<GameSettings>) => void;
  error: string | null;
}

export default function Lobby({ room, currentPlayer, isHost, onAddSong, onStartGame, onUpdateSettings, error }: Props) {
  const participants = room.players.filter((p) => p.connected && p.participates);
  const allSubmitted = participants.length > 0 && participants.every((p) => p.songSubmitted);
  const submittedCount = participants.filter((p) => p.songSubmitted).length;
  const totalCount = participants.length;
  const clipSeconds = Math.round(room.settings.clipDurationMs / 1000);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <p className="text-gray-500 text-sm uppercase tracking-widest font-semibold">Room Code</p>
          <h1 className="text-5xl font-black tracking-widest mt-1 text-brand-400">{room.code}</h1>
          <p className="text-gray-400 mt-1 text-sm">Share this code with your friends</p>
          <p className="text-xs text-brand-300 mt-2">
            Host display: {room.hostName} {room.hostConnected ? '(connected)' : '(disconnected)'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-400 font-medium">Songs submitted</span>
            <span className="text-sm font-bold text-brand-400">
              {submittedCount} / {totalCount}
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-brand-600 h-2 rounded-full transition-all duration-500"
              style={{ width: totalCount > 0 ? `${(submittedCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
          {allSubmitted && totalCount > 0 && (
            <p className="text-green-400 text-sm mt-2 font-semibold text-center animate-bounce-in">
              All songs in — ready to play!
            </p>
          )}
        </div>

        {/* Player list */}
        <div className="card space-y-3">
          <h2 className="text-sm text-gray-500 uppercase tracking-widest font-semibold">Players</h2>
          {room.players.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                p.connected ? 'bg-gray-800' : 'bg-gray-800/40 opacity-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${p.connected ? 'bg-green-400' : 'bg-gray-600'}`}
                />
                <span className="font-medium">
                  {p.name}
                  {p.id === currentPlayer?.id && (
                    <span className="ml-2 text-xs text-gray-500">(you)</span>
                  )}
                </span>
              </div>
              <span className="text-sm">
                {!p.participates ? (
                  <span className="text-gray-400 font-semibold">Display</span>
                ) : p.songSubmitted ? (
                  <span className="text-green-400 font-semibold">Ready</span>
                ) : (
                  <span className="text-gray-500">Picking…</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Game settings */}
        <div className="card space-y-4">
          <h2 className="text-sm text-gray-500 uppercase tracking-widest font-semibold">Game Settings</h2>

          {isHost ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="clip-duration" className="text-sm text-gray-300 font-medium">
                    Song clip length
                  </label>
                  <span className="text-sm font-mono text-brand-400">{clipSeconds}s</span>
                </div>
                <input
                  id="clip-duration"
                  type="range"
                  min={10}
                  max={60}
                  step={5}
                  value={clipSeconds}
                  onChange={(e) => onUpdateSettings({ clipDurationMs: Number(e.target.value) * 1000 })}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Players can choose any segment window of this length.
                </p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={room.settings.artistBonusEnabled}
                  onChange={(e) => onUpdateSettings({ artistBonusEnabled: e.target.checked })}
                />
                <span className="text-sm text-gray-300">
                  Enable artist guess bonus
                  <span className="block text-xs text-gray-500 mt-1">
                    Correct title + correct artist awards an extra {room.settings.artistBonusPoints} points.
                  </span>
                </span>
              </label>
            </>
          ) : (
            <div className="text-sm text-gray-300 space-y-1">
              <p>Clip length: <span className="text-brand-300 font-semibold">{clipSeconds}s</span></p>
              <p>
                Artist bonus: <span className="text-brand-300 font-semibold">
                  {room.settings.artistBonusEnabled ? `On (+${room.settings.artistBonusPoints})` : 'Off'}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {!isHost && !currentPlayer?.songSubmitted ? (
            <button onClick={onAddSong} className="btn-primary w-full text-lg py-4">
              Pick My Song
            </button>
          ) : !isHost ? (
            <div className="text-center text-green-400 font-semibold py-2">
              Your song is submitted! Waiting for others…
              <button onClick={onAddSong} className="block mx-auto mt-2 text-xs text-gray-500 hover:text-gray-300 underline">
                Change my song
              </button>
            </div>
          ) : (
            <div className="text-center text-brand-300 font-semibold py-2">
              Host display mode active. Share this screen with players.
            </div>
          )}

          {isHost && (
            <button
              onClick={onStartGame}
              disabled={room.songs.length === 0}
              className="btn-secondary w-full"
              title={room.songs.length === 0 ? 'Need at least one song to start' : undefined}
            >
              {allSubmitted ? 'Start Game!' : `Start Anyway (${submittedCount} / ${totalCount} songs)`}
            </button>
          )}
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-950/50 border border-red-800/50 rounded-xl p-3 text-center">
            {error}
          </div>
        )}

        <p className="text-center text-xs text-gray-600">
          Waiting in lobby - {participants.length} player
          {participants.length !== 1 ? 's' : ''} + host connected
        </p>
      </div>
    </div>
  );
}
