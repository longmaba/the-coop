// PM2 loads ecosystem files through CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');

const releaseDirectory = process.env.THE_COOP_RELEASE_DIR ?? path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'the-coop',
      cwd: releaseDirectory,
      script: 'src/server/production.ts',
      interpreter: process.env.THE_COOP_NODE_PATH ?? 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '768M',
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 35_000,
      time: true,
      env: {
        NODE_ENV: 'production',
        THE_COOP_HOST: process.env.THE_COOP_HOST ?? '127.0.0.1',
        THE_COOP_PORT: process.env.THE_COOP_PORT ?? '6000',
      },
    },
  ],
};
