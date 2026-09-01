// A real bottom sheet for date/datetime picking, on top of the native calendar widget. iOS's inline
// picker used to be pushed straight into a card's scroll flow — this puts it on its own glass sheet
// that rises from the bottom, with a scrim and a proper "Postavi" action, on both platforms.
// Android's native picker is still a system dialog (there's no inline mode there) — this component
// wraps it so callers use ONE api regardless of OS.

import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Body, Label } from './Txt';
import { Button } from './Button';
import { Glass } from './Glass';
import { uiLang } from '../theme/locale';
import { fmtTime } from '@/domain/dates';

interface Props {
  visible: boolean;
  value: Date;
  mode?: 'date' | 'datetime';
  title?: string;
  subtitle?: string | null;
  minimumDate?: Date;
  /**
   * Hour/minute the chosen DAY gets when no time is picked (Android: the clock step dismissed). Default 09:00.
   * The time is optional, but it is never a button any more — "Bez vremena" did nothing visible (Marko, 2026-08-28).
   */
  dayOnlyAt?: { hour: number; minute: number };
  /** iOS sheet only: a destructive action for the thing being edited ("Obriši podsjetnik"). Rendered when both are set. */
  deleteLabel?: string;
  onDelete?: () => void;
  /**
   * iOS sheet, datetime mode: a status line under the picker that says whether a time counts as chosen. Greyed
   * "unset" while the clock still sits where the sheet opened; accent "set" once it moved (Marko, 2026-08-28:
   * the default hour must LOOK like nothing was set).
   */
  timeStatus?: { unset: string; set: (d: Date) => string };
  onCancel: () => void;
  /**
   * `timeSet` — whether the user actually chose a time (moved the clock on iOS; confirmed the time step on
   * Android). Callers that treat the time as optional read it; the date alone is always in `d`.
   */
  onConfirm: (d: Date, meta: { timeSet: boolean }) => void;
}

/** Same day, the app's default hour — used by the "no time needed" action. */
function atDefaultHour(d: Date, at?: { hour: number; minute: number }): Date {
  const out = new Date(d);
  out.setHours(at?.hour ?? 9, at?.minute ?? 0, 0, 0);
  return out;
}

export function DatePickerSheet({ visible, value, mode = 'date', title, subtitle, minimumDate, dayOnlyAt, deleteLabel, onDelete, timeStatus, onCancel, onConfirm }: Props) {
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
  // A time counts as chosen only when the user set it in the time row — not because the draft carries some hour.
  const [timeSet, setTimeSet] = useState(false);
  const [showTime, setShowTime] = useState(false);
  useEffect(() => {
    if (visible) {
      setTimeSet(false);
      setShowTime(false);
    }
  }, [visible]);
  const hr = uiLang() === 'hr';
  // The native widgets take a locale of their own; without it the calendar speaks the OS language, not the app's.
  const locale = hr ? 'hr-HR' : 'en-GB';

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
          onConfirm(d, { timeSet: false });
          return;
        }
        // Date, then time. Dismissing the TIME step keeps the chosen day at the default hour (the time is optional);
        // only dismissing the DATE step cancels the whole thing.
        DateTimePickerAndroid.open({
          value: atDefaultHour(d, dayOnlyAt),
          mode: 'time',
          is24Hour: true,
          onChange: (e2, d2) => (e2.type === 'set' && d2 ? onConfirm(d2, { timeSet: true }) : onConfirm(atDefaultHour(d, dayOnlyAt), { timeSet: false })),
        });
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
                {/* Always the DATE calendar, even in datetime mode: the time lives in our own row below, where it
                    can be greyed while unset and spelled in the device language — the native combined picker
                    showed "Time" in English and a 19:00 that looked chosen when it was only the default. */}
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display="inline"
                  locale={locale}
                  minimumDate={minimumDate}
                  themeVariant={t.dark ? 'dark' : 'light'}
                  accentColor={t.c.accent}
                  onChange={(_, d) => {
                    if (!d) return;
                    const next = new Date(draft);
                    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                    setDraft(next);
                  }}
                />
              </View>
              {mode === 'datetime' ? (
                <View style={styles.timeBlock}>
                  <Pressable
                    onPress={() => setShowTime((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={hr ? 'Vrijeme' : 'Time'}
                    style={({ pressed }) => [styles.timeRow, { borderColor: t.c.hairline, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Label>{hr ? 'Vrijeme' : 'Time'}</Label>
                    {/* The number is GREY until the user sets it — a default hour must not look like a choice. */}
                    <Body tone={timeSet ? 'ion' : 'muted'} style={{ fontVariant: ['tabular-nums'] }}>
                      {fmtTime(draft.getTime())}
                    </Body>
                    {timeSet ? (
                      <Pressable
                        onPress={() => {
                          const back = new Date(draft);
                          back.setHours(value.getHours(), value.getMinutes(), 0, 0);
                          setDraft(back);
                          setTimeSet(false);
                        }}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={hr ? 'Makni vrijeme' : 'Clear time'}
                      >
                        <Ionicons name="close-circle" size={18} color={t.c.muted} />
                      </Pressable>
                    ) : (
                      <Ionicons name={showTime ? 'chevron-up' : 'chevron-down'} size={16} color={t.c.muted} />
                    )}
                  </Pressable>
                  {showTime ? (
                    <DateTimePicker
                      value={draft}
                      mode="time"
                      display="spinner"
                      locale={locale}
                      minuteInterval={5}
                      themeVariant={t.dark ? 'dark' : 'light'}
                      accentColor={t.c.accent}
                      onChange={(_, d) => {
                        if (!d) return;
                        const next = new Date(draft);
                        next.setHours(d.getHours(), d.getMinutes(), 0, 0);
                        setDraft(next);
                        setTimeSet(true);
                      }}
                    />
                  ) : null}
                  {timeStatus ? (
                    <Body size="sm" tone={timeSet ? 'ion' : 'muted'} style={{ marginTop: S.xs }}>
                      {timeSet ? timeStatus.set(draft) : timeStatus.unset}
                    </Body>
                  ) : null}
                </View>
              ) : null}
              <View style={[styles.actions, { paddingBottom: insets.bottom + S.lg }]}>
                <Button title="Odustani" variant="ghost" onPress={onCancel} />
                {/* The one destructive action lives here too: editing a reminder's time is where you notice you
                    do not want it at all. */}
                {deleteLabel && onDelete ? <Button title={deleteLabel} variant="danger" size="sm" icon="trash-outline" onPress={onDelete} /> : null}
                {/* iOS's inline picker always carries SOME time; it counts as chosen only if the clock was moved
                    off the value the sheet opened with. */}
                <Button title="Postavi" variant="primary" icon="checkmark" onPress={() => onConfirm(draft, { timeSet })} />
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
  timeBlock: { paddingHorizontal: S.lg, paddingTop: S.sm },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.sm },
});
