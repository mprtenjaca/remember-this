// The orb — the one object on screen that glows. Tap it to talk. Idle it breathes slowly; while
// listening, rings roll outward and the core swells with your voice; while thinking it spins a thin arc.

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop, LinearGradient as SvgLinear } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming, cancelAnimation } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';

export type OrbState = 'idle' | 'listening' | 'thinking';

interface Props {
  size?: number;
  state: OrbState;
  /** 0..1 mic level while listening */
  level?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export function VoiceOrb({ size = 72, state, level = 0, onPress, onLongPress, accessibilityLabel, disabled }: Props) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const breathe = useSharedValue(1);
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  const spin = useSharedValue(0);
  const swell = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(breathe);
    cancelAnimation(ring1);
    cancelAnimation(ring2);
    cancelAnimation(spin);
    if (reduced) {
      breathe.value = 1;
      ring1.value = 0;
      ring2.value = 0;
      return;
    }
    if (state === 'idle') {
      breathe.value = withRepeat(withSequence(withTiming(1.04, { duration: 1800, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) })), -1, false);
      ring1.value = 0;
      ring2.value = 0;
    } else if (state === 'listening') {
      breathe.value = withTiming(1, { duration: 200 });
      ring1.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
      ring2.value = withRepeat(withSequence(withTiming(0, { duration: 700 }), withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) })), -1, false);
    } else {
      breathe.value = withTiming(0.96, { duration: 200 });
      ring1.value = 0;
      ring2.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
    }
  }, [state, reduced, breathe, ring1, ring2, spin]);

  useEffect(() => {
    swell.value = withTiming(state === 'listening' ? level : 0, { duration: 120 });
  }, [level, state, swell]);

  const coreStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value + swell.value * 0.14 }] }));
  const r1 = useAnimatedStyle(() => ({ opacity: (1 - ring1.value) * 0.55, transform: [{ scale: 1 + ring1.value * 0.9 }] }));
  const r2 = useAnimatedStyle(() => ({ opacity: (1 - ring2.value) * 0.55, transform: [{ scale: 1 + ring2.value * 0.9 }] }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }], opacity: state === 'thinking' ? 1 : 0 }));

  const box = size * 2.2;
  // White rim and icon in both themes: the orb reads as a glowing light source, not as a filled button, so it
  // keeps white regardless of the accent hue. Via a token so a palette change can still reach it.
  const rim = t.dark ? t.c.ion : t.c.onOrb;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (state === 'listening' ? 'Zaustavi snimanje' : 'Snimi glasom')}
      hitSlop={8}
      style={({ pressed }) => [styles.box, { width: box, height: box, opacity: pressed ? 0.9 : 1 }]}
    >
      {/* outer glow */}
      <Svg width={box} height={box} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={t.c.accent} stopOpacity={state === 'listening' ? 0.5 : 0.38} />
            <Stop offset="0.6" stopColor={t.c.accent} stopOpacity={0.12} />
            <Stop offset="1" stopColor={t.c.accent} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="core" cx="38%" cy="32%" r="75%">
            <Stop offset="0" stopColor={t.c.ion} stopOpacity={1} />
            <Stop offset="0.45" stopColor={t.c.accent} stopOpacity={1} />
            <Stop offset="1" stopColor={t.c.bgBottom} stopOpacity={1} />
          </RadialGradient>
          <SvgLinear id="arc" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={rim} stopOpacity={0} />
            <Stop offset="1" stopColor={rim} stopOpacity={1} />
          </SvgLinear>
        </Defs>
        <Circle cx={box / 2} cy={box / 2} r={box / 2} fill="url(#glow)" />
      </Svg>

      {/* listening rings */}
      <Animated.View pointerEvents="none" style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: t.c.ion }, r1]} />
      <Animated.View pointerEvents="none" style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: t.c.ion }, r2]} />

      {/* core */}
      <Animated.View style={[{ width: size, height: size }, coreStyle]}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#core)" />
          <Circle cx={size / 2} cy={size / 2} r={size / 2 - 0.75} stroke={rim} strokeOpacity={0.35} strokeWidth={1.5} fill="none" />
        </Svg>
        <View style={styles.icon}>
          <Ionicons name={state === 'listening' ? 'stop' : state === 'thinking' ? 'sparkles' : 'mic'} size={size * 0.36} color={t.c.onOrb} />
        </View>
      </Animated.View>

      {/* thinking arc */}
      <Animated.View pointerEvents="none" style={[styles.arc, { width: size + 14, height: size + 14 }, spinStyle]}>
        <Svg width={size + 14} height={size + 14}>
          <Circle cx={(size + 14) / 2} cy={(size + 14) / 2} r={(size + 14) / 2 - 2} stroke="url(#arc)" strokeWidth={2.5} fill="none" strokeDasharray={`${(size + 14) * 1.2} ${(size + 14) * 3}`} strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5 },
  icon: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  arc: { position: 'absolute' },
});
