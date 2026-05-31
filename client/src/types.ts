export interface Player {
  id: string;
  name: string;
  participates: boolean;
  score: number;
  songSubmitted: boolean;
  connected: boolean;
}

export interface Song {
  trackId: string;
  trackUri: string;
  trackName: string;
  artistName: string;
  albumArt: string;
  durationMs: number;
  startTimeMs: number;
  submittedBy: string;
}

export type GamePhase = 'lobby' | 'song-selection' | 'playing' | 'game-over';

export interface GameSettings {
  clipDurationMs: number;
  artistBonusEnabled: boolean;
  artistBonusPoints: number;
}

export interface RoomState {
  code: string;
  phase: GamePhase;
  hostId: string;
  hostName: string;
  hostConnected: boolean;
  players: Player[];
  songs: Partial<Song>[];
  currentRoundIndex: number;
  roundStartTime: number | null;
  totalRounds: number;
  settings: GameSettings;
}

export interface RoundData {
  roundIndex: number;
  totalRounds: number;
  song: {
    trackId: string;
    trackUri: string;
    startTimeMs: number;
    submittedBy: string;
  };
  roundStartTime: number;
  hintMask: string;
  hintMaxReveals: number;
  settings: GameSettings;
}

export interface GuessResult {
  playerId: string;
  playerName: string;
  guess: string;
  artistGuess?: string;
  correct: boolean;
  artistCorrect?: boolean;
  basePoints?: number;
  artistBonusPoints?: number;
  points: number;
  timeMs: number;
}

export interface RoundEndedPayload {
  song: Song;
  guesses: GuessResult[];
  scores: { id: string; name: string; score: number }[];
}

export interface TrackInfo {
  trackId: string;
  trackUri: string;
  trackName: string;
  artistName: string;
  albumArt: string;
  durationMs: number;
  previewUrl?: string | null;
}

/** Game context shape passed down via React context */
export interface GameContextValue {
  playerId: string;
  playerName: string;
  setPlayerName: (n: string) => void;
  isHost: boolean;
  roomCode: string;
  room: RoomState | null;
  spotifyToken: string | null;
  setSpotifyToken: (t: string | null) => void;
  view: AppView;
  setView: (v: AppView) => void;
  createRoom: (name: string) => void;
  joinRoom: (code: string, name: string) => void;
}

export type AppView = 'home' | 'lobby' | 'song-selector' | 'gameplay' | 'results';
