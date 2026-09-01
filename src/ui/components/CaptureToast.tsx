// "Zapisano" — the one confirmation that a note was filed.
//
// Why it exists: the capture sheet closes onto whichever tab was underneath, and until now the only feedback was
// a haptic. The ReadingCard on Today cannot be relied on for this — the offline enricher finishes before the live
// query even observes `pending`, and a "kad zatreba" note leaves no trace on Today afterwards. A new user wrote
// a note and saw nothing happen (device, 2026-08-28).
//
// It is a CARD, not a slim pill: Marko's note on the first version was that it has to feel like something was
// created — so it shows the words that were just filed, and a real button to go there. The WHOLE card opens the
// note (not only the button), and a lime hairline along the bottom drains over TOAST_VISIBLE_MS so it is visible
// how long the card will stay (Marko, 2026-08-28). Hosted once, in the tabs layout, above the dock. Listens to
// captureEvents 'saved'; swipe down or tap the X dismisses it. Glass, like every other floating element — never a
// solid slab on the olive-black ground. No ding: the ding is for "riješeno", and filing is not finishing.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { Easing, FadeInDown, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureEvents } from '@/lib/events';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import { uiLang } from '../theme/locale';
import { Glass } from './Glass';
import { Body, Label } from './Txt';
import { Button } from './Button';
import { showToast, showToastIfGone, toastRemaining, type ToastKind, type ToastState } from './toastHold';

/** Height of the dock (TabBar) — the card sits just above it. Kept in step with TabBar's fab size. */
const DOCK_HEIGHT = 62;
/** Drag distance that counts as "put it away". */
const DISMISS_DRAG = 36;

export function CaptureToast() {
  const [state, setState] = useState<ToastState | null>(null);

  useEffect(
    () =>
      captureEvents.on('saved', ({ id, text, kind }) =>
        setState((prev) => (kind === 'answered' ? showToastIfGone(prev, id, Date.now(), text, 'answered') : showToast(prev, id, Date.now(), text, 'saved'))),
      ),
    [],
  );

  // Leave on our own once the window has passed — but only if no newer save has replaced us in the meantime.
  useEffect(() => {
    if (!state) return undefined;
    const shownAt = state.shownAt;
    const timer = setTimeout(() => setState((cur) => (cur && cur.shownAt === shownAt ? null : cur)), toastRemaining(state, Date.now()));
    return () => clearTimeout(timer);
  }, [state]);

  if (!state) return null;
  return <Card key={state.shownAt} id={state.id} text={state.text} kind={state.kind} remainingMs={toastRemaining(state, Date.now())} onDismiss={() => setState(null)} />;
}

function Card({ id, text, kind, remainingMs, onDismiss }: { id: string; text: string; kind: ToastKind; remainingMs: number; onDismiss: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const hr = uiLang() === 'hr';
  const translateY = useSharedValue(0);

  // The drain: full width at mount, gone exactly when the card leaves. Linear on purpose — it is a clock, not a
  // flourish, and an eased bar would lie about the time left.
  const drain = useSharedValue(1);
  useEffect(() => {
    drain.value = withTiming(0, { duration: Math.max(0, remainingMs), easing: Easing.linear });
  }, [drain, remainingMs]);
  const drainStyle = useAnimatedStyle(() => ({ width: `${drain.value * 100}%` }));

  const pan = Gesture.Pan()
    .activeOffsetY(6)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DRAG) runOnJS(onDismiss)();
      else translateY.value = withSpring(0, { damping: 18 });
    });
  const drag = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const open = () => {
    onDismiss();
    router.push({ pathname: '/note/[id]', params: { id } });
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, S.md) + DOCK_HEIGHT + S.md }]}>
      <GestureDetector gesture={pan}>
        <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(150)} style={drag} accessibilityLiveRegion="polite">
          {/* Lime hairline: this card is the app telling you it did something, and it has to read as such at a
              glance over whatever list is underneath — plain glass on glass did not. */}
          <Glass variant="strong" radius={R.xl} glow borderColor={t.c.accent}>
            {/* The whole card is the target; the X and the button sit inside and take their own presses first. */}
            <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={hr ? 'Otvori bilješku' : 'Open note'} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
              <View style={styles.inner}>
                <View style={styles.head}>
                  <Ionicons name="checkmark-circle" size={18} color={t.c.accent} />
                  <Label style={{ flex: 1, color: t.c.ion }}>
                    {kind === 'answered' ? (hr ? 'Podsjetnik postavljen' : 'Reminder set') : hr ? 'Zapisano' : 'Written'}
                  </Label>
                  <Pressable onPress={onDismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel={hr ? 'Zatvori' : 'Close'}>
                    <Ionicons name="close" size={18} color={t.c.muted} />
                  </Pressable>
                </View>
                {/* The words just filed — the enricher has not titled the note yet, and this is what was typed. */}
                <Body numberOfLines={2} style={{ marginTop: S.sm }}>
                  {text}
                </Body>
                <Button
                  title={hr ? 'Vidi bilješku' : 'View note'}
                  variant="primary"
                  size="sm"
                  icon="arrow-forward"
                  onPress={open}
                  style={{ alignSelf: 'flex-start', marginTop: S.md }}
                />
              </View>
              <View style={[styles.rail, { backgroundColor: t.c.accentSoft }]}>
                <Animated.View style={[styles.drain, { backgroundColor: t.c.accent }, drainStyle]} />
              </View>
            </Pressable>
          </Glass>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: S.lg, right: S.lg },
  inner: { padding: S.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  rail: { height: 3, width: '100%' },
  drain: { height: 3 },
});
