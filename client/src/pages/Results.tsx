interface Props {
  scores: { id: string; name: string; score: number }[];
  currentPlayerId: string;
  rematchVotes: string[];
  rematchRequired: number;
  onPlayAgain: () => void;
}

const MEDALS = ['1st', '2nd', '3rd'];

export default function Results({ scores, currentPlayerId, rematchVotes, rematchRequired, onPlayAgain }: Props) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const hasVoted = rematchVotes.includes(currentPlayerId);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6 animate-bounce-in">
        {/* Winner banner */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black">{winner?.name} wins!</h1>
          <p className="text-brand-400 text-xl font-bold">{winner?.score} points</p>
        </div>

        {/* Podium */}
        <div className="card space-y-3">
          <h2 className="text-sm text-gray-500 uppercase font-semibold tracking-wider text-center">
            Final Standings
          </h2>
          {sorted.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-4 p-4 rounded-xl transition-all ${
                p.id === currentPlayerId
                  ? 'bg-brand-700/30 border border-brand-600/50'
                  : 'bg-gray-800'
              } ${i === 0 ? 'ring-2 ring-yellow-500/50' : ''}`}
            >
              <span className="text-2xl w-8 text-center">
                {MEDALS[i] ?? `${i + 1}.`}
              </span>
              <span className="flex-1 font-semibold text-lg">
                {p.name}
                {p.id === currentPlayerId && (
                  <span className="ml-2 text-sm text-brand-400">(you)</span>
                )}
              </span>
              <span className="font-black text-2xl text-brand-400">{p.score}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button onClick={onPlayAgain} disabled={hasVoted} className="btn-primary w-full py-4 text-lg">
            {hasVoted ? 'Waiting for others…' : 'Play Again'}
          </button>
          <p className="text-center text-xs text-gray-500">
            {rematchVotes.length} / {rematchRequired || sorted.length} players ready for rematch
          </p>
        </div>

        <p className="text-center text-xs text-gray-600">
          Thanks for playing Musinary!
        </p>
      </div>
    </div>
  );
}
