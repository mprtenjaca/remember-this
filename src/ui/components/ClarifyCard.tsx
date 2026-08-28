// Clarify card — lives in the Today list, never a modal. Max 2 questions, always tap options.
// Only exception: the native date picker for an anchor (one tap, no typing). Always an exit: "Samo zapamti".

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
import { formatMonthDay } from '@/domain/triggers/resolve';
import { fmtMonthDay } from '@/domain/dates';
import { anchorQuestion } from '@/domain/enrich/ingest';
import { answerAnchor, answerOption, answerInterval, answerFallbackDate, dismissQuestions } from '@/services/anchors';
import { hasContactsPermission, lookupBirthday, requestContactsPermission, type ContactBirthday } from '@/services/contacts/birthday';
import { db } from '@/db';
import { triggersRepo } from '@/db/repositories/triggers';

interface Props {
  note: NoteWithQuestions;
}

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
    if (!pending) return;
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

  /** Every answer path: hide immediately, then persist. If persisting fails the live query brings the card back. */
  const finish = async (work: Promise<unknown>) => {
    setDone(true);
    try {
      await work;
    } catch {
      setDone(false);
    }
  };

  const commitDate = async (d: Date) => {
    // An interval question has no anchor behind it — the picked day replaces the guessed one directly.
    if (q?.kind === 'interval') {
      await finish(answerFallbackDate(note.id, q.id, d.getTime()));
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
      }),
    );
  };

  const openPicker = () => setShowPicker(true);

  /** The user typed their own answer instead of picking one of ours. */
  const submitCustom = () => {
    const v = custom.trim();
    if (!v || !q) return;
    setTyping(false);
    void finish(answerOption(note.id, q.id, v));
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
      await finish(answerAnchor({ noteId: note.id, person: pending.person, kind: pending.kind, monthDay: c.monthDay, year: null, source: 'contacts', contactId: c.contactId }));
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
          {contacts && contacts.length > 1 ? (
            <View style={styles.options}>
              {contacts.slice(0, 4).map((c, i) => (
                <Animated.View key={c.contactId} entering={FadeInDown.delay(i * 60).springify()}>
                  <Chip
                    label={`${c.name} · ${fmtMonthDay(c.monthDay)}`}
                    onPress={() =>
                      pending &&
                      void finish(answerAnchor({ noteId: note.id, person: pending.person, kind: pending.kind, monthDay: c.monthDay, year: null, source: 'contacts', contactId: c.contactId }))
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
            {contacts == null || contacts.length === 0 ? (
              <Animated.View entering={FadeInDown.delay(60).springify()}>
                <Button title={hr ? 'Iz kontakata' : 'From contacts'} variant="soft" onPress={() => void fromContacts()} />
              </Animated.View>
            ) : null}
            <Animated.View entering={FadeInDown.delay(120).springify()}>
              <Button title={hr ? 'Samo zapamti' : 'Just remember'} variant="ghost" onPress={() => void finish(dismissQuestions(note.id))} />
            </Animated.View>
          </View>
          {contacts && contacts.length === 0 ? (
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
            <Button title={hr ? 'Samo zapamti' : 'Just remember'} variant="ghost" size="sm" onPress={() => void finish(dismissQuestions(note.id))} />
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
        value={new Date()}
        mode="date"
        title={pending ? anchorQuestion(pending.person, pending.kind, lang) : q.text}
        // A reminder in the past never fires; an interval question is always about the future.
        minimumDate={q.kind === 'interval' ? new Date() : undefined}
        onCancel={() => setShowPicker(false)}
        onConfirm={(d) => {
          setShowPicker(false);
          void commitDate(d);
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
