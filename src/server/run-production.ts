import { runProductionServerFromEnvironment } from './production.ts';

void runProductionServerFromEnvironment().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
