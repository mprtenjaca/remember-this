// Tiny typed event emitter. The DB emits 'change' after every write; UI hooks re-query.

type Handler<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, h: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(h as Handler<never>);
    return () => set!.delete(h as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of Array.from(set)) (h as Handler<Events[K]>)(payload);
  }
}

export type DbEvents = {
  change: { tables: string[] };
  clock: { now: number };
};

export const dbEvents = new Emitter<DbEvents>();

/** UI-level: a note was just filed by the capture sheet. The tabs layout shows the "Zapisano" bar for it. */
export type CaptureEvents = {
  /**
   * `text` is what was typed — the bar shows it because the enricher has not titled the note yet.
   * `kind` 'answered': a clarify question was answered; the card shows again, but only if the first one is gone.
   */
  saved: { id: string; text: string; kind?: 'saved' | 'answered' };
};

export const captureEvents = new Emitter<CaptureEvents>();

let pending: Set<string> | null = null;

/** Coalesce many writes in one tick into a single 'change' event. */
export function notifyChange(...tables: string[]) {
  if (!pending) {
    pending = new Set(tables);
    queueMicrotask(() => {
      const t = Array.from(pending ?? []);
      pending = null;
      dbEvents.emit('change', { tables: t });
    });
  } else {
    tables.forEach((t) => pending!.add(t));
  }
}
