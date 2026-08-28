// Swipe left to delete, or long-press for a menu. Wraps any row/card.
//
// Both gestures exist on purpose: swiping is the fast path people expect in a list, long-press is the
// discoverable one (and the only one that works for someone who does not know the swipe is there).
// The delete itself is confirmed by the caller — this component only reports the intent.

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import { Mono } from './Txt';
import { uiLang } from '../theme/locale';

interface Props {
  children: React.ReactNode;
  /** Fired once the row has been swiped past the threshold, or picked from the long-press menu. */
  onDelete: () => void;
  onLongPress?: () => void;
  /** Extra label under the trash icon ("Obriši"). */
  label?: string;
  enabled?: boolean;
}

const THRESHOLD = -96; // past this, releasing deletes
const MAX = -132;

export function SwipeToDelete({ children, onDelete, onLongPress, label, enabled = true }: Props) {
  const t = useTheme();
  const hr = uiLang() === 'hr';
  const x = useSharedValue(0);
  const armed = useSharedValue(0);

  const fire = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onDelete();
  }, [onDelete]);

  const tick = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Horizontal only: the lists scroll vertically, so claim the gesture only once it is clearly sideways.
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      if (e.translationX > 0) {
        x.value = 0;
        return;
      }
      x.value = Math.max(e.translationX, MAX);
      const nowArmed = x.value <= THRESHOLD ? 1 : 0;
      if (nowArmed !== armed.value) {
        armed.value = nowArmed;
        if (nowArmed) runOnJS(tick)();
      }
    })
    .onEnd(() => {
      if (x.value <= THRESHOLD) {
        x.value = withTiming(0, { duration: 160 });
        armed.value = 0;
        runOnJS(fire)();
      } else {
        x.value = withSpring(0, { damping: 20, stiffness: 220 });
        armed.value = 0;
      }
    });

  const hold = Gesture.LongPress()
    .enabled(enabled && !!onLongPress)
    .minDuration(380)
    .onStart(() => {
      runOnJS(tick)();
      if (onLongPress) runOnJS(onLongPress)();
    });

  const gesture = Gesture.Simultaneous(pan, hold);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(x.value) / Math.abs(THRESHOLD)),
  }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: armed.value ? 1.12 : 1 }] }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.back, { backgroundColor: t.c.dangerSoft }, backStyle]} pointerEvents="none">
        <Animated.View style={[styles.backInner, iconStyle]}>
          <Ionicons name="trash-outline" size={20} color={t.c.danger} />
          <Mono tone="danger" size="xs">
            {label ?? (hr ? 'Obriši' : 'Delete')}
          </Mono>
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  back: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    borderRadius: R.xl,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: S.xl,
  },
  backInner: { alignItems: 'center', gap: 2 },
});
