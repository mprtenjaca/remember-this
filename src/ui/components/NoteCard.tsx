import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { uiLang } from '../theme/locale';
import { R, S } from '../theme/tokens';
import { Body, Display, Mono, Label } from './Txt';
import { Glass } from './Glass';
import { fmtShort, fmtRelative, fmtDayMonth, fmtTime } from '@/domain/dates';
import type { Note, Trigger } from '@/domain/types';

interface Props {
  note: Note;
  nextTrigger?: Trigger | null;
  now: number;
}

const STATUS_HR: Record<Note['status'], string> = { pending: 'čitam…', enriched: '', failed: 'nisam uspio pročitati', needs_input: 'treba odgovor' };
const STATUS_EN: Record<Note['status'], string> = { pending: 'reading…', enriched: '', failed: 'could not read', needs_input: 'needs an answer' };

/**
 * Glass card: title in display type, your original words under it, and the next return as a small
 * blue "→ date" line. Quiet by design — amber never appears here.
 */
export function NoteCard({ note, nextTrigger, now }: Props) {
  const t = useTheme();
  const router = useRouter();
  const lang = uiLang(); // UI copy follows the DEVICE language, never the note
  const status = (lang === 'en' ? STATUS_EN : STATUS_HR)[note.status];
  const title = note.summary ?? note.rawText;
  const showBody = !!note.summary && note.summary !== note.rawText;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/note/[id]', params: { id: note.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${fmtRelative(note.createdAt, now, lang)}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Glass radius={R.xl}>
        <View style={styles.inner}>
          <View style={styles.row}>
            <Mono tone="muted">{fmtShort(note.createdAt, lang)}</Mono>
            {note.category ? <Label tone="ion">{note.category.replace(/_/g, ' ')}</Label> : null}
          </View>
          <Display size="lg" weight="semi" style={{ marginTop: S.sm }} numberOfLines={3}>
            {title}
          </Display>
          {showBody ? (
            <Body tone="fg2" size="sm" style={{ marginTop: S.xs }} numberOfLines={2}>
              {note.rawText}
            </Body>
          ) : null}
          <View style={[styles.row, { marginTop: S.md }]}>
            <View style={styles.next}>
              <Ionicons name={nextTrigger?.fireAt ? 'arrow-forward-circle' : 'sparkles-outline'} size={14} color={nextTrigger?.fireAt ? t.c.ion : t.c.muted} />
              {nextTrigger?.fireAt ? (
                <Mono tone="ion">
                  {fmtDayMonth(nextTrigger.fireAt)} {fmtTime(nextTrigger.fireAt)}
                  {nextTrigger.label ? ` · ${nextTrigger.label}` : ''}
                </Mono>
              ) : (
                <Mono tone="muted">{lang === 'hr' ? 'kad zatreba' : 'when needed'}</Mono>
              )}
            </View>
            {status ? (
              <Mono tone={note.status === 'failed' ? 'danger' : 'muted'} size="xs">
                {status}
              </Mono>
            ) : null}
          </View>
        </View>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inner: { paddingHorizontal: S.lg, paddingVertical: S.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
});
