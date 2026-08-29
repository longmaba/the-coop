import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  resolveDevPorts,
  serverWatchArguments,
} from "./dev-runtime.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const { clientPort, gameServerPort } = resolveDevPorts();
process.env.VITE_GAME_SERVER_URL ??= `http://127.0.0.1:${gameServerPort}`;

const gameServerProcess = spawn(
  process.execPath,
  serverWatchArguments(gameServerPort),
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  }
);

let shuttingDown = false;
let viteServer = null;

function stopGameServerProcess() {
  if (
    gameServerProcess.exitCode !== null
    || gameServerProcess.signalCode !== null
  ) {
    return Promise.resolve();
  }
  return new Promise((resolveStop) => {
    const forceTimer = setTimeout(() => {
      if (
        gameServerProcess.exitCode === null
        && gameServerProcess.signalCode === null
      ) {
        gameServerProcess.kill("SIGKILL");
      }
    }, 3_000);
    forceTimer.unref();
    gameServerProcess.once("exit", () => {
      clearTimeout(forceTimer);
      resolveStop();
    });
    if (!gameServerProcess.kill("SIGTERM")) {
      clearTimeout(forceTimer);
      resolveStop();
    }
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  process.exitCode = exitCode;
  await Promise.allSettled([
    viteServer?.close(),
    stopGameServerProcess()
  ]);
}

gameServerProcess.once("error", (error) => {
  console.error("[dev] Could not start the watched game server.", error);
  void shutdown(1);
});
gameServerProcess.once("exit", (code, signal) => {
  if (shuttingDown) return;
  console.error(
    `[dev] Watched game server stopped unexpectedly (${signal ?? code ?? "unknown"}).`
  );
  void shutdown(code ?? 1);
});

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

try {
  viteServer = await createViteServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    server: {
      host: "127.0.0.1",
      port: clientPort,
      strictPort: true
    }
  });
  await viteServer.listen();
  viteServer.printUrls();
  console.log(
    `[dev] Authoritative server watches game/server dependencies on port ${gameServerPort}.`
  );
} catch (error) {
  await shutdown(1);
  throw error;
}
