import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { S } from '../theme/tokens';
import { Body, Mono } from './Txt';
import { fmtDateTime, fmtRelative } from '@/domain/dates';
import type { Trigger, TriggerType } from '@/domain/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const ICON: Record<TriggerType, IoniconName> = {
  time: 'time-outline',
  anchor: 'gift-outline',
  semantic: 'sparkles-outline',
  location: 'location-outline',
  person: 'person-outline',
};

interface Props {
  trigger: Trigger;
  now: number;
  anchorLabel?: string | null;
  onPress?: () => void;
  /** The rest of the actions (done, ±7 days, delete) — the tap itself goes straight to the calendar. */
  onLongPress?: () => void;
  /** Tick the reminder off. Omitted where a checkbox makes no sense (Today rows, semantic triggers). */
  onToggleDone?: () => void;
  lang?: 'hr' | 'en';
}

/** One reminder line in the note detail. Icon in a tinted circle, label, date. The word "trigger" never appears in UI. */
export function TriggerRow({ trigger: tr, now, anchorLabel, onPress, onLongPress, onToggleDone, lang = 'hr' }: Props) {
  const t = useTheme();
  const hr = lang === 'hr';
  const done = tr.state !== 'active';
  const kw = tr.type === 'semantic' ? (tr.payload as { keywords: string[] }).keywords : null;
  const pendingAnchor = tr.type === 'anchor' && !tr.anchorId;

  const title =
    tr.type === 'semantic'
      ? hr
        ? 'Kad tražiš'
        : 'When you search'
      : tr.type === 'anchor'
        ? `${anchorLabel ?? (tr.payload as { person?: string }).person ?? ''}${tr.label ? ` · ${tr.label}` : ''}`
        : tr.label ?? (hr ? 'Podsjetnik' : 'Reminder');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => [styles.row, { opacity: done ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      {/* The tick is the whole point: a note can hold several errands, and finishing one of them should take
          one tap on that line — not a trip through a menu. Semantic triggers get no tick; they are what makes
          the note findable later, not something you finish. */}
      {onToggleDone && tr.type !== 'semantic' ? (
        <Pressable
          onPress={onToggleDone}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? (hr ? 'Vrati podsjetnik' : 'Reopen reminder') : hr ? 'Označi riješenim' : 'Mark done'}
          style={[styles.check, { borderColor: done ? t.c.accent : t.c.hairline, backgroundColor: done ? t.c.accent : 'transparent' }]}
        >
          {done ? <Ionicons name="checkmark" size={14} color={t.c.onAccent} /> : null}
        </Pressable>
      ) : (
        <View style={[styles.iconWrap, { backgroundColor: pendingAnchor ? t.c.glass : t.c.accentSoft }]}>
          <Ionicons name={ICON[tr.type]} size={17} color={pendingAnchor ? t.c.muted : t.c.ion} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Body numberOfLines={2}>{title}</Body>
        {kw ? (
          <Mono tone="muted" size="xs" numberOfLines={2} style={{ marginTop: 2 }}>
            {kw.join(' · ')}
          </Mono>
        ) : tr.fireAt ? (
          <Mono tone="muted" size="xs" style={{ marginTop: 2 }}>
            {fmtDateTime(tr.fireAt)} · {fmtRelative(tr.fireAt, now, lang)}
          </Mono>
        ) : pendingAnchor ? (
          <Mono tone="muted" size="xs" style={{ marginTop: 2 }}>
            {hr ? 'čeka datum' : 'waiting for a date'}
          </Mono>
        ) : null}
      </View>
      <View style={styles.right}>
        {/* Low certainty = the app worked the date out rather than reading it in the note. Sparkles say that
            in the app's own visual language, where words ("tiho", "nisam siguran") only described a feeling.
            Gone the moment the user edits the date: once it is THEIRS, whose guess it started as is history,
            and a doubt badge on a date you chose yourself reads as the app doubting you.
            The pencil went for the same reason — "you edited this" is not news to the person who edited it. */}
        {tr.certainty < 0.5 && !done && !tr.userEdited ? (
          <Ionicons name="sparkles" size={13} color={t.c.muted} accessibilityLabel={hr ? 'Datum je odredila aplikacija' : 'Date worked out by the app'} />
        ) : null}
        {onPress ? <Ionicons name="chevron-forward" size={16} color={t.c.muted} /> : null}
      </View>
      <View style={[styles.hair, { backgroundColor: t.c.hairline }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, position: 'relative' },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  right: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  hair: { position: 'absolute', left: 46, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
