import { useState } from 'react';

interface Props {
  onConnectSpotifyHost: () => void;
  onJoinRoom: (code: string, name: string) => void;
  isConnecting: boolean;
  error: string | null;
}

export default function Home({ onConnectSpotifyHost, onJoinRoom, isConnecting, error }: Props) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() && code.trim()) onJoinRoom(code.trim().toUpperCase(), name.trim());
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="text-center mb-10">
        <h1 className="text-5xl font-black tracking-tight text-brand-400">
          Musinary
        </h1>
        <p className="mt-2 text-gray-400 text-lg">Made by Smarsian</p>
      </div>

      <div className="card w-full max-w-md">
        {/* Tab switcher */}
        <div className="flex rounded-xl overflow-hidden mb-6 bg-gray-800">
          {(['create', 'join'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                tab === t ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-brand-600'
              }`}
            >
              {t === 'create' ? 'Create Room' : 'Join Room'}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-yellow-950/60 border border-yellow-800/50 p-4 text-sm text-yellow-300">
              <span className="font-semibold">Host requirements:</span> You need a{' '}
              <span className="font-semibold">Spotify Premium</span> account to host — your device plays the
              audio for everyone.
            </div>

            <button
              type="button"
              onClick={onConnectSpotifyHost}
              disabled={isConnecting}
              className="w-full flex items-center justify-center gap-2 bg-[#1DB954] hover:bg-[#1aa34a] text-black font-bold py-3 px-6 rounded-xl transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              {isConnecting ? 'Connecting…' : 'Connect Spotify & Host Game'}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Hosting is screen-share mode only. Joiners play from their own devices.
            </p>
          </div>
        ) : (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Your name</label>
              <input
                className="input"
                placeholder="e.g. Melody Master"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Room code</label>
              <input
                className="input uppercase tracking-widest text-center text-xl font-bold"
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
            </div>
            <button type="submit" disabled={!name.trim() || !code.trim() || isConnecting} className="btn-primary w-full">
              {isConnecting ? 'Joining…' : 'Join Game →'}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 text-red-400 text-sm bg-red-950/50 border border-red-800/50 rounded-xl p-3 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
