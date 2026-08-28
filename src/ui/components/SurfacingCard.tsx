// THE signature moment. The only animation allowed to exceed 300 ms and the only place amber lives.
//   1. glass card springs up from the bottom edge (damping 14, stiffness 120)
//   2. an amber hairline appears on the top edge and fades over 600 ms
//   3. the date rolls from the note's day to today
//   4. one light haptic tick exactly when the roll starts
// Reduced motion → crossfade, static date.

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme/ThemeProvider';
import { uiLang } from '../theme/locale';
import { FONT, R, S, SPRING, T } from '../theme/tokens';
import { Body, Display, Label } from './Txt';
import { Glass } from './Glass';
import { ReactionBar } from './ReactionBar';
import { fmtDate } from '@/domain/dates';
import type { Reaction } from '@/domain/types';
import type { SurfacedItem } from '@/services/today';

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

interface Props {
  item: SurfacedItem;
  now: number;
  index: number;
  onReact: (surfacingId: string, r: Reaction) => void;
}

export function SurfacingCard({ item, now, index, onReact }: Props) {
  const t = useTheme();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { note, why } = item;
  const lang = uiLang(); // UI copy follows the DEVICE language, never the note

  const translateY = useSharedValue(reduced ? 0 : 96);
  const opacity = useSharedValue(0);
  const hairline = useSharedValue(0);
  const roll = useSharedValue(reduced ? now : note.createdAt);

  useEffect(() => {
    const delay = index * 90;
    opacity.value = withDelay(delay, withTiming(1, { duration: reduced ? 260 : 180 }));
    if (!reduced) {
      translateY.value = withDelay(delay, withSpring(0, SPRING));
      hairline.value = withDelay(delay + 120, withSequence(withTiming(1, { duration: 120 }), withTiming(0.25, { duration: 600, easing: Easing.out(Easing.quad) })));
      roll.value = note.createdAt;
      roll.value = withDelay(delay + 160, withTiming(now, { duration: 900, easing: Easing.inOut(Easing.cubic) }));
      const h = setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined), delay + 160);
      return () => clearTimeout(h);
    }
    return undefined;
  }, [index, now, note.createdAt, reduced, opacity, translateY, hairline, roll]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
  const hairStyle = useAnimatedStyle(() => ({ opacity: hairline.value }));
  const rollProps = useAnimatedProps(() => {
    const d = new Date(roll.value);
    const p = (n: number) => (n < 10 ? '0' + n : '' + n);
    return { text: `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}` } as unknown as Partial<TextInputProps>;
  });

  const showDone = note.intent === 'gift' || note.intent === 'task';

  return (
    <Animated.View style={cardStyle}>
      <Glass radius={R.xxl} borderColor="rgba(245,178,61,0.35)" style={{ shadowColor: t.c.signal, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } }}>
        <Animated.View pointerEvents="none" style={[styles.hair, { backgroundColor: t.c.signal }, hairStyle]} />
        <View style={styles.inner}>
          <Pressable onPress={() => router.push({ pathname: '/note/[id]', params: { id: note.id } })} accessibilityRole="button" accessibilityLabel={`${why}. ${note.summary ?? note.rawText}`}>
            <View style={styles.head}>
              <View style={[styles.badge, { backgroundColor: t.c.signalSoft }]}>
                <Ionicons name="sparkles" size={13} color={t.c.signal} />
              </View>
              <Label tone="signal">{lang === 'hr' ? 'Sjetio sam se' : 'This came back'}</Label>
            </View>
            <Body tone="fg2" size="sm" style={{ marginTop: S.md }}>
              {why}
            </Body>
            <Display size="xl" weight="semi" style={{ marginTop: S.xs }}>
              {note.summary ?? note.rawText}
            </Display>
            {note.summary && note.summary !== note.rawText ? (
              <Body tone="fg2" size="sm" style={{ marginTop: S.xs }} numberOfLines={3}>
                {note.rawText}
              </Body>
            ) : null}
            <View style={styles.roll}>
              <AnimatedInput editable={false} animatedProps={rollProps} defaultValue={fmtDate(reduced ? now : note.createdAt)} style={[styles.meta, { color: t.c.muted }]} underlineColorAndroid="transparent" />
              <Ionicons name="arrow-forward" size={13} color={t.c.muted} style={{ marginHorizontal: 6 }} />
              <TextInput editable={false} value={fmtDate(now)} style={[styles.meta, { color: t.c.fg }]} underlineColorAndroid="transparent" />
            </View>
          </Pressable>
          <ReactionBar lang={lang} showDone={showDone} onReact={(r) => onReact(item.surfacing.id, r)} />
        </View>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  inner: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.lg },
  hair: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  roll: { flexDirection: 'row', alignItems: 'center', marginTop: S.md },
  meta: { fontFamily: FONT.meta, fontSize: T.sm, padding: 0, margin: 0, minWidth: 84, fontVariant: ['tabular-nums'] },
});
