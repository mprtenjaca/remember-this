// A plain bottom sheet: scrim, glass panel, grabber, and the same rise/fall timing as DatePickerSheet.
//
// Extracted rather than invented — DatePickerSheet already had this mechanic and a second copy of a modal
// animation is how two sheets end up moving at different speeds. The timings are its notes verbatim: a
// critically-damped rise, no spring, because an underdamped sheet reads as "it won't come all the way up".
//
// Content is whatever the caller puts in it; this owns only the frame and the dismissal.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import { Label } from './Txt';
import { Glass } from './Glass';

interface Props {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessibility label for the scrim. */
  closeLabel?: string;
}

export function Sheet({ visible, title, onClose, children, closeLabel = 'Zatvori' }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(screenH);
  // Measured on layout: the dismiss threshold is a fraction of the SHEET, not of the screen, or a short
  // sheet would need an absurd drag and a tall one would close on a nudge.
  const sheetH = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = screenH;
      translateY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      translateY.value = withTiming(screenH, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, screenH]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  /**
   * Drag to dismiss. Downward only — pulling up would let the sheet float off its own bottom edge.
   * Past a quarter of its height, or on a fast enough flick, it closes; otherwise it springs back.
   */
  const startY = useSharedValue(0);
  const panDown = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, startY.value + e.translationY);
    })
    .onEnd((e) => {
      const height = sheetH.value || screenH;
      if (translateY.value > height * 0.25 || e.velocityY > 900) {
        translateY.value = withTiming(screenH, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) {
            runOnJS(setMounted)(false);
            runOnJS(onClose)();
          }
        });
      } else {
        translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      }
    });

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {mounted ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={StyleSheet.absoluteFill}>
            <Pressable
              style={[StyleSheet.absoluteFill, { backgroundColor: t.c.scrim }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
            />
          </Animated.View>
          <Animated.View style={[styles.dock, sheetStyle]} onLayout={(e) => (sheetH.value = e.nativeEvent.layout.height)}>
            {/* Rounded at the top only: a full-width sheet with four rounded corners leaves slivers of the
                screen showing under its bottom edge. */}
            <Glass variant="strong" radius={R.xxl} flatBottom>
              {/* The whole head is the handle, not just the 36 px grabber — a grabber-only target is a
                  gesture most people never find. */}
              <GestureDetector gesture={panDown}>
                <View>
                  <View style={styles.grabberWrap}>
                    <View style={[styles.grabber, { backgroundColor: t.c.hairline }]} />
                  </View>
                  {title ? (
                    <View style={styles.head}>
                      <Label tone="ion">{title}</Label>
                    </View>
                  ) : null}
                </View>
              </GestureDetector>
              <View style={{ paddingBottom: Math.max(insets.bottom, S.lg) }}>{children}</View>
            </Glass>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Edge to edge, sitting on the bottom — a real drawer. DatePickerSheet insets itself by S.md and reads as
  // a floating card; this one is meant to feel attached to the screen.
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  grabberWrap: { alignItems: 'center', paddingTop: S.sm },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  head: { paddingHorizontal: S.lg, paddingTop: S.md },
});
