import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { dbEvents } from '@/lib/events';

/**
 * Run an async DB query; re-run whenever the DB changes, the clock is time-travelled,
 * or the screen regains focus. Keeps the previous data while refreshing (no flicker).
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const q = useCallback(query, deps);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await q();
      if (alive.current && my === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (alive.current && my === seq.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (alive.current && my === seq.current) setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const off1 = dbEvents.on('change', () => void refresh());
    const off2 = dbEvents.on('clock', () => void refresh());
    return () => {
      alive.current = false;
      off1();
      off2();
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { data, loading, error, refresh };
}
