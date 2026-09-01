// Clarify card — lives in the Today list, never a modal. Max 2 questions, always tap options.
// Only exception: the native date picker for an anchor (one tap, no typing). Always an exit: "Bez podsjetnika" on the date question, "Preskoči pitanje" on the rest.

import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { uiLang } from '../theme/locale';
import { FONT, R, S, T } from '../theme/tokens';
import { Body, Display, Label, Mono } from './Txt';
import { Chip } from './Chip';
import { Button } from './Button';
import { Glass } from './Glass';
import { DatePickerSheet } from './DatePickerSheet';
import type { NoteWithQuestions } from '@/db/repositories/notes';
import type { AnchorKind } from '@/domain/types';
import { DEFAULT_ANCHOR_TIME, formatMonthDay } from '@/domain/triggers/resolve';
import { fmtMonthDay, fmtTime } from '@/domain/dates';
import { anchorQuestion } from '@/domain/enrich/ingest';
import { answerAnchor, answerOption, answerInterval, answerFallbackDate, dismissQuestions } from '@/services/anchors';
import { captureEvents } from '@/lib/events';
import { hasContactsPermission, lookupBirthday, requestContactsPermission, type ContactBirthday } from '@/services/contacts/birthday';
import { db } from '@/db';
import { triggersRepo } from '@/db/repositories/triggers';

interface Props {
  note: NoteWithQuestions;
}

/**
 * "Iz kontakata" is parked (Marko, 2026-08-28): a permission prompt inside the first question was one step too
 * many for a first-time user, and the picker is one tap anyway. The lookup code stays (services/contacts) so the
 * offer can come back in one place — e.g. as a settings-level opt-in rather than on the card.
 */
const OFFER_CONTACTS = false;

export function ClarifyCard({ note }: Props) {
  const t = useTheme();
  const lang = uiLang(); // UI copy follows the DEVICE language, never the note
  const hr = lang === 'hr';
  const q = note.questions[0];
  // Whose date: the question carries it (ingest); pending anchor triggers are the fallback.
  const [pending, setPending] = useState<{ person: string; kind: AnchorKind } | null>(
    q?.kind === 'date' && q.person ? { person: q.person, kind: q.anchorKind ?? 'birthday' } : null,
  );
  const [showPicker, setShowPicker] = useState(false);
  const [contacts, setContacts] = useState<ContactBirthday[] | null>(null);
  const [done, setDone] = useState(false); // optimistic: hide the card the moment an answer is committed
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (pending) return;
    let alive = true;
    (async () => {
      const rows = await triggersRepo.pendingAnchor(db(), note.id);
      const p = rows[0]?.payload as { person?: string; kind?: AnchorKind } | undefined;
      if (alive && p?.person) setPending({ person: p.person, kind: p.kind ?? 'birthday' });
    })();
    return () => {
      alive = false;
    };
  }, [note.id, pending]);

  useEffect(() => {
    if (!pending || !OFFER_CONTACTS) return;
    let alive = true;
    (async () => {
      if (!(await hasContactsPermission())) return;
      const found = await lookupBirthday(pending.person);
      if (alive) setContacts(found);
    })();
    return () => {
      alive = false;
    };
  }, [pending]);

  if (!q || done) return null;

  /**
   * Every answer path: hide immediately, then persist. If persisting fails the live query brings the card back.
   * `announce` — a real answer (date, option, interval) shows the "Podsjetnik postavljen" card, the same one as
   * after a save, but only if the save's own card is already gone (CaptureToast decides). Skipping announces nothing.
   */
  const finish = async (work: Promise<unknown>, announce = false) => {
    setDone(true);
    try {
      await work;
      if (announce) captureEvents.emit('saved', { id: note.id, text: note.summary ?? note.rawText, kind: 'answered' });
    } catch {
      setDone(false);
    }
  };

  /** @param timeSet the user moved the clock too — then the reminders take that hour; otherwise the default stays. */
  const commitDate = async (d: Date, timeSet = false) => {
    // An interval question has no anchor behind it — the picked day replaces the guessed one directly.
    if (q?.kind === 'interval') {
      await finish(answerFallbackDate(note.id, q.id, d.getTime()), true);
      return;
    }
    if (!pending) {
      // Nobody to attach the date to — keep the note, drop the question.
      await finish(dismissQuestions(note.id));
      return;
    }
    await finish(
      answerAnchor({
        noteId: note.id,
        person: pending.person,
        kind: pending.kind,
        monthDay: formatMonthDay(d.getMonth() + 1, d.getDate()),
        year: pending.kind === 'oneoff' ? d.getFullYear() : null,
        source: 'user',
        at: timeSet ? { hour: d.getHours(), minute: d.getMinutes() } : null,
      }),
      true,
    );
  };

  const openPicker = () => setShowPicker(true);
  // Today at the default hour — the baseline the picker's "did they move the clock?" check compares against.
  const [pickerStart] = useState(() => {
    const d = new Date();
    d.setHours(DEFAULT_ANCHOR_TIME.hour, DEFAULT_ANCHOR_TIME.minute, 0, 0);
    return d;
  });

  /** The user typed their own answer instead of picking one of ours. */
  const submitCustom = () => {
    const v = custom.trim();
    if (!v || !q) return;
    setTyping(false);
    void finish(answerOption(note.id, q.id, v), true);
  };

  const fromContacts = async () => {
    if (!pending) return;
    if (!(await hasContactsPermission())) {
      const ok = await requestContactsPermission();
      if (!ok) return;
    }
    const found = await lookupBirthday(pending.person);
    setContacts(found);
    if (found.length === 1) {
      const c = found[0]!;
      await finish(answerAnchor({ noteId: note.id, person: pending.person, kind: pending.kind, monthDay: c.monthDay, year: null, source: 'contacts', contactId: c.contactId }), true);
    }
  };

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <Glass radius={R.xxl} borderColor={t.c.accent} glow>
        <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: t.c.accentSoft }]}>
          <Ionicons name="help" size={14} color={t.c.ion} />
        </View>
        <Label tone="ion">{hr ? 'Jedno pitanje' : 'One question'}</Label>
      </View>
      <Body tone="fg2" size="sm" style={{ marginTop: S.sm }} numberOfLines={2}>
        {note.summary ?? note.rawText}
      </Body>
      <Display size="lg" style={{ marginTop: S.xs }}>
        {q.text}
      </Display>

      {q.kind === 'date' ? (
        <View style={{ marginTop: S.md }}>
          {OFFER_CONTACTS && contacts && contacts.length > 1 ? (
            <View style={styles.options}>
              {contacts.slice(0, 4).map((c, i) => (
                <Animated.View key={c.contactId} entering={FadeInDown.delay(i * 60).springify()}>
                  <Chip
                    label={`${c.name} · ${fmtMonthDay(c.monthDay)}`}
                    onPress={() =>
                      pending &&
                      void finish(answerAnchor({ noteId: note.id, person: pending.person, kind: pending.kind, monthDay: c.monthDay, year: null, source: 'contacts', contactId: c.contactId }), true)
                    }
                  />
                </Animated.View>
              ))}
            </View>
          ) : null}
          {/* "Odaberi datum" is the one answer that opens a picker instead of committing a value, so it reads
              differently from the tap-options around it: full-width, calendar icon, its own row. */}
          <View style={styles.dateRow}>
            <Animated.View entering={FadeInDown.delay(0).springify()} style={{ alignSelf: 'stretch' }}>
              <Button title={hr ? 'Odaberi datum' : 'Pick a date'} variant="primary" icon="calendar-outline" onPress={openPicker} style={styles.dateBtn} />
            </Animated.View>
          </View>
          <View style={styles.options}>
            {OFFER_CONTACTS && (contacts == null || contacts.length === 0) ? (
              <Animated.View entering={FadeInDown.delay(60).springify()}>
                <Button title={hr ? 'Iz kontakata' : 'From contacts'} variant="soft" onPress={() => void fromContacts()} />
              </Animated.View>
            ) : null}
            <Animated.View entering={FadeInDown.delay(120).springify()}>
              {/* Says the consequence: without a date there is no birthday reminder. "Samo zapamti" did not tell
                  a first-time user what they were giving up (Marko, 2026-08-28). */}
              <Button title={hr ? 'Bez podsjetnika' : 'No reminder'} variant="ghost" onPress={() => void finish(dismissQuestions(note.id))} />
            </Animated.View>
          </View>
          {OFFER_CONTACTS && contacts && contacts.length === 0 ? (
            <Mono tone="muted" size="xs" style={{ marginTop: S.sm }}>
              {hr ? 'nema rođendana u kontaktima' : 'no birthday in contacts'}
            </Mono>
          ) : null}
        </View>
      ) : (
        <View style={[styles.options, { marginTop: S.md }]}>
          {/* An interval answer MOVES the reminder (answerInterval); an ordinary option is only kept as a
              keyword. Sending an interval down the option path would clear the question and change nothing. */}
          {(q.options ?? []).slice(0, 4).map((o, i) => (
            <Animated.View key={o} entering={FadeInDown.delay(i * 60).springify()}>
              <Chip
                label={o}
                onPress={() =>
                  void finish(
                    q.kind === 'interval'
                      ? answerInterval(note.id, q.id, q.optionMonths?.[i] ?? 6)
                      : answerOption(note.id, q.id, o),
                    true,
                  )
                }
              />
            </Animated.View>
          ))}
          {/* An interval is a date, so the escape is the picker, not the keyboard: typing "za 8 mjeseci"
              would be kept as a keyword and move nothing. */}
          {q.kind === 'interval' ? (
            <Animated.View entering={FadeInDown.delay(((q.options?.length ?? 0) + 1) * 60).springify()}>
              <Chip label={hr ? 'Odaberi datum' : 'Pick a date'} icon="calendar-outline" onPress={openPicker} />
            </Animated.View>
          ) : /* Tapping stays the default; typing is the way out when the offered options all miss ("Obitelj"
              when the answer is "Ćaću"). Without it the only escape was "Samo zapamti", which throws the
              answer away entirely. */
          typing ? (
            <Animated.View entering={FadeInDown.duration(160)} style={styles.typeRow}>
              <TextInput
                autoFocus
                value={custom}
                onChangeText={setCustom}
                onSubmitEditing={submitCustom}
                returnKeyType="done"
                placeholder={hr ? 'Upiši odgovor…' : 'Type your answer…'}
                placeholderTextColor={t.c.muted}
                style={[styles.input, { color: t.c.fg, borderColor: t.c.accent, backgroundColor: t.c.glass }]}
                maxLength={60}
                accessibilityLabel={hr ? 'Upiši svoj odgovor' : 'Type your answer'}
              />
              <Button title={hr ? 'Spremi' : 'Save'} variant="primary" size="sm" onPress={submitCustom} disabled={!custom.trim()} />
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInDown.delay(((q.options?.length ?? 0) + 1) * 60).springify()}>
              <Chip label={hr ? 'Nešto drugo…' : 'Something else…'} icon="create-outline" onPress={() => setTyping(true)} />
            </Animated.View>
          )}
          <Animated.View entering={FadeInDown.delay(((q.options?.length ?? 0) + 1) * 60).springify()}>
            {/* An options question changes no reminder, so skipping it loses nothing — say exactly that. */}
            <Button title={hr ? 'Preskoči pitanje' : 'Skip the question'} variant="ghost" size="sm" onPress={() => void finish(dismissQuestions(note.id))} />
          </Animated.View>
        </View>
      )}
        </View>
      </Glass>
      {/* Mounted unconditionally: gating this on `pending` meant that when the model asked for a date it could not
          bind to anyone, the sheet was not in the tree at all — "Odaberi datum" then did nothing visible and the
          card closed without saving. ingest() now drops unbindable date questions, and this is the second line of
          defence: the picker always opens, and commitDate decides what the answer attaches to. */}
      <DatePickerSheet
        visible={showPicker}
        // Opens at the default hour, so a time counts as chosen only when the clock is actually moved.
        value={pickerStart}
        // The date question takes an optional time (Marko, 2026-08-28): "rođendan u 8" wants its reminders around
        // eight, not at the default hour. Left alone, nothing is set and the default stays.
        mode={q.kind === 'date' && pending ? 'datetime' : 'date'}
        title={pending ? anchorQuestion(pending.person, pending.kind, lang) : q.text}
        subtitle={q.kind === 'date' && pending ? (hr ? 'Vrijeme je neobavezno — dan je dovoljan.' : 'The time is optional — a day is enough.') : null}
        dayOnlyAt={DEFAULT_ANCHOR_TIME}
        timeStatus={{
          unset: hr ? 'Vrijeme nije postavljeno — podsjetnik na dan u zadano vrijeme' : 'No time set — the day-of reminder at the default hour',
          set: (d) => (hr ? `Podsjetnik na dan u ${fmtTime(d.getTime())}` : `Day-of reminder at ${fmtTime(d.getTime())}`),
        }}
        // A reminder in the past never fires; an interval question is always about the future.
        minimumDate={q.kind === 'interval' ? new Date() : undefined}
        onCancel={() => setShowPicker(false)}
        onConfirm={(d, meta) => {
          setShowPicker(false);
          void commitDate(d, meta.timeSet);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: S.xl, paddingVertical: S.xl },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, flexGrow: 1, minWidth: '100%' },
  input: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: S.md,
    borderRadius: R.pill,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: FONT.body,
    fontSize: T.sm,
  },
  dateRow: { marginTop: S.sm },
  dateBtn: { alignSelf: 'stretch', minHeight: 54 },
});
