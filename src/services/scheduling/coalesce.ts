// Run an async job, never concurrently, never with a stale result.
//
// The obvious guard — `if (running) return running` — hands a mid-flight promise to a caller who arrived
// AFTER the data changed. For notification refill that meant a reminder toggled off and straight back on kept
// the "off" scheduling: active in the database, absent from the OS.
//
// So callers coalesce FORWARD. While a run is in progress, everyone who asks shares a single trailing run that
// starts once the current one finishes — the state is read fresh, and a burst of taps still costs two runs
// rather than one per tap.

export function coalesce<T>(work: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  let trailing: Promise<T> | null = null;

  const start = (): Promise<T> => {
    const p = work().finally(() => {
      if (inFlight === p) inFlight = null;
    });
    inFlight = p;
    return p;
  };

  return () => {
    if (!inFlight) return start();
    // Someone is mid-run and the world has changed since it began: queue exactly one fresh run behind it.
    if (!trailing) {
      trailing = inFlight
        .catch(() => undefined) // the trailing run must happen even if the current one failed
        .then(() => {
          trailing = null;
          return start();
        });
    }
    return trailing;
  };
}
