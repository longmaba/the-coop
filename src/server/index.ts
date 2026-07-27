import { Server } from '@colyseus/core';
import { pathToFileURL } from 'node:url';
import { CoopRoom } from './CoopRoom.ts';
import { LocalWebSocketTransport } from './LocalWebSocketTransport.ts';

export { CoopRoom, CoopStateSchema, PlayerSchema } from './CoopRoom.ts';

export function createGameServer(): Server {
  const gameServer = new Server({
    transport: new LocalWebSocketTransport(),
    greet: false,
    gracefullyShutdown: false,
  });
  gameServer.define('coop', CoopRoom);
  return gameServer;
}

export async function startGameServer(port = 2567, hostname = '127.0.0.1'): Promise<Server> {
  const gameServer = createGameServer();
  await gameServer.listen(port, hostname);
  return gameServer;
}

const isDirectEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectEntry) {
  void startGameServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
