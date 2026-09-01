import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { FlatList } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Screen } from '@/ui/components/Screen';
import { Display, Label, Mono } from '@/ui/components/Txt';
import { Hairline } from '@/ui/components/Hairline';
import { groupTimeline, timelineYears, filterTimeline, type TimelineKind } from '@/domain/upcomingGroups';
import { NoteCard } from '@/ui/components/NoteCard';
import { EmptyState } from '@/ui/components/EmptyState';
import { SwipeToDelete } from '@/ui/components/SwipeToDelete';
import { Chip } from '@/ui/components/Chip';
import { Sheet } from '@/ui/components/Sheet';
import { FlipIcon } from '@/ui/components/FlipIcon';
import { Button } from '@/ui/components/Button';
import { confirmDeleteNote, openNoteMenu } from '@/services/noteActions';
import { uiLang } from '@/ui/theme/locale';
import { useLiveQuery } from '@/ui/hooks/useLiveQuery';
import { DOCK_HEIGHT, R, S } from '@/ui/theme/tokens';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { db } from '@/db';
import { notesRepo, type NoteWithQuestions } from '@/db/repositories/notes';
import { triggersRepo } from '@/db/repositories/triggers';
import { clock } from '@/domain/clock';
import type { Trigger } from '@/domain/types';

/** 1 bilješka / 2-4 bilješke / 5+ bilješki */
function countHr(n: number): string {
  const unit = n === 1 ? 'bilješka' : n < 5 ? 'bilješke' : 'bilješki';
  return n + ' ' + unit;
}

const MONTHS_HR = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Row = { kind: 'month'; key: string; label: string } | { kind: 'note'; key: string; note: NoteWithQuestions; next: Trigger | null };

async function load(archived: boolean) {
  const d = db();
  const notes = archived ? await notesRepo.listArchived(d) : await notesRepo.listActive(d);
  const doneCount = await notesRepo.countArchived(d);
  const active = await triggersRepo.allActive(d);
  const now = clock.now();
  const next = new Map<string, Trigger>();
  for (const t of active) {
    if (t.fireAt == null || t.fireAt <= now) continue;
    const cur = next.get(t.noteId);
    if (!cur || t.fireAt < cur.fireAt!) next.set(t.noteId, t);
  }
  return { notes, next, now, doneCount };
}

export default function TimelineScreen() {
  const router = useRouter();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [showDone, setShowDone] = useState(false);
  const [kindFilter, setKindFilter] = useState<TimelineKind>('all');
  // true = "Sve": by when the note was written (the default — the list you scroll to find something);
  // false = "Kronologija": by when the reminder fires (what is coming, in order). Swapped 2026-08-28 on Marko's
  // note that a CHRONOLOGY should be the order things happen, not the order they were typed.
  const [byCreation, setByCreation] = useState(true);

  // Switching rebuilds every heading and row at once, which is a jarring thing to watch. A circle of accent
  // colour grows out of the button, and the swap happens while it covers the screen.
  // The transition lives in the button, not over the screen: a full-screen wipe was far too big a gesture for
  // a change of list order, and moving that much fill stuttered on device.
  //
  // The list switches on the tap, not at the end of the spin. Holding it back made the button feel like it
  // had not registered — the animation is a flourish on a change that already happened, never a gate in
  // front of it.
  const switchView = useCallback(() => setByCreation((v) => !v), []);
  const [year, setYear] = useState<number | null>(null);
  const { data } = useLiveQuery(() => load(showDone), [showDone]);
  const hr = uiLang() === 'hr';

  const fireOf = useCallback((n: NoteWithQuestions) => data?.next.get(n.id)?.fireAt ?? null, [data]);
  const madeOf = useCallback((n: NoteWithQuestions) => (showDone ? n.updatedAt : n.createdAt), [showDone]);

  // Offered years come from the UNFILTERED list, so picking one never removes the chip you just tapped.
  const years = useMemo(() => (data ? timelineYears(data.notes, fireOf, madeOf) : []), [data, fireOf, madeOf]);
  const notes = useMemo(
    () => (data ? filterTimeline(data.notes, fireOf, madeOf, kindFilter, year) : []),
    [data, fireOf, madeOf, kindFilter, year],
  );

  const filtered = kindFilter !== 'all' || year != null;
  const [filterOpen, setFilterOpen] = useState(false);
  // Below a handful of notes there is nothing to sort through, and "Riješeno" is a short list by nature.
  const canFilter = !showDone && (data?.notes.length ?? 0) > 3;

  const KIND_LABEL: Record<TimelineKind, string> = {
    all: hr ? 'Sve' : 'All',
    dated: hr ? 'S podsjetnikom' : 'With a reminder',
    undated: hr ? 'Kad zatreba' : 'When needed',
  };
  // The button says what is on, so an active filter is never invisible.
  const filterSummary = filtered
    ? [kindFilter === 'all' ? null : KIND_LABEL[kindFilter], year == null ? null : String(year)].filter(Boolean).join(' · ')
    : hr
      ? 'Filter'
      : 'Filter';

  // A filter that survives a switch to a tab where nothing matches looks like an empty app.
  useEffect(() => {
    if (year != null && !years.includes(year)) setYear(null);
  }, [years, year]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    const months = hr ? MONTHS_HR : MONTHS_EN;

    // By date: "Riješeno" always (a finished note has no future), and "Zapisano" on request. Grouping uses
    // the same field the list is sorted by — listArchived() sorts on updated_at, and grouping that on
    // createdAt made the headings repeat and jump (kolovoz → srpanj → kolovoz).
    if (showDone || byCreation) {
      let lastMonth = '';
      for (const n of notes) {
        const d = new Date(showDone ? n.updatedAt : n.createdAt);
        const m = `${d.getFullYear()}-${d.getMonth()}`;
        if (m !== lastMonth) {
          lastMonth = m;
          out.push({ kind: 'month', key: `m-${m}`, label: `${months[d.getMonth()]} ${d.getFullYear()}` });
        }
        // Grouping by date does not hide the reminder: "Zapisano" still shows when each note comes back.
        // A done note genuinely has none.
        out.push({ kind: 'note', key: n.id, note: n, next: showDone ? null : (data.next.get(n.id) ?? null) });
      }
      return out;
    }

    // Active notes group by WHEN THEY HAPPEN — the next reminder's month. Notes with no reminder ("kad
    // zatreba", the ones this app exists for) keep their own sections, by when they were written.
    for (const g of groupTimeline(notes, fireOf, (n) => n.createdAt, hr ? 'hr' : 'en')) {
      out.push({ kind: 'month', key: g.key, label: g.title });
      for (const n of g.items) out.push({ kind: 'note', key: n.id, note: n, next: data.next.get(n.id) ?? null });
    }
    return out;
  }, [data, notes, fireOf, hr, showDone, byCreation]);

  return (
    <>
      <Screen padded={false} edges={[]}>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingTop: insets.top + S.md, paddingHorizontal: S.lg, paddingBottom: DOCK_HEIGHT + S.xxl }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              {/* The title IS the state: two views answering two questions — "what is coming?" (by reminder)
                  and "where is the thing I wrote in July?" (by date written). A pill row would have been a
                  third rack of controls on a screen whose point is the list. */}
              <View style={styles.titleRow}>
                <Display size="xxl" weight="bold" style={{ flex: 1 }}>
                  {showDone ? (hr ? 'Riješeno' : 'Done') : byCreation ? (hr ? 'Sve' : 'All') : hr ? 'Kronologija' : 'Timeline'}
                </Display>
                {/* The icon shows the view you are IN, matching the title beside it: a list for "Sve", a
                    clock for the chronology. An icon showing the destination instead reads as a contradiction
                    of the heading it sits next to. */}
                {!showDone ? (
                  <Pressable
                    onPress={switchView}
                    accessibilityRole="button"
                    accessibilityLabel={byCreation ? (hr ? 'Prikaži kronologiju' : 'Show the timeline') : hr ? 'Prikaži sve' : 'Show all'}
                    style={({ pressed }) => [styles.viewBtn, { borderColor: t.c.glassBorder, backgroundColor: t.c.glass, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <FlipIcon name={byCreation ? 'layers-outline' : 'time-outline'} />
                  </Pressable>
                ) : null}
              </View>
              {/* The count line also says HOW the list is ordered: the icon alone did not tell a first-time user
                  that a second view exists, and the tab still reads "Sve" while the title reads "Kronologija". */}
              <Mono tone="muted" style={{ marginTop: S.xs }}>
                {data
                  ? `${hr ? countHr(notes.length) : `${notes.length} note${notes.length === 1 ? '' : 's'}`}${
                      showDone ? '' : ` · ${byCreation ? (hr ? 'po datumu zapisa' : 'by date written') : hr ? 'po podsjetniku' : 'by reminder'}`
                    }`
                  : ''}
              </Mono>
              {/* Completed notes are archived, not deleted — this is how you get back to them. */}
              <View style={styles.filters}>
                <Chip label={hr ? 'Aktivne' : 'Active'} selected={!showDone} onPress={() => setShowDone(false)} />
                <Chip
                  label={`${hr ? 'Riješeno' : 'Done'}${data?.doneCount ? ` · ${data.doneCount}` : ''}`}
                  selected={showDone}
                  onPress={() => setShowDone(true)}
                />
                {/* Icon only, sized like the chips beside it: the filters are used rarely, and a label that
                    grew with the selection ("Kad zatreba · 2027") kept resizing the row. The accent dot is
                    what makes an active filter impossible to miss — a filter you cannot see is one you
                    forget is on — and the state is spelled out in words inside the sheet. */}
                {canFilter ? (
                  <Pressable
                    onPress={() => setFilterOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={filtered ? `${hr ? 'Filtriraj' : 'Filter'} — ${filterSummary}` : hr ? 'Filtriraj' : 'Filter'}
                    style={({ pressed }) => [
                      styles.filterBtn,
                      { borderColor: filtered ? t.c.accent : t.c.glassBorder, backgroundColor: t.c.glass, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Ionicons name="options-outline" size={18} color={filtered ? t.c.accent : t.c.muted} />
                    {filtered ? <View style={[styles.filterDot, { backgroundColor: t.c.accent, borderColor: t.c.bg }]} /> : null}
                  </Pressable>
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            data ? (
              // An active filter emptied the list — say so and offer the way back, rather than claiming the
              // user has no notes at all when a dozen are one tap away.
              filtered ? (
                <EmptyState
                  title={hr ? 'Ništa pod ovim filterom.' : 'Nothing matches this filter.'}
                  action={{
                    title: hr ? 'Prikaži sve' : 'Show all',
                    onPress: () => {
                      setKindFilter('all');
                      setYear(null);
                    },
                  }}
                />
              ) : (
                <EmptyState
                  title={
                    showDone
                      ? hr
                        ? 'Ništa riješeno još.'
                        : 'Nothing done yet.'
                      : hr
                        ? 'Prva bilješka. Piši kako govoriš, ostalo je moj posao.'
                        : 'Your first note. Write it the way you would say it — the rest is my job.'
                  }
                  body={showDone ? (hr ? 'Kad označiš bilješku riješenom, ovdje je nađeš.' : 'Notes you mark as done show up here.') : undefined}
                  action={showDone ? undefined : { title: hr ? 'Zapiši' : 'Write one', onPress: () => router.push('/capture') }}
                />
              )
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'month' ? (
              // A section divider, not another line of metadata: the old muted micro-label sat at the same
              // visual weight as the card text and read as noise rather than as a heading.
              <View style={styles.month}>
                <Label tone="ion">{item.label}</Label>
                <Hairline style={{ marginTop: S.sm }} />
              </View>
            ) : (
              <SwipeToDelete
                onDelete={() => confirmDeleteNote(item.note.id, item.note.summary ?? item.note.rawText)}
                onLongPress={() =>
                  openNoteMenu({ noteId: item.note.id, summary: item.note.summary ?? item.note.rawText, archived: item.note.archived })
                }
              >
                <View style={styles.card}>
                  <NoteCard note={item.note} nextTrigger={item.next} now={data?.now ?? Date.now()} />
                </View>
              </SwipeToDelete>
            )
          }
        />
      </Screen>

      {/* Above the list, below the filter sheet: the sweep hides a rebuild, it should never cover a dialog. */}
      <Sheet visible={filterOpen} title={hr ? 'Filtriraj' : 'Filter'} onClose={() => setFilterOpen(false)}>
        <View style={styles.sheetBody}>
          <Label tone="muted">{hr ? 'Vrsta' : 'Kind'}</Label>
          <View style={styles.sheetRow}>
            {(['all', 'dated', 'undated'] as const).map((k) => (
              <Chip key={k} label={KIND_LABEL[k]} selected={kindFilter === k} onPress={() => setKindFilter(k)} />
            ))}
          </View>

          {years.length > 1 ? (
            <>
              <Label tone="muted" style={{ marginTop: S.lg }}>
                {hr ? 'Godina' : 'Year'}
              </Label>
              <View style={styles.sheetRow}>
                <Chip label={hr ? 'Sve' : 'All'} selected={year == null} onPress={() => setYear(null)} />
                {years.map((y) => (
                  <Chip key={y} mono label={String(y)} selected={year === y} onPress={() => setYear(y)} />
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.sheetActions}>
            {filtered ? (
              <Button
                title={hr ? 'Poništi' : 'Clear'}
                variant="ghost"
                size="sm"
                onPress={() => {
                  setKindFilter('all');
                  setYear(null);
                }}
              />
            ) : null}
            <Button title={hr ? 'Gotovo' : 'Done'} variant="primary" size="sm" icon="checkmark" onPress={() => setFilterOpen(false)} />
          </View>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: S.md, marginBottom: S.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  // Round and a touch larger than the filter pill: this changes what the whole screen answers, so it reads
  // as a view switch rather than as another filter.
  viewBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: R.pill, borderWidth: StyleSheet.hairlineWidth },
  // Square, matching the chips' 40 px height so the row reads as one set of controls.
  filterBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto', // pushed to the right edge of the Aktivne/Riješeno row
    borderRadius: R.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Sits on the rim; the border in the screen colour keeps it legible against the icon behind it.
  filterDot: { position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  sheetBody: { paddingHorizontal: S.lg, paddingTop: S.md },
  sheetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm, marginTop: S.xl },
  filters: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md },
  month: { marginTop: S.lg, marginBottom: S.sm },
  card: { marginBottom: S.sm },
});
