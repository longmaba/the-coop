/** True only while an async browser connection still owns the live lifecycle. */
export function ownsBrowserLifecycle<T>(
  currentGeneration: number,
  currentResource: T | null,
  generation: number,
  resource: T,
): boolean {
  return currentGeneration === generation && currentResource === resource;
}

/** Runs destructive failure cleanup only for the attempt that still owns state. */
export function cleanupOwnedBrowserLifecycle<T>(
  currentGeneration: number,
  currentResource: T | null,
  generation: number,
  resource: T,
  cleanup: () => void,
): boolean {
  if (!ownsBrowserLifecycle(currentGeneration, currentResource, generation, resource)) return false;
  cleanup();
  return true;
}
