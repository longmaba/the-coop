import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { startGameServer } from "../src/server/index.ts";

const gameServer = await startGameServer(2567, "127.0.0.1");
const viteServer = await createViteServer({
  configFile: resolve("vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});

await viteServer.listen();
viteServer.printUrls();

let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  process.exitCode = exitCode;
  await Promise.allSettled([
    viteServer.close(),
    gameServer.gracefullyShutdown(false)
  ]);
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
