import { Client } from '@colyseus/sdk';
import { CoopStateSchema } from '../src/server/index.ts';

const rawEndpoint = process.argv[2] ?? process.env.THE_COOP_VPS_URL;
if (rawEndpoint === undefined) {
  throw new Error('Provide the deployed HTTP(S) URL as the first argument or THE_COOP_VPS_URL.');
}
const parsedEndpoint = new URL(rawEndpoint);
if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
  throw new Error('The deployed URL must use HTTP or HTTPS.');
}
const endpoint = parsedEndpoint.origin;

async function waitFor(check, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function leaveQuietly(room) {
  if (room === undefined) return;
  try {
    await room.leave();
  } catch {
    // The peer or server may already have closed the room.
  }
}

const page = await fetch(`${endpoint}/`);
if (!page.ok || !(await page.text()).includes('The Coop')) {
  throw new Error(`Static application check failed with HTTP ${page.status}.`);
}
const health = await fetch(`${endpoint}/__healthcheck`);
if (!health.ok || await health.text() !== 'OK') {
  throw new Error(`Server health check failed with HTTP ${health.status}.`);
}

let creator;
let guest;
try {
  creator = await new Client(endpoint).create('coop', {}, CoopStateSchema);
  guest = await new Client(endpoint).joinById(creator.roomId, {}, CoopStateSchema);
  await waitFor(
    () => creator.state.phase === 'playing'
      && guest.state.phase === 'playing'
      && creator.state.players.length === 2,
    'the two-player room to enter play',
  );
  console.log(JSON.stringify({
    ok: true,
    endpoint,
    roomId: creator.roomId,
    phase: creator.state.phase,
    players: creator.state.players.length,
  }));
} finally {
  await leaveQuietly(guest);
  await leaveQuietly(creator);
}
