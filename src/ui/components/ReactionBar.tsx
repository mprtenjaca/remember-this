import React from 'react';
import { View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Button } from './Button';
import { S } from '../theme/tokens';
import type { Reaction } from '@/domain/types';

interface Props {
  onReact: (r: Reaction) => void;
  showDone?: boolean;
  lang?: 'hr' | 'en';
}

/**
 * Two answers to a card that came back, never four (Marko, 2026-08-28): the positive one — "Riješeno" when the
 * reminder is an errand (this reminder only; the note follows when it was the last), "Korisno" when it is just
 * information — and "Ne treba mi", which tells the scorer it was wrong to bring it back. "Ne sad" went: the
 * cooldown already re-shows a note later, and a snooze next to "done" only made people wonder which to tap.
 * Feeds surfacings.reaction → adaptive threshold.
 */
export function ReactionBar({ onReact, showDone, lang = 'hr' }: Props) {
  const hr = lang === 'hr';
  return (
    <View style={styles.row}>
      {showDone ? (
        <Button
          title={hr ? '✓ Riješeno' : '✓ Done'}
          size="sm"
          variant="primary"
          onPress={() => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
            onReact('done');
          }}
          haptic={false}
        />
      ) : (
        <Button title={hr ? 'Korisno' : 'Useful'} size="sm" variant="primary" onPress={() => onReact('useful')} />
      )}
      <Button title={hr ? 'Ne treba mi' : 'Not needed'} size="sm" variant="ghost" onPress={() => onReact('wrong')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.lg },
});
