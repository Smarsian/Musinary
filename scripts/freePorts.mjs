import killPort from 'kill-port';

const ports = [3001, 5173, 5174, 5175, 5176, 5177];

async function freePort(port) {
  try {
    await killPort(port, 'tcp');
    console.log(`Freed port ${port}`);
  } catch {
    // No process bound to this port, nothing to do.
  }
}

await Promise.all(ports.map((port) => freePort(port)));
