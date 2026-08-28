// "I'm reading this note" — the only place the app explains itself.
//
// Two problems this had to solve, both reported from the device:
//
//  1. Enrichment often finishes in well under a second, so the card used to flash past before the steps could
//     be read. It now stays for a guaranteed window (see readingHold.ts) even when the work is already done,
//     and holds on the last step when the work is slower.
//  2. Nobody wants an explanation on every note. So the "what happens next" text appears only for the FIRST
//     note, has an X to dismiss it for good, and afterwards lives behind the 💡 button (ExplainerButton).

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import { Body, Label, Mono } from './Txt';
import { Glass } from './Glass';
import { Button } from './Button';
import { uiLang } from '../theme/locale';
import { readingState, MIN_VISIBLE_MS, STEP_AT_MS } from './readingHold';

interface Props {
  /** Show the "what happens next" paragraphs. False → just the three steps. */
  showExplainer?: boolean;
  /** Called when the user taps X. Only rendered when provided. */
  onDismissExplainer?: () => void;
  /** "Radije sam" — let the user set the reminder by hand instead of waiting. */
  onDoItMyself?: () => void;
  compact?: boolean;
}

const COPY = {
  hr: {
    title: 'Čitam bilješku',
    steps: ['Čitam što si napisao', 'Tražim datum, osobu i razlog', 'Postavljam podsjetnike'],
    next: 'Kad završim, podsjetnici se pojave sami — ništa ne moraš organizirati.',
    nextQuestion: 'Ako mi nešto ne bude jasno, pitat ću te jedno pitanje.',
    mine: 'Radije sam postavim',
    hide: 'Sakrij objašnjenje',
  },
  en: {
    title: 'Reading your note',
    steps: ['Reading what you wrote', 'Looking for a date, a person, a reason', 'Setting the reminders'],
    next: 'When I am done the reminders appear on their own — nothing to organise.',
    nextQuestion: 'If something is unclear I will ask you one question.',
    mine: 'I will set it myself',
    hide: 'Hide this explanation',
  },
} as const;

export function ReadingCard({ showExplainer, onDismissExplainer, onDoItMyself, compact }: Props) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const c = COPY[uiLang()];
  const [step, setStep] = useState(0);

  // Walk the steps on a timer that matches the guaranteed visible window, so all three are actually seen.
  useEffect(() => {
    if (reduced) {
      setStep(STEP_AT_MS.length - 1);
      return undefined;
    }
    const timers = STEP_AT_MS.slice(1).map((atMs, i) => setTimeout(() => setStep(i + 1), atMs));
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduced]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 0.45 + pulse.value * 0.55,
    transform: [{ scale: reduced ? 1 : 0.86 + pulse.value * 0.28 }],
  }));

  const barStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pulse.value, [0, 1], [t.c.accentSoft, t.c.accent]),
  }));

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)}>
      <Glass radius={R.xxl}>
        <View style={[styles.card, compact ? styles.cardCompact : null]}>
          <View style={styles.head}>
            <View style={[styles.badge, { backgroundColor: t.c.accentSoft }]}>
              <Animated.View style={[styles.dot, { backgroundColor: t.c.ion }, dotStyle]} />
            </View>
            <Label tone="ion" style={{ flex: 1 }}>
              {c.title}
            </Label>
            {showExplainer && onDismissExplainer ? (
              <Pressable onPress={onDismissExplainer} hitSlop={12} accessibilityRole="button" accessibilityLabel={c.hide}>
                <Ionicons name="close" size={18} color={t.c.muted} />
              </Pressable>
            ) : null}
          </View>

          {/* progress rail: one segment per step, the active one breathing */}
          <View style={styles.rail}>
            {c.steps.map((_, i) => (
              <View key={i} style={[styles.railSeg, { backgroundColor: t.c.hairline }]}>
                {i < step ? <View style={[StyleSheet.absoluteFill, { backgroundColor: t.c.accent }]} /> : null}
                {i === step ? <Animated.View style={[StyleSheet.absoluteFill, barStyle]} /> : null}
              </View>
            ))}
          </View>

          {c.steps.map((s, i) => (
            <View key={s} style={styles.stepRow}>
              <Ionicons
                name={i < step ? 'checkmark-circle' : i === step ? 'ellipse' : 'ellipse-outline'}
                size={14}
                color={i < step ? t.c.accent : i === step ? t.c.ion : t.c.muted}
              />
              <Body size="sm" tone={i <= step ? 'fg' : 'fg2'} style={{ flex: 1 }}>
                {s}
              </Body>
            </View>
          ))}

          {showExplainer ? (
            <>
              <Mono tone="muted" size="xs" style={{ marginTop: S.md }}>
                {c.next}
              </Mono>
              <Mono tone="muted" size="xs" style={{ marginTop: 2 }}>
                {c.nextQuestion}
              </Mono>
              {onDoItMyself ? (
                <Button title={c.mine} variant="ghost" size="sm" icon="hand-left-outline" style={{ alignSelf: 'flex-start', marginTop: S.md }} onPress={onDoItMyself} />
              ) : null}
            </>
          ) : null}
        </View>
      </Glass>
    </Animated.View>
  );
}

/** The same explanation, on demand — what the 💡 button opens once the card is no longer shown by default. */
export function ExplainerSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const c = COPY[uiLang()];
  const hr = uiLang() === 'hr';

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}>
      <Glass radius={R.xxl} borderColor={t.c.accent}>
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={[styles.badge, { backgroundColor: t.c.accentSoft }]}>
              <Ionicons name="bulb" size={14} color={t.c.ion} />
            </View>
            <Label tone="ion" style={{ flex: 1 }}>
              {hr ? 'Kako ovo radi' : 'How this works'}
            </Label>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={hr ? 'Zatvori' : 'Close'}>
              <Ionicons name="close" size={18} color={t.c.muted} />
            </Pressable>
          </View>
          {c.steps.map((s, i) => (
            <View key={s} style={styles.stepRow}>
              <Mono tone="accent" size="xs" style={{ width: 16 }}>
                {i + 1}
              </Mono>
              <Body size="sm" style={{ flex: 1 }}>
                {s}
              </Body>
            </View>
          ))}
          <Mono tone="muted" size="xs" style={{ marginTop: S.md }}>
            {c.next}
          </Mono>
          <Mono tone="muted" size="xs" style={{ marginTop: 2 }}>
            {c.nextQuestion}
          </Mono>
        </View>
      </Glass>
    </Animated.View>
  );
}

/** The 💡 in the Today header. Small on purpose — it is a way back to the explanation, not a feature. */
export function ExplainerButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const hr = uiLang() === 'hr';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={hr ? 'Kako ovo radi' : 'How this works'}
      style={({ pressed }) => [styles.bulb, { backgroundColor: t.c.glass, borderColor: t.c.glassBorder, opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name="bulb-outline" size={18} color={t.c.fg2} />
    </Pressable>
  );
}

export { MIN_VISIBLE_MS };

const styles = StyleSheet.create({
  card: { paddingHorizontal: S.xl, paddingVertical: S.xl },
  cardCompact: { paddingHorizontal: S.lg, paddingVertical: S.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rail: { flexDirection: 'row', gap: 4, marginBottom: S.md },
  railSeg: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3 },
  bulb: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});

void readingState;
