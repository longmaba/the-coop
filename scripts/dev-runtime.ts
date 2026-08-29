type Environment = Readonly<Record<string, string | undefined>>;

export interface DevPorts {
  readonly clientPort: number;
  readonly gameServerPort: number;
}

function portFromEnvironment(
  environment: Environment,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer port between 1 and 65535.`);
  }
  return port;
}

export function resolveDevPorts(
  environment: Environment = process.env,
): DevPorts {
  return Object.freeze({
    clientPort: portFromEnvironment(
      environment,
      'THE_COOP_DEV_CLIENT_PORT',
      5173,
    ),
    gameServerPort: portFromEnvironment(
      environment,
      'THE_COOP_DEV_GAME_SERVER_PORT',
      2567,
    ),
  });
}

export function serverWatchArguments(gameServerPort: number): readonly string[] {
  if (
    !Number.isInteger(gameServerPort)
    || gameServerPort < 1
    || gameServerPort > 65_535
  ) {
    throw new Error('The game server watch port must be between 1 and 65535.');
  }
  return Object.freeze([
    '--watch',
    '--watch-preserve-output',
    '--import',
    'tsx',
    'src/server/index.ts',
    String(gameServerPort),
  ]);
}
