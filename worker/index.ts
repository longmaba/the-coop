import type { MoveTargetCommand, RestartCommand } from '../src/game/index.ts';
import {
  HostedGameService,
  HostedServiceError,
} from '../src/hosted/service.ts';
import { D1HostedRoomStore, ensureHostedSchema } from './d1-room-store.ts';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;
const MAX_COMMAND_BYTES = 1_024;
let schemaReady: Promise<void> | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,256})$/u.exec(authorization);
  if (match?.[1] === undefined) {
    throw new HostedServiceError(401, 'invalid-seat', 'That seat is unavailable.');
  }
  return match[1];
}

async function requestObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HostedServiceError(415, 'invalid-content-type', 'Expected a JSON request.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMAND_BYTES) {
    throw new HostedServiceError(413, 'request-too-large', 'The request is too large.');
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_COMMAND_BYTES) {
    throw new HostedServiceError(413, 'request-too-large', 'The request is too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HostedServiceError(400, 'invalid-json', 'Expected a valid JSON request.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HostedServiceError(400, 'invalid-request', 'The request is invalid.');
  }
  return value as Record<string, unknown>;
}

async function optionalRequestObject(request: Request): Promise<Record<string, unknown> | undefined> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMAND_BYTES) {
    throw new HostedServiceError(413, 'request-too-large', 'The request is too large.');
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_COMMAND_BYTES) {
    throw new HostedServiceError(413, 'request-too-large', 'The request is too large.');
  }
  if (body.length === 0) return undefined;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HostedServiceError(415, 'invalid-content-type', 'Expected a JSON request.');
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HostedServiceError(400, 'invalid-json', 'Expected a valid JSON request.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HostedServiceError(400, 'invalid-request', 'The request is invalid.');
  }
  return value as Record<string, unknown>;
}

async function ensureSchemaOnce(database: D1Database): Promise<void> {
  schemaReady ??= ensureHostedSchema(database).catch((error: unknown) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
}

async function handleRoomsApi(request: Request, env: Env): Promise<Response> {
  await ensureSchemaOnce(env.DB);
  const service = new HostedGameService(new D1HostedRoomStore(env.DB));
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length === 2 && request.method === 'POST') {
    return json(await service.createRoom(await optionalRequestObject(request)), 201);
  }
  if (segments.length !== 4 || segments[0] !== 'api' || segments[1] !== 'rooms') {
    throw new HostedServiceError(404, 'not-found', 'The requested endpoint does not exist.');
  }

  const roomId = decodeURIComponent(segments[2] ?? '');
  const action = segments[3];
  if (action === 'join' && request.method === 'POST') {
    return json(await service.joinRoom(roomId, await optionalRequestObject(request)));
  }

  const token = bearerToken(request);
  if (action === 'reconnect' && request.method === 'POST') {
    return json(await service.reconnectRoom(roomId, token));
  }
  if (action === 'state' && request.method === 'GET') {
    return json(await service.getState(roomId, token));
  }
  if (action === 'move' && request.method === 'POST') {
    const body = await requestObject(request);
    return json(await service.move(roomId, token, body as unknown as MoveTargetCommand));
  }
  if (action === 'replay' && request.method === 'POST') {
    const body = await requestObject(request);
    return json(await service.replay(roomId, token, body as unknown as RestartCommand));
  }
  if (action === 'advance' && request.method === 'POST') {
    const body = await requestObject(request);
    return json(await service.advance(roomId, token, body as unknown as RestartCommand));
  }
  if (action === 'leave' && request.method === 'POST') {
    await service.leave(roomId, token);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  throw new HostedServiceError(405, 'method-not-allowed', 'That action is not available.');
}

async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/rooms')) return env.ASSETS.fetch(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    return await handleRoomsApi(request, env);
  } catch (error) {
    if (error instanceof HostedServiceError) {
      return json({ code: error.code, message: error.message }, error.status);
    }
    console.error('Hosted room request failed.', error);
    return json(
      { code: 'server-error', message: 'The game server could not complete the request.' },
      500,
    );
  }
}

export default { fetch } satisfies ExportedHandler<Env>;
