// Keeps the "reading" cards on screen long enough to be read.
//
// The live query drops a note out of `reading` the moment enrichment finishes — often under a second, which
// made the card flash. This hook remembers when each card first appeared and keeps it until the guaranteed
// window has passed (readingHold.ts), then removes it on its own.

import { useEffect, useRef, useState } from 'react';
import { remainingHold } from '@/ui/components/readingHold';

/**
 * @param pendingIds ids currently being enriched, from the live query
 * @returns the ids to actually render, including ones whose work just finished but whose window has not
 */
export function useReadingCards(pendingIds: string[]): string[] {
  // id → when we first showed it
  const shownAt = useRef(new Map<string, number>());
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    const now = Date.now();
    for (const id of pendingIds) if (!shownAt.current.has(id)) shownAt.current.set(id, now);

    const next: string[] = [];
    let soonest = Infinity;
    for (const [id, at] of shownAt.current) {
      const stillWorking = pendingIds.includes(id);
      const left = remainingHold(at, now);
      if (stillWorking || left > 0) {
        next.push(id);
        if (!stillWorking) soonest = Math.min(soonest, left);
      } else {
        shownAt.current.delete(id);
      }
    }

    setVisible((prev) => (prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));

    // Re-check exactly when the earliest hold expires — no polling.
    if (soonest !== Infinity) {
      const timer = setTimeout(() => {
        const t = Date.now();
        const after: string[] = [];
        for (const [id, at] of shownAt.current) {
          if (pendingIds.includes(id) || remainingHold(at, t) > 0) after.push(id);
          else shownAt.current.delete(id);
        }
        setVisible(after);
      }, soonest + 30);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pendingIds]);

  return visible;
}
