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

/** 👍 / "ne sad" / 👎 (+ ✓ for gifts/tasks). Feeds surfacings.reaction → adaptive threshold. */
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
      ) : null}
      <Button title={hr ? 'Korisno' : 'Useful'} size="sm" variant="soft" onPress={() => onReact('useful')} />
      <Button title={hr ? 'Ne sad' : 'Not now'} size="sm" variant="ghost" onPress={() => onReact('not_now')} />
      <Button title={hr ? 'Krivo' : 'Wrong'} size="sm" variant="ghost" onPress={() => onReact('wrong')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.lg },
});
