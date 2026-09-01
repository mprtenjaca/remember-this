// DEV: time travel. Swaps the app clock for a FakeClock, re-runs Today (fires what is due),
// and shows the next 90 days + OS slot usage. This is the test device until the dev build exists.

import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { R, S } from '@/ui/theme/tokens';
import { Body, Display, Label, Mono } from '@/ui/components/Txt';
import { Button } from '@/ui/components/Button';
import { Chip } from '@/ui/components/Chip';
import { Hairline } from '@/ui/components/Hairline';
import { useLiveQuery } from '@/ui/hooks/useLiveQuery';
import { clock, FakeClock, resetClock, setClock, SystemClock, DAY_MS } from '@/domain/clock';
import { dbEvents } from '@/lib/events';
import { db, resetDb } from '@/db';
import { triggersRepo } from '@/db/repositories/triggers';
import { notesRepo } from '@/db/repositories/notes';
import { anchorsRepo } from '@/db/repositories/anchors';
import { surfacingsRepo } from '@/db/repositories/surfacings';
import { scheduler, inExpoGo } from '@/services/notifications';
import { ensureNotificationPermission } from '@/services/notifications/permission';
import { refillScheduledWindow } from '@/services/scheduling/refill';
import { loadToday } from '@/services/today';
import { capture } from '@/services/capture';
import { processQueue } from '@/services/ai/queue';
import { answerAnchor } from '@/services/anchors';
import { fmtDateTime, fmtDayMonth, fmtTime } from '@/domain/dates';
import { aiConfigured } from '@/services/ai/client';
import { resetOnboarding } from '@/services/onboarding';

let fake: FakeClock | null = null;

function travel(ms: number) {
  if (!fake) {
    fake = new FakeClock(SystemClock.now());
    setClock(fake);
  }
  fake.advance(ms);
  dbEvents.emit('clock', { now: fake.now() });
}

/**
 * Back to the present — and clean up after the trip.
 *
 * Travelling forward runs the real pipeline: surfacings get written and triggers get marked fired. Restoring
 * only the clock left that paperwork in the database, dated in the future, so a reminder due in January
 * showed up on today's screen and its trigger stayed spent. Undo both, then re-fill the OS slots.
 */
async function reset() {
  const wasFake = fake != null;
  fake = null;
  resetClock();
  const now = SystemClock.now();
  if (wasFake) {
    const d = db();
    await surfacingsRepo.removeAfter(d, now);
    await triggersRepo.rewindFiringsAfter(d, now);
    await refillScheduledWindow();
  }
  dbEvents.emit('clock', { now });
}

/**
 * The one thing no unit test can answer: does a real notification arrive, with our sound and our icon? Ten seconds
 * so the app can be sent to the background first — a banner while the app is open is not the same check.
 * Uses the real clock deliberately: the OS knows nothing about FakeClock time travel.
 */
async function testNotification() {
  const { granted } = await ensureNotificationPermission();
  if (!granted) {
    Alert.alert('Nema dozvole', 'Obavijesti nisu dopuštene — uključi ih u postavkama sustava.');
    return;
  }
  await scheduler.schedule({
    triggerId: 'debug',
    noteId: 'debug',
    fireAt: Date.now() + 10_000,
    title: 'Test — čuje li se ding?',
    body: 'Ako čuješ zvuk i vidiš žarulju u statusnoj traci, M4 radi.',
  });
  Alert.alert('Zakazano', 'Stiže za 10 sekundi. Prebaci app u pozadinu.');
}

async function load() {
  const d = db();
  const now = clock.now();
  const upcoming = await triggersRepo.upcoming(d, now, now + 90 * DAY_MS, 60);
  const notes = new Map((await notesRepo.byIds(d, Array.from(new Set(upcoming.map((t) => t.noteId))))).map((n) => [n.id, n]));
  const os = await scheduler.listScheduled();
  const waiting = (await triggersRepo.countActiveScheduled(d, now)) - os.length;
  const surf = await surfacingsRepo.recent(d, now - 30 * DAY_MS);
  const anchors = await anchorsRepo.all(d);
  const pending = await notesRepo.listByStatus(d, 'pending', 50);
  return { now, upcoming, notes, os, waiting: Math.max(0, waiting), surf, anchors, pending: pending.length, isFake: fake != null };
}

export default function DebugTimeline() {
  const t = useTheme();
  const router = useRouter();
  const { data, refresh } = useLiveQuery(load, []);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      try {
        await fn();
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh],
  );

  const seed = () =>
    run('seed', async () => {
      const ids = await Promise.all([
        capture('Ana želi Dyson fen za rođendan'),
        capture('Ivan preporučio Auto X za servis'),
        capture('podsjeti me u 15h nazvati Marka'),
        capture('Restoran Foša u Zadru — odlična riba, rezervirati terasu'),
      ]);
      await processQueue();
      await answerAnchor({ noteId: ids[0]!, person: 'Ana', kind: 'birthday', monthDay: '03-14', source: 'user' });
    });

  const now = data?.now ?? clock.now();

  return (
    <ScrollView style={{ backgroundColor: t.c.bg }} contentContainerStyle={styles.wrap}>
      <View style={[styles.box, { backgroundColor: t.c.surface, borderColor: data?.isFake ? t.c.signal : t.c.hairline }]}>
        <Label tone={data?.isFake ? 'signal' : 'muted'}>{data?.isFake ? 'FAKE CLOCK' : 'system clock'}</Label>
        <Display size="xl" style={{ marginTop: S.xs }}>
          <Mono tone="fg" size="xl">
            {fmtDateTime(now)}
          </Mono>
        </Display>
        <View style={styles.chips}>
          <Chip mono label="+1d" onPress={() => travel(DAY_MS)} />
          <Chip mono label="+1w" onPress={() => travel(7 * DAY_MS)} />
          <Chip mono label="+1m" onPress={() => travel(30 * DAY_MS)} />
          <Chip mono label="+6m" onPress={() => travel(182 * DAY_MS)} />
          <Chip mono label="reset" onPress={() => void run('reset-clock', reset)} selected={!!data?.isFake} />
        </View>
        <View style={[styles.chips, { marginTop: S.sm }]}>
          <Button title="Evaluiraj Today" variant="primary" size="sm" onPress={() => run('today', loadToday)} />
          <Button title="Refill slotova" variant="soft" size="sm" onPress={() => run('refill', refillScheduledWindow)} />
          {/* Dev build only: the one thing that cannot be tested without the OS — does a real notification arrive,
              with our sound and our icon? Fires in 10 s so the app can be backgrounded to see it properly. */}
          {!inExpoGo ? <Button title="Test obavijest (10 s)" variant="soft" size="sm" icon="notifications-outline" onPress={() => run('notify', testNotification)} disabled={!!busy} /> : null}
        </View>
      </View>

      <View style={[styles.box, { backgroundColor: t.c.surface, borderColor: t.c.hairline }]}>
        <View style={styles.row}>
          <Label>OS slotovi</Label>
          <Mono tone={data && data.os.length > 50 ? 'signal' : 'fg'}>
            {data?.os.length ?? 0} / {scheduler.capacity()}
          </Mono>
        </View>
        <View style={[styles.row, { marginTop: S.xs }]}>
          <Label>čeka u bazi</Label>
          <Mono>{data?.waiting ?? 0}</Mono>
        </View>
        <View style={[styles.row, { marginTop: S.xs }]}>
          <Label>enrich queue</Label>
          <Mono>
            {data?.pending ?? 0} pending · {aiConfigured() ? 'gemini' : 'heuristic'}
          </Mono>
        </View>
        <View style={[styles.row, { marginTop: S.xs }]}>
          <Label>anchori</Label>
          <Mono numberOfLines={2} style={{ flex: 1, textAlign: 'right' }}>
            {data?.anchors.map((a) => `${a.person} ${a.monthDay}`).join(' · ') || '—'}
          </Mono>
        </View>
      </View>

      <Label style={{ marginTop: S.lg }}>Sljedećih 90 dana</Label>
      <Hairline style={{ marginTop: S.sm }} />
      {data?.upcoming.length === 0 ? (
        <Body tone="muted" style={{ marginTop: S.md }}>
          Ništa zakazano.
        </Body>
      ) : null}
      {data?.upcoming.map((tr) => (
        <View key={tr.id} style={styles.line}>
          <Mono tone="accent" style={{ width: 52 }}>
            {fmtDayMonth(tr.fireAt!)}
          </Mono>
          <Mono tone="muted" style={{ width: 48 }}>
            {fmtTime(tr.fireAt!)}
          </Mono>
          <Body size="sm" numberOfLines={1} style={{ flex: 1 }}>
            {data.notes.get(tr.noteId)?.summary ?? '?'}
          </Body>
          <Mono tone="muted" size="xs">
            {tr.label ?? tr.type}
            {tr.osNotificationId ? ' ●' : ' ○'}
          </Mono>
        </View>
      ))}

      <Label style={{ marginTop: S.xl }}>Surfacings (30 d)</Label>
      <Hairline style={{ marginTop: S.sm }} />
      {data?.surf.map((s) => (
        <View key={s.id} style={styles.line}>
          <Mono tone="muted" style={{ width: 100 }}>
            {fmtDayMonth(s.shownAt)} {fmtTime(s.shownAt)}
          </Mono>
          <Mono size="xs" style={{ width: 90 }}>
            {s.channel}
          </Mono>
          <Mono tone={s.reaction === 'wrong' ? 'danger' : s.reaction ? 'accent' : 'muted'} size="xs">
            {s.reaction ?? '—'}
          </Mono>
        </View>
      ))}

      <View style={[styles.chips, { marginTop: S.xxl }]}>
        <Button title={busy === 'seed' ? '…' : 'Seed 4 primjera'} variant="soft" size="sm" onPress={seed} disabled={!!busy} />
        <Button title="Enrich queue →" variant="soft" size="sm" onPress={() => run('queue', processQueue)} disabled={!!busy} />
        <Button title="Reset baze" variant="danger" size="sm" onPress={() => run('reset', async () => { await resetDb(); await scheduler.cancelAll(); })} disabled={!!busy} />
        {/* Opens the welcome right now, on top of this screen, so copy and motion can be checked without a cold
            start. `preview=1` makes its last button come BACK here instead of replacing the stack with the
            tabs, and leaves the onboarded flag alone — a preview must not re-arm the real first launch. */}
        <Button title="Onboarding" variant="soft" size="sm" icon="play-outline" onPress={() => router.push({ pathname: '/onboarding', params: { preview: '1' } })} disabled={!!busy} />
        {/* The real thing: clears the flag so the NEXT cold start behaves like a fresh install. */}
        <Button title="Reset onboardinga" variant="ghost" size="sm" onPress={() => run('onboarding', resetOnboarding)} disabled={!!busy} />
      </View>
      <Mono tone="muted" size="xs" style={{ marginTop: S.md }}>
        ● zakazano u OS-u (mock) · ○ čeka rotaciju
      </Mono>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: S.lg, paddingBottom: 64 },
  box: { borderRadius: R.lg, borderWidth: StyleSheet.hairlineWidth, padding: S.lg, marginBottom: S.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.sm },
});
