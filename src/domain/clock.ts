// ⚠ The only source of time in the whole app. Never call Date.now() in domain code.

export interface Clock {
  now(): number;
  timezone(): string;
}

export const SystemClock: Clock = {
  now: () => Date.now(),
  timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export class FakeClock implements Clock {
  constructor(
    private t: number,
    private tz = 'Europe/Zagreb',
  ) {}
  now() {
    return this.t;
  }
  timezone() {
    return this.tz;
  }
  advance(ms: number) {
    this.t += ms;
  }
  advanceDays(d: number) {
    this.advance(d * 86_400_000);
  }
  set(iso: string) {
    this.t = Date.parse(iso);
  }
}

/**
 * App-wide clock handle. Defaults to SystemClock; the debug timeline swaps in a
 * FakeClock ("time travel") without touching any domain code.
 */
let current: Clock = SystemClock;

export const clock: Clock = {
  now: () => current.now(),
  timezone: () => current.timezone(),
};

export function setClock(c: Clock) {
  current = c;
}

export function resetClock() {
  current = SystemClock;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
