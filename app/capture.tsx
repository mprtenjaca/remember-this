// Capture sheet (native modal). One screen, two stages:
//   orb stage   — while there is no text yet (voice mode) or while recording/transcribing: the orb listens,
//                 rings + live bars, then the transcript lands in the editor
//   editor      — big display-type input; mic button in the footer appends another dictation (with context)
// The sheet closes BEFORE any LLM enrichment (hard rule #1).

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { FONT, R, S, T } from '@/ui/theme/tokens';
import { Body, Display, Label, Mono } from '@/ui/components/Txt';
import { Button } from '@/ui/components/Button';
import { Glass } from '@/ui/components/Glass';
import { Background } from '@/ui/components/Background';
import { VoiceOrb, type OrbState } from '@/ui/components/VoiceOrb';
import { Waveform } from '@/ui/components/Waveform';
import { useKeyboardHeight } from '@/ui/hooks/useKeyboardHeight';
import { capture } from '@/services/capture';
import { uiLang } from '@/ui/theme/locale';
import { draftOutcome, type DraftChoice } from '@/domain/draftPolicy';
import { relatedWhileTyping } from '@/services/search';
import { transcribeAudio, voiceAvailable } from '@/services/ai/transcribe';
import { deleteDraft, getDraft, saveDraft } from '@/services/drafts';
import type { NoteWithQuestions } from '@/db/repositories/notes';

type Voice = 'idle' | 'recording' | 'transcribing' | 'error';

export default function CaptureScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const params = useLocalSearchParams<{ voice?: string; draft?: string }>();
  const startInVoice = params.voice === '1' && voiceAvailable() && !params.draft;
  const hr = uiLang() === 'hr';

  const [text, setText] = useState('');
  const [related, setRelated] = useState<NoteWithQuestions | null>(null);
  const [typing, setTyping] = useState(!startInVoice); // user chose the keyboard (or opened via the pencil)
  const [dictations, setDictations] = useState(0);
  const saving = useRef(false);
  const inputRef = useRef<TextInput>(null);

  // ── drafts: leaving with words in the box keeps them (Today → "Nedovršeno"); saving the note clears the draft
  const draftId = useRef<string | null>(params.draft ?? null);
  const latestText = useRef('');
  const saved = useRef(false);
  latestText.current = text;
  useEffect(() => {
    if (!params.draft) return;
    void getDraft(params.draft).then((d) => {
      if (d) setText(d.text);
    });
  }, [params.draft]);
  // Decided by the dismiss dialog below; read by the unmount cleanup, which cannot ask anything itself.
  const draftChoice = useRef<DraftChoice>('ask');
  useEffect(
    () => () => {
      // unmount = sheet dismissed. The rules live in draftOutcome() (domain, tested) — notably that a
      // swipe-back, which never reaches the dialog, still keeps the words.
      const outcome = draftOutcome(saved.current, latestText.current.trim().length > 0, draftChoice.current, draftId.current != null);
      if (outcome === 'keep') void saveDraft(latestText.current, draftId.current);
      else if (outcome === 'discard' && draftId.current) void deleteDraft(draftId.current);
    },
    [],
  );

  /**
   * Closing with unsaved words asks what to do with them. Discarding is a real intention — most half-typed
   * captures are abandoned on purpose, and silently filing every one of them turned "Nedovršeno" into a bin.
   * Nothing to keep (empty box, or already saved) closes straight away.
   */
  const requestClose = () => {
    if (saved.current || !text.trim()) {
      router.back();
      return;
    }
    Alert.alert(
      hr ? 'Nedovršena bilješka' : 'Unfinished note',
      text.trim(),
      [
        { text: hr ? 'Nastavi pisati' : 'Keep writing', style: 'cancel' },
        {
          text: hr ? 'Odbaci' : 'Discard',
          style: 'destructive',
          onPress: () => {
            draftChoice.current = 'discard';
            router.back();
          },
        },
        {
          text: hr ? 'Spremi kao nedovršeno' : 'Save as unfinished',
          onPress: () => {
            draftChoice.current = 'keep';
            router.back();
          },
        },
      ],
      { cancelable: true },
    );
  };

  // ── voice
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder, 80);
  const [voice, setVoice] = useState<Voice>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const level = voice === 'recording' ? Math.max(0, Math.min(1, ((recState.metering ?? -60) + 50) / 45)) : 0; // dBFS → 0..1
  const orbState: OrbState = voice === 'recording' ? 'listening' : voice === 'transcribing' ? 'thinking' : 'idle';
  const showOrbStage = voice === 'recording' || voice === 'transcribing' || (!typing && !text.trim());

  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setVoiceError('Bez dozvole za mikrofon. Možeš diktirati i tipkovnicom (🎤 na tipkovnici).');
        setVoice('error');
        setTyping(true);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setVoiceError(null);
      setVoice('recording');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Snimanje nije uspjelo');
      setVoice('error');
    }
  };

  const stopRecording = async () => {
    try {
      const durationMs = recState.durationMillis;
      setVoice('transcribing');
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      // Whisper hallucinates a word on near-silence ("Zvuk.") — don't even send clips under ~0.8 s.
      if (durationMs < 800) {
        setVoiceError('Prekratko — drži malo dulje i reci cijelu misao.');
        setVoice('error');
        return;
      }
      const uri = recorder.uri;
      if (!uri) throw new Error('Nema snimke');
      const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
      const spoken = await transcribeAudio(base64, text);
      if (!spoken) {
        setVoiceError('Nisam razumio govor. Probaj ponovno, bliže mikrofonu.');
        setVoice('error');
        return;
      }
      // Second dictation continues the note: join with a space, avoid ". ." and double spaces.
      setText((prev) => {
        const a = prev.trim();
        if (!a) return spoken;
        const sep = /[.!?…]$/.test(a) ? ' ' : /^[,;:]/.test(spoken) ? '' : ' ';
        return `${a}${sep}${spoken}`.replace(/\s+/g, ' ');
      });
      setDictations((n) => n + 1);
      setVoice('idle');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Prijepis nije uspio');
      setVoice('error');
    }
  };

  // Opened from the orb → start listening right away
  useEffect(() => {
    if (startInVoice && !autoStarted.current) {
      autoStarted.current = true;
      const h = setTimeout(() => void startRecording(), 350);
      return () => clearTimeout(h);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInVoice]);

  useEffect(() => {
    if (text.trim().length < 8) {
      setRelated(null);
      return;
    }
    const h = setTimeout(async () => {
      const r = await relatedWhileTyping(text);
      setRelated(r[0] ?? null);
    }, 400);
    return () => clearTimeout(h);
  }, [text]);

  const save = async () => {
    const v = text.trim();
    if (!v || saving.current) return;
    saving.current = true;
    const t0 = Date.now();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    // Claim the text BEFORE awaiting. The sheet unmounts as soon as it closes, and the unmount cleanup asks
    // "was this saved?" — set after the await, that answer was still false whenever capture() outlived the
    // dismissal, so the same words were filed as a note AND kept as a draft.
    saved.current = true;
    try {
      await capture(v, dictations > 0 ? 'voice' : 'typed');
      if (draftId.current) void deleteDraft(draftId.current);
    } catch (e) {
      // The write failed, so the words are not filed anywhere — hand them back to the draft rather than
      // losing them behind an already-closed sheet.
      saved.current = false;
      void saveDraft(v, draftId.current);
      if (__DEV__) console.warn('[capture] save failed, kept as draft', e);
    } finally {
      router.back();
      if (__DEV__) console.log(`[capture] save → close ${Date.now() - t0} ms`);
    }
  };

  const fmtDur = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const statusLine = voice === 'transcribing' ? 'Prepisujem…' : words ? `${words} ${words === 1 ? 'riječ' : 'riječi'}` : '';

  // Keyboard height + a breath of air so Spremi/mic never sit on the keyboard edge.
  const bottomPad = Math.max(insets.bottom, S.md) + (keyboard > 0 ? keyboard - (Platform.OS === 'ios' ? insets.bottom : 0) + S.lg : 0);

  return (
    <View style={[styles.fill, { backgroundColor: t.c.bg }]}>
      <Background />
      <View style={[styles.wrap, { paddingTop: Platform.OS === 'ios' ? S.xl : insets.top + S.md, paddingBottom: bottomPad }]}>
        <View style={styles.head}>
          <Label tone="ion">Zapiši</Label>
          <Pressable onPress={requestClose} accessibilityRole="button" accessibilityLabel="Zatvori" hitSlop={10} style={[styles.iconBtn, { backgroundColor: t.c.glass, borderColor: t.c.glassBorder }]}>
            <Ionicons name="close" size={18} color={t.c.fg} />
          </Pressable>
        </View>

        {showOrbStage ? (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.voiceStage}>
            <VoiceOrb size={132} state={orbState} level={level} onPress={() => void (voice === 'recording' ? stopRecording() : voice === 'transcribing' ? undefined : startRecording())} />
            <View style={{ height: 64, justifyContent: 'center' }}>
              <Waveform level={level} active={voice === 'recording'} bars={25} height={48} />
            </View>
            <Display size="xl" weight="semi" align="center" style={{ marginTop: S.md }}>
              {voice === 'recording' ? 'Slušam…' : voice === 'transcribing' ? 'Prepisujem…' : text.trim() ? 'Dodaj još' : 'Reci što želiš zapamtiti'}
            </Display>
            <Mono tone="muted" align="center" style={{ marginTop: S.xs }}>
              {voice === 'recording' ? `${fmtDur(recState.durationMillis)} · tapni za kraj` : voice === 'transcribing' ? 'sekunda-dvije' : 'npr. „Ana želi Dyson fen za rođendan”'}
            </Mono>
            {voice === 'error' && voiceError ? (
              <Body tone="danger" size="sm" align="center" style={{ marginTop: S.md }}>
                {voiceError}
              </Body>
            ) : null}
            {voice === 'idle' || voice === 'error' ? (
              <Button
                title="Radije tipkam"
                variant="ghost"
                size="sm"
                icon="create-outline"
                style={{ marginTop: S.lg }}
                onPress={() => {
                  setTyping(true);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
              />
            ) : null}
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(220)} style={{ flex: 1 }}>
            <TextInput
              ref={inputRef}
              autoFocus={typing && !text.trim()}
              multiline
              value={text}
              onChangeText={setText}
              placeholder="Piši kako govoriš…"
              placeholderTextColor={t.c.muted}
              style={[styles.input, { color: t.c.fg }]}
              textAlignVertical="top"
              maxLength={2000}
              accessibilityLabel="Tekst bilješke"
            />
          </Animated.View>
        )}

        {related && !showOrbStage ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ marginBottom: S.md }}>
            <Pressable
              onPress={() => {
                router.back();
                setTimeout(() => router.push({ pathname: '/note/[id]', params: { id: related.id } }), 50);
              }}
              accessibilityRole="button"
            >
              <Glass radius={R.md}>
                <View style={styles.related}>
                  <Ionicons name="sparkles-outline" size={14} color={t.c.ion} />
                  <Mono tone="ion" size="xs">
                    već imaš nešto o ovome
                  </Mono>
                  <Body size="sm" numberOfLines={1} style={{ flex: 1 }}>
                    {related.summary ?? related.rawText}
                  </Body>
                </View>
              </Glass>
            </Pressable>
          </Animated.View>
        ) : null}

        {!showOrbStage ? (
          <View style={styles.footer}>
            <Mono tone="muted" size="xs" style={{ flex: 1 }}>
              {statusLine}
            </Mono>
            {voiceAvailable() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dodaj glasom"
                onPress={() => void startRecording()}
                style={[styles.iconBtn, { backgroundColor: t.c.glass, borderColor: t.c.glassBorder, width: 48, height: 48, borderRadius: 24 }]}
              >
                <Ionicons name="mic" size={20} color={t.c.fg} />
              </Pressable>
            ) : null}
            <Button title="Spremi" variant="primary" icon="checkmark" onPress={() => void save()} disabled={!text.trim()} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flex: 1, paddingHorizontal: S.xl },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.md },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  voiceStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: S.xl },
  input: { flex: 1, fontFamily: FONT.displayMedium, fontSize: T.xl, lineHeight: 30, letterSpacing: -0.3, paddingTop: S.sm, minHeight: 120 },
  related: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingHorizontal: S.md, paddingVertical: S.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md, paddingTop: S.sm },
});
