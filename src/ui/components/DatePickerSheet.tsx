// A real bottom sheet for date/datetime picking, on top of the native calendar widget. iOS's inline
// picker used to be pushed straight into a card's scroll flow — this puts it on its own glass sheet
// that rises from the bottom, with a scrim and a proper "Postavi" action, on both platforms.
// Android's native picker is still a system dialog (there's no inline mode there) — this component
// wraps it so callers use ONE api regardless of OS.

import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import { Body, Label } from './Txt';
import { Button } from './Button';
import { Glass } from './Glass';

interface Props {
  visible: boolean;
  value: Date;
  mode?: 'date' | 'datetime';
  title?: string;
  subtitle?: string | null;
  minimumDate?: Date;
  /** Label for a second confirm that takes the DAY only and lets the app pick the hour ("Bez vremena"). */
  dayOnlyLabel?: string | null;
  /** Hour/minute applied when the day-only action is used. Default 09:00. */
  dayOnlyAt?: { hour: number; minute: number };
  /** Android only: the question shown between the date and time steps, where there is no sheet to host buttons. */
  dayOnlyTitle?: string;
  /** Android only: label for the "pick a time" branch of that question. */
  timeLabel?: string;
  onCancel: () => void;
  onConfirm: (d: Date) => void;
}

/** Same day, the app's default hour — used by the "no time needed" action. */
function atDefaultHour(d: Date, at?: { hour: number; minute: number }): Date {
  const out = new Date(d);
  out.setHours(at?.hour ?? 9, at?.minute ?? 0, 0, 0);
  return out;
}

export function DatePickerSheet({ visible, value, mode = 'date', title, subtitle, minimumDate, dayOnlyLabel, dayOnlyAt, dayOnlyTitle, timeLabel, onCancel, onConfirm }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [draft, setDraft] = useState(value);
  const [mounted, setMounted] = useState(visible);
  // A plain, critically-damped rise — no spring overshoot. The previous `springify()` was underdamped
  // (damping 20 / stiffness 240 on a heavy sheet), so it visibly bounced past its resting position and
  // settled back down, reading as "it won't come all the way up".
  const translateY = useSharedValue(screenH);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

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
   * Drag the head down to dismiss, same rule as Sheet: past a quarter of the sheet, or a fast flick, it
   * closes; otherwise it springs back. Only the head carries the gesture — the calendar below it owns its
   * own swipes for changing month, and a pan on the whole panel would fight them.
   */
  const sheetH = useSharedValue(0);
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
            runOnJS(onCancel)();
          }
        });
      } else {
        translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      }
    });

  // Android has no inline calendar widget — hand off to the native dialog(s) and skip our sheet entirely.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      minimumDate,
      onChange: (e, d) => {
        if (e.type !== 'set' || !d) {
          onCancel();
          return;
        }
        if (mode === 'date') {
          onConfirm(d);
          return;
        }
        const askTime = () =>
          DateTimePickerAndroid.open({
            value: atDefaultHour(d, dayOnlyAt),
            mode: 'time',
            is24Hour: true,
            // Dismissing the TIME step keeps the chosen day at the default hour (time is optional); only dismissing
            // the DATE step cancels the whole thing.
            onChange: (e2, d2) => (e2.type === 'set' && d2 ? onConfirm(d2) : dayOnlyLabel ? onConfirm(atDefaultHour(d, dayOnlyAt)) : onCancel()),
          });
        // Android has no sheet of ours to hang a "Bez vremena" button on, so the choice has to be asked.
        // Dismissing the clock did already mean "no time", but nothing on screen said so — the user tapped a
        // day, got a clock they did not want, and backed out thinking the whole thing had been cancelled.
        if (dayOnlyLabel) {
          Alert.alert(dayOnlyTitle ?? '', undefined, [
            { text: dayOnlyLabel, onPress: () => onConfirm(atDefaultHour(d, dayOnlyAt)) },
            { text: timeLabel ?? 'Odaberi vrijeme', onPress: askTime },
          ]);
          return;
        }
        askTime();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (Platform.OS === 'android') return null;

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onCancel}>
      {mounted ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={StyleSheet.absoluteFill}>
            <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.c.scrim }]} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Zatvori" />
          </Animated.View>
          <Animated.View style={[styles.dock, sheetStyle]} onLayout={(e) => (sheetH.value = e.nativeEvent.layout.height)}>
            <Glass variant="strong" radius={R.xxl} flatBottom>
              {/* The head is the drag handle — the grabber alone is a target most people never find. */}
              <GestureDetector gesture={panDown}>
                <View>
                  <View style={styles.grabberWrap}>
                    <View style={[styles.grabber, { backgroundColor: t.c.hairline }]} />
                  </View>
                  {title ? (
                    <View style={styles.head}>
                      <Label tone="ion">{title}</Label>
                      {subtitle ? (
                        <Body tone="fg2" size="sm" style={{ marginTop: 2 }}>
                          {subtitle}
                        </Body>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </GestureDetector>
              <View style={styles.pickerWrap}>
                <DateTimePicker
                  value={draft}
                  mode={mode}
                  display="inline"
                  minuteInterval={5}
                  minimumDate={minimumDate}
                  themeVariant={t.dark ? 'dark' : 'light'}
                  accentColor={t.c.accent}
                  onChange={(_, d) => d && setDraft(d)}
                />
              </View>
              <View style={[styles.actions, { paddingBottom: insets.bottom + S.lg }]}>
                <Button title="Odustani" variant="ghost" onPress={onCancel} />
                {/* Setting a time must be optional: pick the day and let the app place the hour. */}
                {dayOnlyLabel ? <Button title={dayOnlyLabel} variant="glass" size="sm" onPress={() => onConfirm(atDefaultHour(draft, dayOnlyAt))} /> : null}
                <Button title="Postavi" variant="primary" icon="checkmark" onPress={() => onConfirm(draft)} />
              </View>
            </Glass>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Edge to edge, like Sheet — a drawer attached to the screen rather than a card floating above it.
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  grabberWrap: { alignItems: 'center', paddingTop: S.sm },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  head: { paddingHorizontal: S.lg, paddingTop: S.md },
  // The dock no longer insets the panel, so the calendar carries its own side margin.
  pickerWrap: { paddingHorizontal: S.lg, marginTop: S.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.sm },
});
