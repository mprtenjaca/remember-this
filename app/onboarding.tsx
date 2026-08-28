// First launch: three screens, then the first note.
//
// Each screen SHOWS one thing the app does rather than describing it — the visuals are the app's own parts,
// not stock illustrations: a cursor writing a real note, the orb thinking over one and asking its one honest
// question, and a surfaced card in the amber it earns only at that moment. The last button does not land on
// an empty Today; it opens capture, so the user leaves this flow with something written down.
// (docs/04-DESIGN.md: the decisive moment is the first correct resurface, not the explanation of one.)
//
// Skippable from the first screen. Someone installing for the second time does not owe us three taps.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { uiLang } from '@/ui/theme/locale';
import { R, S } from '@/ui/theme/tokens';
import { Background } from '@/ui/components/Background';
import { Body, Display, Label, Mono } from '@/ui/components/Txt';
import { Button } from '@/ui/components/Button';
import { Chip } from '@/ui/components/Chip';
import { Glass } from '@/ui/components/Glass';
import { markOnboarded } from '@/services/onboarding';

// ─────────────────────────────────────────────────────────────────────────────
// Copy. Croatian first; the product's own voice from CLAUDE.md, not marketing.

const COPY = {
  hr: {
    skip: 'Preskoči',
    next: 'Dalje',
    start: 'Zapiši prvu',
    pages: [
      {
        title: 'Zapiši kako govoriš.',
        body: 'Jedna rečenica, bez mapa i oznaka. Ništa ne organiziraš — to nije tvoj posao.',
        typed: 'Ivan mi je preporučio servis za auto.',
      },
      {
        title: 'Ja odlučim kad ti treba.',
        body: 'Datum, osobu i razlog izvučem sam. Pitam samo ono što ne mogu znati — i pitam tapom, ne tipkanjem.',
        note: 'Marti je rođendan, želi Dyson fen.',
        question: 'Kad je rođendan?',
      },
      {
        title: 'Vraćam ti to u pravom trenutku.',
        body: 'Ne prije 8, ne poslije 21, nikad više od dvaput dnevno. Bolje propustiti nego lažno pozvati.',
        when: 'Ivan je preporučio servis',
        why: 'Tražiš mehaničara — ovo si zapisao prije 6 mjeseci.',
      },
    ],
  },
  en: {
    skip: 'Skip',
    next: 'Next',
    start: 'Write the first one',
    pages: [
      {
        title: 'Write the way you speak.',
        body: 'One sentence, no folders, no tags. You organise nothing — that is not your job.',
        typed: 'Ivan recommended a car mechanic.',
      },
      {
        title: 'I decide when you need it.',
        body: 'I work out the date, the person and the reason. I only ask what I cannot know — and I ask with a tap, not a keyboard.',
        note: "It's Marta's birthday, she wants a Dyson.",
        question: 'When is the birthday?',
      },
      {
        title: 'It comes back at the right moment.',
        body: 'Never before 8, never after 21, never more than twice a day. Better to miss than to call falsely.',
        when: 'Ivan recommended a mechanic',
        why: 'You are looking for a mechanic — you wrote this 6 months ago.',
      },
    ],
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Page 1 — a cursor writing a real note. The point is that the input is a sentence, so the sentence is the
// visual. Types at reading speed, holds, then loops; `active` gates it so an off-screen page is not typing.

const TypingNote = React.memo(function TypingNote({ text, active }: { text: string; active: boolean }) {
  const t = useTheme();
  const [shown, setShown] = useState(0);
  const blink = useSharedValue(1);

  useEffect(() => {
    if (!active) {
      setShown(0);
      return;
    }
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setShown(i);
      // A pause on the full sentence, then start again — a loop that never stops reads as a glitch.
      timer = setTimeout(tick, i >= text.length ? 2600 : i === 1 ? 500 : 38 + Math.random() * 40);
      if (i > text.length) i = 0;
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, [active, text]);

  useEffect(() => {
    blink.value = withRepeat(withSequence(withTiming(0, { duration: 420 }), withTiming(1, { duration: 420 })), -1, false);
  }, [blink]);

  const cursor = useAnimatedStyle(() => ({ opacity: blink.value }));

  return (
    <Glass radius={R.xl}>
      <View style={styles.typing}>
        <View style={styles.typingHead}>
          <Label tone="ion">{uiLang() === 'hr' ? 'Zapiši' : 'Write'}</Label>
        </View>
        {/* The cursor is a glyph INSIDE the text, not a view beside it. As a sibling in a wrapping row it
            was what wrapped: once the sentence passed the card's width the bar dropped to a new line on its
            own, detached from the words. Nested text wraps with the sentence and stays glued to the last
            letter, inheriting the display face so it sits on the baseline. */}
        <Display size="xl" weight="light">
          {text.slice(0, shown)}
          <Animated.Text style={[{ color: t.c.accent }, cursor]}>▍</Animated.Text>
        </Display>
      </View>
    </Glass>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Page 2 — the app reading a note, then asking the one thing it cannot know.
//
// No orb, no icons: the orb means "speak", and this page is about what happens AFTER you write. The card is
// the whole visual, in the same shape as page 1's, so the note reads as "the sentence you typed" rather than
// a caption. While it reads, three dots pulse — a static "čitam…" looked like a stuck screen until the
// question appeared. The question drops the name ("Kad je rođendan?"): in the welcome it only has to show
// THAT the app asks; the real label adds the person.

function ReadingDots() {
  const t = useTheme();
  const a = useSharedValue(0.25);
  const b = useSharedValue(0.25);
  const c = useSharedValue(0.25);
  useEffect(() => {
    const pulse = (v: typeof a, delay: number) => {
      v.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 320 }), withTiming(0.25, { duration: 320 })), -1, false));
    };
    pulse(a, 0);
    pulse(b, 160);
    pulse(c, 320);
  }, [a, b, c]);
  const sa = useAnimatedStyle(() => ({ opacity: a.value }));
  const sb = useAnimatedStyle(() => ({ opacity: b.value }));
  const sc = useAnimatedStyle(() => ({ opacity: c.value }));
  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.readDot, { backgroundColor: t.c.accent }, sa]} />
      <Animated.View style={[styles.readDot, { backgroundColor: t.c.accent }, sb]} />
      <Animated.View style={[styles.readDot, { backgroundColor: t.c.accent }, sc]} />
    </View>
  );
}

const AskingCard = React.memo(function AskingCard({ note, question, active }: { note: string; question: string; active: boolean }) {
  const t = useTheme();
  const hr = uiLang() === 'hr';
  const [phase, setPhase] = useState<'thinking' | 'asking'>('thinking');

  useEffect(() => {
    if (!active) {
      setPhase('thinking');
      return;
    }
    // Read long enough to be seen reading, then ask; hold the question, then read again. One chained timeout
    // rather than an interval that spawns timeouts: that version overwrote its own handle every cycle, so the
    // previous timeout was never cleared and phases piled up.
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      setPhase('asking');
      timer = setTimeout(read, 4600);
    };
    const read = () => {
      setPhase('thinking');
      timer = setTimeout(ask, 1800);
    };
    read();
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <Glass radius={R.xl} style={{ alignSelf: 'stretch' }} borderColor={phase === 'asking' ? t.c.accent : undefined}>
      <View style={styles.askCard}>
        <View style={styles.typingHead}>
          <Label tone="ion">{hr ? 'Zapisano' : 'Written'}</Label>
        </View>
        <Display size="xl" weight="light">
          {note}
        </Display>
        {phase === 'asking' ? (
          <Animated.View entering={FadeInDown.duration(260)} style={{ marginTop: S.lg }}>
            <Label tone="muted">{hr ? 'Jedno pitanje' : 'One question'}</Label>
            <Display size="lg" style={{ marginTop: S.xs }}>
              {question}
            </Display>
            <View style={styles.chips}>
              <Chip label={hr ? 'Odaberi datum' : 'Pick a date'} icon="calendar-outline" selected />
              <Chip label={hr ? 'Samo zapamti' : 'Just remember'} />
            </View>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.thinkingRow}>
            <ReadingDots />
            <Mono tone="muted" size="xs">
              {hr ? 'čitam' : 'reading'}
            </Mono>
          </Animated.View>
        )}
      </View>
    </Glass>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Page 3 — the surfacing moment. This is the ONE place amber (`signal`) is allowed, and the first time the
// user sees it should be here, so they recognise it when it is real. The card rises in the way the real one
// does; the copy is the "why now" line the app genuinely writes.

const SurfacedMoment = React.memo(function SurfacedMoment({ when, why, active }: { when: string; why: string; active: boolean }) {
  const t = useTheme();
  const rise = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      rise.value = 0;
      return;
    }
    rise.value = 0;
    rise.value = withDelay(500, withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }));
  }, [active, rise]);

  const card = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 36 }, { scale: 0.96 + rise.value * 0.04 }],
  }));

  return (
    <View style={styles.orbStage}>
      <Animated.View style={[{ alignSelf: 'stretch' }, card]}>
        <Glass radius={R.xxl} borderColor={t.c.signal} glow>
          <View style={styles.surfaced}>
            <View style={styles.surfacedHead}>
              <View style={[styles.badge, { backgroundColor: t.c.signalSoft }]}>
                <Ionicons name="sparkles" size={13} color={t.c.signal} />
              </View>
              <Label tone="signal">{uiLang() === 'hr' ? 'Spomenuo si ovo' : 'You mentioned this'}</Label>
            </View>
            <Display size="xl" weight="semi" style={{ marginTop: S.md }}>
              {when}
            </Display>
            <Body tone="fg2" size="sm" style={{ marginTop: S.xs }}>
              {why}
            </Body>
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const hr = uiLang() === 'hr';
  const c = COPY[hr ? 'hr' : 'en'];
  const preview = useLocalSearchParams<{ preview?: string }>().preview === '1';
  const [page, setPage] = useState(0);
  const list = useRef<ScrollView>(null);
  const last = page === c.pages.length - 1;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width)),
    [width],
  );

  const finish = useCallback(
    async (toCapture: boolean) => {
      // DEV preview (opened from the debug screen): just close. Do not mark anything, do not touch the stack —
      // the point is to look at the screens, not to simulate a first launch.
      if (preview) return router.back();
      await markOnboarded();
      // replace, not push: there is no going back to a welcome screen.
      router.replace('/(tabs)');
      // The first note is part of the welcome. Opened after the tabs mount so the modal has a stack under it.
      if (toCapture) setTimeout(() => router.push('/capture'), 80);
    },
    [router, preview],
  );

  const advance = () => {
    if (last) return void finish(true);
    list.current?.scrollTo({ x: width * (page + 1), animated: true });
    // The scroll position is the source of truth, but onMomentumScrollEnd does not always fire for a
    // programmatic scroll — set the page here too so the dots and the button label keep up.
    setPage(page + 1);
  };

  return (
    <View style={[styles.fill, { backgroundColor: t.c.bg }]}>
      <Background />

      <View style={[styles.top, { paddingTop: insets.top + S.md }]}>
        <Pressable onPress={() => void finish(false)} accessibilityRole="button" hitSlop={12}>
          <Mono tone="muted">{c.skip}</Mono>
        </Pressable>
      </View>

      {/* A plain ScrollView, not a FlatList. Three pages need no virtualisation, and FlatList's inline
          `renderItem` is a new function on every render — so each tick of the typewriter (25×/second) made it
          re-render all three pages, remounting the typewriter, which restarted its timer. That self-feeding
          loop was the blinking, and it redrew the SVG background every time. Fixed children render once. */}
      <ScrollView
        ref={list}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {c.pages.map((p, i) => (
          <View key={i} style={[styles.page, { width }]}>
            <View style={styles.stage}>
              {i === 0 && 'typed' in p ? <TypingNote text={p.typed} active={page === 0} /> : null}
              {i === 1 && 'question' in p ? <AskingCard note={p.note} question={p.question} active={page === 1} /> : null}
              {i === 2 && 'why' in p ? <SurfacedMoment when={p.when} why={p.why} active={page === 2} /> : null}
            </View>
            <View style={styles.words}>
              <Display size="xxl" weight="bold">
                {p.title}
              </Display>
              <Body tone="fg2" style={{ marginTop: S.md }}>
                {p.body}
              </Body>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + S.lg }]}>
        <View style={styles.dots}>
          {c.pages.map((_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i === page ? t.c.accent : t.c.hairline, width: i === page ? 22 : 6 }]} />
          ))}
        </View>
        <Button title={last ? c.start : c.next} variant="primary" icon={last ? 'create-outline' : 'arrow-forward'} onPress={advance} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { paddingHorizontal: S.xl, alignItems: 'flex-end' },
  page: { flex: 1, paddingHorizontal: S.xl },
  // The visual sits at the TOP of its half, not centred in it: centring pushed the taller page-2 card down
  // onto the words and made that page bottom-heavy. The words keep a fixed height under it so the title
  // never jumps between pages of different visual heights.
  stage: { flex: 1, justifyContent: 'flex-start', paddingTop: S.xl },
  words: { minHeight: 170, paddingBottom: S.lg },
  bottom: { paddingHorizontal: S.xl, gap: S.lg },
  dots: { flexDirection: 'row', gap: S.sm, alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },

  typing: { padding: S.xl, minHeight: 168 },
  typingHead: { marginBottom: S.md },

  // Same padding as the page-1 card, so the two read as the same object at two moments.
  askCard: { padding: S.xl, minHeight: 168 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.lg },
  dotsRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  readDot: { width: 6, height: 6, borderRadius: 3 },
  // Page 3 still centres its single card — it is short, and a card rising into the middle is the point.
  orbStage: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  surfaced: { padding: S.xl },
  surfacedHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
