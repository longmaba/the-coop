import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { URL } from 'node:url';
import {
  CloseCode,
  Protocol,
  Transport,
  connectClientToRoom,
  getBearerToken,
  matchMaker,
} from '@colyseus/core';
import { WebSocketServer, type WebSocket } from 'ws';
import { WebSocketClient } from '@colyseus/ws-transport/WebSocketClient';

type RawClient = WebSocket & { pingCount: number };
const PING_INTERVAL_MS = 3_000;
const PING_MAX_RETRIES = 2;

/**
 * The installed ws transport marks Express optional but imports it eagerly.
 * This is the same Colyseus websocket connection adapter without that unused
 * HTTP middleware dependency; Colyseus still owns matchmaking and protocol I/O.
 */
export class LocalWebSocketTransport extends Transport {
  override readonly server: HttpServer;
  private readonly webSocketServer: WebSocketServer;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.server = createServer();
    this.webSocketServer = new WebSocketServer({
      server: this.server,
      maxPayload: 4 * 1024,
      perMessageDeflate: false,
    });
    this.webSocketServer.on('connection', (client, request) => {
      void this.onConnection(client as RawClient, request);
    });
    this.webSocketServer.on('error', () => undefined);
    this.server.on('listening', () => this.startHeartbeat());
    this.server.on('close', () => this.stopHeartbeat());
  }

  listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void): this {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  shutdown(): void {
    this.stopHeartbeat();
    this.webSocketServer.close();
    this.server.close();
  }

  override simulateLatency(milliseconds: number): void {
    void milliseconds;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      for (const socket of this.webSocketServer.clients) {
        const client = socket as RawClient;
        if (client.pingCount >= PING_MAX_RETRIES) {
          client.terminate();
          continue;
        }
        client.pingCount += 1;
        client.ping();
      }
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async onConnection(rawClient: RawClient, request: IncomingMessage): Promise<void> {
    rawClient.on('error', () => undefined);
    rawClient.on('pong', () => {
      rawClient.pingCount = 0;
    });
    rawClient.pingCount = 0;

    const parsedUrl = new URL(`ws://server${request.url ?? '/'}`);
    const sessionId = parsedUrl.searchParams.get('sessionId');
    const roomId = parsedUrl.pathname.match(/\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)$/)?.[1];
    if (sessionId === null || roomId === undefined) {
      const timeout = setTimeout(() => rawClient.close(CloseCode.NORMAL_CLOSURE), 1_000);
      rawClient.on('message', () => rawClient.send(new Uint8Array([Protocol.PING])));
      rawClient.on('close', () => clearTimeout(timeout));
      return;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const authorization = request.headers.authorization;
    const forwardedIp = request.headers['x-real-ip'] ?? request.headers['x-forwarded-for'];
    const token = parsedUrl.searchParams.get('_authToken')
      ?? (typeof authorization === 'string' ? getBearerToken(authorization) : undefined);
    const client = new WebSocketClient(sessionId, rawClient);
    const reconnectionToken = parsedUrl.searchParams.get('reconnectionToken');
    try {
      await connectClientToRoom(
        matchMaker.getLocalRoomById(roomId),
        client,
        {
          headers,
          ip: forwardedIp ?? request.socket.remoteAddress ?? '',
          ...(token === undefined ? {} : { token }),
        },
        {
          skipHandshake: parsedUrl.searchParams.has('skipHandshake'),
          ...(reconnectionToken === null ? {} : { reconnectionToken }),
        },
      );
    } catch (error: unknown) {
      const details = error as { code?: number; message?: string };
      client.error(details.code ?? CloseCode.WITH_ERROR, details.message ?? 'Unable to join room', () => {
        rawClient.close(reconnectionToken === null ? CloseCode.WITH_ERROR : CloseCode.FAILED_TO_RECONNECT);
      });
    }
  }
}
