/** PKCE helpers for Spotify OAuth */

function getValidatedSpotifyClientId(): string {
  const clientId = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();

  if (!clientId || clientId === 'your_spotify_client_id_here') {
    throw new Error(
      'Spotify Client ID is not configured. Set VITE_SPOTIFY_CLIENT_ID in client/.env and restart Vite.',
    );
  }

  // Spotify app client IDs are 32-character alphanumeric strings.
  if (!/^[A-Za-z0-9]{32}$/.test(clientId)) {
    throw new Error(
      'Spotify Client ID format looks invalid. Copy the exact Client ID from Spotify Developer Dashboard.',
    );
  }

  return clientId;
}

function generateCodeVerifier(length = 128): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(arr, (x) => chars[x % chars.length]).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function redirectToSpotifyAuth(): Promise<void> {
  const clientId = getValidatedSpotifyClientId();
  const redirectUri = import.meta.env.VITE_REDIRECT_URI ?? window.location.origin;

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: [
      'streaming',
      'user-read-email',
      'user-read-private',
      'user-read-playback-state',
      'user-modify-playback-state',
    ].join(' '),
    state: crypto.randomUUID(),
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const clientId = getValidatedSpotifyClientId();
  const redirectUri = import.meta.env.VITE_REDIRECT_URI ?? window.location.origin;
  const verifier = sessionStorage.getItem('pkce_verifier');

  if (!verifier) throw new Error('PKCE verifier missing — please try logging in again.');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? 'Token exchange failed');

  sessionStorage.removeItem('pkce_verifier');
  return data.access_token as string;
}

/** Transfer playback to the Web Playback SDK device */
export async function transferPlayback(
  token: string,
  deviceId: string,
  play = false,
): Promise<void> {
  const res = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play,
    }),
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Failed to transfer playback to web player');
  }
}

/** Start Spotify playback at a specific position on the SDK device */
export async function playTrack(
  token: string,
  deviceId: string,
  trackUri: string,
  positionMs: number,
): Promise<void> {
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [trackUri], position_ms: positionMs }),
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Playback failed. Ensure host account is Premium and device is active.');
  }
}

/** Fallback: play on whichever Spotify device is currently active for the user */
export async function playTrackOnActiveDevice(
  token: string,
  trackUri: string,
  positionMs: number,
): Promise<void> {
  let res = await fetch('https://api.spotify.com/v1/me/player/play', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [trackUri], position_ms: positionMs }),
  });

  // If no active device, attempt automatic transfer to an available device.
  if (res.status === 404) {
    const devicesRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!devicesRes.ok) {
      const err = await devicesRes.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? 'Could not list Spotify devices');
    }

    const data = (await devicesRes.json()) as {
      devices?: Array<{ id: string; is_restricted?: boolean }>;
    };

    const targetDevice = data.devices?.find((d) => d.id && !d.is_restricted);

    if (!targetDevice?.id) {
      throw new Error('No Spotify devices are available. Open Spotify on phone/desktop and keep it online.');
    }

    await transferPlayback(token, targetDevice.id, false);

    res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDevice.id)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [trackUri], position_ms: positionMs }),
      },
    );
  }

  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Fallback playback failed on Spotify device');
  }
}

/** Pause Spotify playback */
export async function pausePlayback(token: string): Promise<void> {
  const res = await fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 404 means no currently active device; safe to ignore at round end.
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Pause failed');
  }
}
