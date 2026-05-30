import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// Single shared socket instance; connect/disconnect manually
export const socket = io(SERVER_URL, { autoConnect: false });

export default socket;
