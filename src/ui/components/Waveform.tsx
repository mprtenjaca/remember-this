import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  /** 0..1 microphone level; drives bar heights while active. */
  level: number;
  active: boolean;
  bars?: number;
  height?: number;
  color?: string;
  width?: number;
}

/**
 * Live voice bars (ChatGPT-style). Each bar follows the mic level with its own phase so the cluster
 * breathes instead of moving as one block. Idle → a low resting wave.
 */
export function Waveform({ level, active, bars = 21, height = 56, color, width = 3.5 }: Props) {
  const t = useTheme();
  const phases = useMemo(() => Array.from({ length: bars }, (_, i) => 0.55 + 0.45 * Math.sin((i / (bars - 1)) * Math.PI)), [bars]);
  return (
    <View style={[styles.row, { height }]} accessibilityElementsHidden>
      {phases.map((p, i) => (
        <Bar key={i} level={level} active={active} envelope={p} index={i} height={height} color={color ?? t.c.ion} width={width} />
      ))}
    </View>
  );
}

function Bar({ level, active, envelope, index, height, color, width }: { level: number; active: boolean; envelope: number; index: number; height: number; color: string; width: number }) {
  const h = useSharedValue(4);

  useEffect(() => {
    if (!active) {
      h.value = withRepeat(
        withSequence(
          withTiming(4 + 6 * envelope, { duration: 900 + index * 23, easing: Easing.inOut(Easing.sin) }),
          withTiming(3, { duration: 900 + index * 23, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      );
      return;
    }
    // Live: jitter each bar around the level so it never looks like one rectangle
    const jitter = 0.65 + Math.random() * 0.7;
    const target = Math.max(4, Math.min(height, 4 + level * envelope * jitter * height));
    h.value = withTiming(target, { duration: 90, easing: Easing.out(Easing.quad) });
  }, [level, active, envelope, index, height, h]);

  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[styles.bar, { width, borderRadius: width / 2, backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  bar: { opacity: 0.95 },
});
