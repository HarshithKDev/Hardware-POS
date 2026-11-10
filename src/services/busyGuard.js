// Tracks work that must not be interrupted by a page reload (a sale being sent,
// the offline queue being flushed, a return being applied). The app-update
// handler waits until nothing is in progress before reloading.

let busyCount = 0;

export function beginCriticalWork() {
  busyCount += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    busyCount = Math.max(0, busyCount - 1);
  };
}

export function isCriticalWorkInProgress() {
  return busyCount > 0;
}

/** Wraps an async function so it counts as critical work while running. */
export async function runCritical(fn) {
  const end = beginCriticalWork();
  try {
    return await fn();
  } finally {
    end();
  }
}
