// Spotify Web Playback SDK type declarations

interface SpotifyPlayerOptions {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
}

interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      id: string;
      name: string;
      artists: { name: string }[];
      album: { images: { url: string }[] };
    };
  };
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement?(): void;
  addListener(event: 'ready', cb: (data: { device_id: string }) => void): void;
  addListener(event: 'not_ready', cb: (data: { device_id: string }) => void): void;
  addListener(event: 'player_state_changed', cb: (state: SpotifyPlayerState | null) => void): void;
  addListener(event: 'initialization_error', cb: (err: { message: string }) => void): void;
  addListener(event: 'authentication_error', cb: (err: { message: string }) => void): void;
  addListener(event: 'account_error', cb: (err: { message: string }) => void): void;
  removeListener(event: string, cb?: (...args: unknown[]) => void): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  getCurrentState(): Promise<SpotifyPlayerState | null>;
}

interface Window {
  onSpotifyWebPlaybackSDKReady: () => void;
  Spotify: {
    Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer;
  };
}
