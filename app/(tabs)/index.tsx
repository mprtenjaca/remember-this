import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/ui/components/Screen';
import { Body, Display, Label, Mono } from '@/ui/components/Txt';
import { SurfacingCard } from '@/ui/components/SurfacingCard';
import { ClarifyCard } from '@/ui/components/ClarifyCard';
import { ReadingCard, ExplainerSheet, ExplainerButton } from '@/ui/components/ReadingCard';
import { useReadingCards } from '@/ui/hooks/useReadingCards';
import { explainerSeen, markExplainerSeen } from '@/services/explainer';
import { SwipeToDelete } from '@/ui/components/SwipeToDelete';
import { confirmDeleteNote, openNoteMenu } from '@/services/noteActions';
import { uiLang } from '@/ui/theme/locale';
import { EmptyState } from '@/ui/components/EmptyState';
import { Glass } from '@/ui/components/Glass';
import { Button } from '@/ui/components/Button';
import { Hairline } from '@/ui/components/Hairline';
import { useLiveQuery } from '@/ui/hooks/useLiveQuery';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { R, S } from '@/ui/theme/tokens';
import { loadToday, react } from '@/services/today';
import { retryEnrich } from '@/services/ai/queue';
import { deleteDraft, listDrafts } from '@/services/drafts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { endOfDay, fmtDate, fmtDayMonth, fmtMonthAbbr, fmtRelative, fmtTime, weekdayName } from '@/domain/dates';
import { groupUpcoming } from '@/domain/upcomingGroups';
import type { Reaction } from '@/domain/types';

export default function TodayScreen() {
  const t = useTheme();
  const router = useRouter();
  const { data } = useLiveQuery(loadToday, []);
  const { data: drafts } = useLiveQuery(listDrafts, []);

  const onReact = useCallback((id: string, r: Reaction) => void react(id, r), []);

  const hr = uiLang() === 'hr';
  // The explainer is a first-run thing: shown with the first note, dismissable with X, and afterwards
  // reachable from the 💡 in the header.
  const [seenExplainer, setSeenExplainer] = useState<boolean | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  useEffect(() => {
    void explainerSeen().then(setSeenExplainer);
  }, []);
  const readingIds = useReadingCards((data?.reading ?? []).map((n) => n.id));
  const now = data?.now ?? Date.now();
  // Later today vs. later days: today's items get the top card ("Danas" is never "ništa" while something is due
  // in 18 minutes); everything after midnight stays under "Dolazi".
  const todayItems = (data?.upcoming ?? []).filter((u) => u.trigger.fireAt! <= endOfDay(now));
  const laterItems = (data?.upcoming ?? []).filter((u) => u.trigger.fireAt! > endOfDay(now));
  // The horizon runs years out, so the list carries its own headings: this month → month name → year.
  const laterGroups = groupUpcoming(laterItems, (u) => u.trigger.fireAt!, now, hr ? 'hr' : 'en');
  const quiet = data && data.surfaced.length === 0 && data.clarify.length === 0 && data.failed.length === 0;
  const empty = quiet && todayItems.length === 0;

  return (
    <>
      <Screen scroll>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Display size="xxl" weight="bold">
              {hr ? 'Danas' : 'Today'}
            </Display>
            <Mono tone="muted" style={{ marginTop: S.xs }}>
              {weekdayName(now, hr ? 'hr' : 'en')} · {fmtDate(now)}
            </Mono>
          </View>
          {/* Once the first-run card is gone, this is the way back to the explanation. */}
          {seenExplainer ? <ExplainerButton onPress={() => setShowExplainer((v) => !v)} /> : null}
        </View>

        {drafts && drafts.length > 0 ? (
          <View style={styles.block}>
            <Label style={{ marginBottom: S.sm }}>{hr ? 'Nedovršeno' : 'Unfinished'}</Label>
            {drafts.map((d) => (
              <Glass key={d.id} radius={R.lg} style={{ marginBottom: S.sm }}>
                <View style={styles.draftRow}>
                  <Pressable
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: S.md }}
                    accessibilityRole="button"
                    accessibilityLabel={`${hr ? 'Nastavi' : 'Continue'}: ${d.text}`}
                    onPress={() => router.push({ pathname: '/capture', params: { draft: d.id } })}
                  >
                    <View style={[styles.draftIcon, { backgroundColor: t.c.accentSoft }]}>
                      <Ionicons name="create-outline" size={16} color={t.c.ion} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={2}>{d.text}</Body>
                      <Mono tone="muted" size="xs">
                        {fmtRelative(d.updatedAt, now, hr ? 'hr' : 'en')} · {hr ? 'tapni za nastavak' : 'tap to continue'}
                      </Mono>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => void deleteDraft(d.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={hr ? 'Odbaci nedovršeno' : 'Discard draft'}>
                    <Ionicons name="close" size={18} color={t.c.muted} />
                  </Pressable>
                </View>
              </Glass>
            ))}
          </View>
        ) : null}

        {showExplainer ? (
          <View style={styles.block}>
            <ExplainerSheet onClose={() => setShowExplainer(false)} />
          </View>
        ) : null}

        {readingIds.map((id) => {
          const n = data?.reading.find((x) => x.id === id);
          const first = seenExplainer === false && id === readingIds[0];
          return (
            <View key={id} style={styles.block}>
              <ReadingCard
                showExplainer={first}
                onDismissExplainer={first ? () => void markExplainerSeen().then(() => setSeenExplainer(true)) : undefined}
                onDoItMyself={n ? () => router.push({ pathname: '/note/[id]', params: { id: n.id } }) : undefined}
              />
            </View>
          );
        })}

        {data?.surfaced.map((item, i) => (
          <View key={item.surfacing.id} style={styles.block}>
            <SurfacingCard item={item} now={now} index={i} onReact={onReact} />
          </View>
        ))}

        {data?.clarify.map((n) => (
          <View key={n.id} style={styles.block}>
            <ClarifyCard note={n} />
          </View>
        ))}

        {data?.failed.map((n) => (
          <View key={n.id} style={styles.block}>
            <Glass radius={R.xl} borderColor={t.c.danger}>
              <View style={styles.failed}>
                <Body tone="fg2" size="sm">
                  {hr ? 'Nisam uspio pročitati ovu bilješku. Spremljena je.' : 'I could not read this note. It is saved.'}
                </Body>
                <Display size="lg" weight="semi" style={{ marginTop: S.xs }}>
                  {n.rawText}
                </Display>
                <Button title={hr ? 'Pokušaj ponovno' : 'Try again'} variant="glass" size="sm" icon="refresh" style={{ alignSelf: 'flex-start', marginTop: S.md }} onPress={() => void retryEnrich(n.id)} />
              </View>
            </Glass>
          </View>
        ))}

        {quiet && todayItems.length > 0 ? (
          <View style={styles.block}>
            <Glass radius={R.xl}>
              <View style={styles.todayCard}>
                <View style={styles.head}>
                  <View style={[styles.badge, { backgroundColor: t.c.accentSoft }]}>
                    <Ionicons name="time-outline" size={14} color={t.c.ion} />
                  </View>
                  <Label tone="ion">{hr ? (todayItems.length === 1 ? 'Danas još jedno' : `Danas još ${todayItems.length}`) : todayItems.length === 1 ? 'One more today' : `${todayItems.length} more today`}</Label>
                </View>
                {todayItems.map((u, i) => (
                  <SwipeToDelete
                    key={u.trigger.id}
                    onDelete={() => confirmDeleteNote(u.note.id, u.note.summary ?? u.note.rawText)}
                    onLongPress={() => openNoteMenu({ noteId: u.note.id, summary: u.note.summary ?? u.note.rawText, archived: u.note.archived })}
                  >
                  <Pressable
                    onPress={() => router.push({ pathname: '/note/[id]', params: { id: u.note.id } })}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.todayRow, i === todayItems.length - 1 ? { borderBottomWidth: 0 } : { borderBottomColor: t.c.hairline }, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={styles.todayTime}>
                      <Display size="lg" weight="semi" tone="fg">
                        {fmtTime(u.trigger.fireAt!)}
                      </Display>
                      <Mono tone="muted" size="xs">
                        {fmtRelative(u.trigger.fireAt!, now, hr ? 'hr' : 'en')}
                      </Mono>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={2}>{u.note.summary ?? u.note.rawText}</Body>
                      {u.trigger.label ? (
                        <Mono tone="muted" size="xs" numberOfLines={1}>
                          {u.anchor ? `${u.anchor.label} · ` : ''}
                          {u.trigger.label}
                        </Mono>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.c.muted} />
                  </Pressable>
                  </SwipeToDelete>
                ))}
              </View>
            </Glass>
          </View>
        ) : null}

        {empty ? (
          data.totalNotes === 0 ? (
            <EmptyState
              title={hr ? 'Ništa još. Zapiši nešto — vratit ću ti kad zatreba.' : 'Nothing yet. Write something down — I will bring it back when it matters.'}
              body={
                hr
                  ? 'Piši kako govoriš. Datum, osobu i razlog ja izvučem sam; pitam samo ono što ne mogu znati.'
                  : 'Write the way you speak. I work out the date, the person and the reason; I only ask what I cannot know.'
              }
              action={{ title: hr ? 'Zapiši prvu bilješku' : 'Write your first note', onPress: () => router.push('/capture') }}
            />
          ) : (
            <EmptyState
              title={hr ? 'Danas ništa.' : 'Nothing today.'}
              body={hr ? 'Bolje propustiti nego lažno pozvati. Tvoje bilješke čekaju svoj trenutak.' : 'Better to miss than to call falsely. Your notes are waiting for their moment.'}
            />
          )
        ) : null}

        {laterItems.length > 0 ? (
          <View style={{ marginTop: S.xxl }}>
            <Label>{hr ? 'Dolazi' : 'Coming up'}</Label>
            <Hairline style={{ marginTop: S.sm }} />
            {laterGroups.map((g, gi) => (
              <View key={g.key}>
                {/* The first heading is dropped only when it would restate "Dolazi" — i.e. the list starts
                    in the current month. When everything is months or years out, that first heading is the
                    whole point ("2027"), so it stays. */}
                {gi > 0 || !g.isCurrentMonth ? (
                  <Label tone="ion" style={{ marginTop: gi === 0 ? S.md : S.xl, marginBottom: S.xs }}>
                    {g.title}
                  </Label>
                ) : null}
                {g.items.map((u, ri) => (
              <SwipeToDelete
                key={u.trigger.id}
                onDelete={() => confirmDeleteNote(u.note.id, u.note.summary ?? u.note.rawText)}
                onLongPress={() => openNoteMenu({ noteId: u.note.id, summary: u.note.summary ?? u.note.rawText, archived: u.note.archived })}
              >
              <Pressable
                onPress={() => router.push({ pathname: '/note/[id]', params: { id: u.note.id } })}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.upRow,
                  ri < g.items.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.c.hairline } : null,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                {/* Day over month, so the column stays narrow whatever the date. "za 5 mjeseci" used to sit
                    under the date inside 64 px and wrapped onto two lines; it now has the full right edge. */}
                <View style={styles.upDate}>
                  <Display size="lg" weight="semi" tone="accent">
                    {new Date(u.trigger.fireAt!).getDate()}.
                  </Display>
                  <Mono tone="muted" size="xs">
                    {fmtMonthAbbr(u.trigger.fireAt!, hr ? 'hr' : 'en')}
                  </Mono>
                </View>
                <View style={styles.upBody}>
                  <Body numberOfLines={1}>{u.note.summary ?? u.note.rawText}</Body>
                  <Mono tone="muted" size="xs" numberOfLines={1}>
                    {u.anchor ? `${u.anchor.label} · ` : ''}
                    {u.trigger.label ?? ''}
                  </Mono>
                </View>
                <Mono tone="muted" size="xs" numberOfLines={1} style={styles.upWhen}>
                  {fmtRelative(u.trigger.fireAt!, now, hr ? 'hr' : 'en')}
                </Mono>
              </Pressable>
              </SwipeToDelete>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {__DEV__ ? (
          <Pressable onPress={() => router.push('/_debug/timeline')} style={{ marginTop: S.xxl, alignSelf: 'flex-start' }}>
            <Mono tone="muted" size="xs">
              ⌁ time travel (dev)
            </Mono>
          </Pressable>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: S.md, marginBottom: S.xl, flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  block: { marginBottom: S.md },
  failed: { padding: S.lg },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  todayCard: { paddingHorizontal: S.lg, paddingTop: S.lg, paddingBottom: S.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.sm },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, borderBottomWidth: StyleSheet.hairlineWidth },
  todayTime: { width: 64 },
  draftIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  upRow: { flexDirection: 'row', gap: S.md, paddingVertical: S.lg, alignItems: 'center' },
  // Narrow because it only ever holds "25." over "stu" — the relative phrase moved to upWhen, on the right.
  upDate: { width: 42, alignItems: 'flex-start' },
  upBody: { flex: 1, gap: 2 },
  upWhen: { flexShrink: 0, textAlign: 'right' },
});
