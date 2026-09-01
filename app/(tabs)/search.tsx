import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Screen } from '@/ui/components/Screen';
import { Display, Mono } from '@/ui/components/Txt';
import { NoteCard } from '@/ui/components/NoteCard';
import { EmptyState } from '@/ui/components/EmptyState';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { FONT, R, S, T } from '@/ui/theme/tokens';
import { search, type SearchHit } from '@/services/search';
import { aiConfigured } from '@/services/ai/client';
import { clock } from '@/domain/clock';
import { uiLang } from '@/ui/theme/locale';

export default function SearchScreen() {
  const t = useTheme();
  const hr = uiLang() === 'hr';
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    setBusy(true);
    const h = setTimeout(async () => {
      const r = await search(q);
      if (my === seq.current) {
        setHits(r);
        setBusy(false);
      }
    }, 280);
    return () => clearTimeout(h);
  }, [q]);

  const now = clock.now();

  return (
    <>
      <Screen scroll>
        <View style={styles.header}>
          <Display size="xxl" weight="bold">
            {hr ? 'Traži' : 'Search'}
          </Display>
          <Mono tone="muted" style={{ marginTop: S.xs }}>
            {aiConfigured() ? (hr ? 'po značenju i riječima' : 'by meaning and words') : hr ? 'po riječima' : 'by words'}
          </Mono>
        </View>

        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={hr ? 'Traži kako bi pitao prijatelja…' : 'Search the way you would ask a friend…'}
          placeholderTextColor={t.c.muted}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.input, { backgroundColor: t.c.glass, borderColor: t.c.glassBorder, color: t.c.fg }]}
          accessibilityLabel={hr ? 'Pretraga bilješki' : 'Search notes'}
        />

        {hits == null ? (
          q.trim().length === 0 ? (
            <EmptyState
              title={hr ? 'Što ti je trebalo prije pola godine?' : 'What did you need six months ago?'}
              body={hr ? 'Traži po značenju: „dobar mehaničar”, „poklon za Anu”, „onaj restoran u Zadru”.' : 'Search by meaning: "a good mechanic", "a gift for Ana", "that restaurant in Zadar".'}
            />
          ) : null
        ) : hits.length === 0 ? (
          <EmptyState
            title={busy ? '…' : hr ? 'Ništa slično.' : 'Nothing like that.'}
            body={busy ? undefined : hr ? 'Možda još nije zapisano — ili probaj drugim riječima.' : 'Maybe it was never written down — or try other words.'}
          />
        ) : (
          <View style={{ marginTop: S.lg, gap: S.sm }}>
            {hits.map((h) => (
              <View key={h.note.id}>
                <View style={styles.meta}>
                  <Mono tone={h.mode === 'semantic' ? 'accent' : 'muted'} size="xs">
                    {h.mode === 'semantic' ? `≈ ${Math.round(h.score * 100)}%` : hr ? '= riječi' : '= words'}
                  </Mono>
                </View>
                <NoteCard note={h.note} now={now} />
              </View>
            ))}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: S.md, marginBottom: S.lg },
  input: {
    // A single-line input with only minHeight lets the text drift below centre: Android positions it by the
    // font's own line box plus its default padding. Fixing the height and centring explicitly puts the
    // placeholder and the typed text on the same line, on both platforms.
    height: 50,
    borderRadius: R.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: S.lg,
    paddingVertical: 0,
    textAlignVertical: 'center',
    fontFamily: FONT.body,
    fontSize: T.lg,
    lineHeight: T.lg * 1.2,
  },
  meta: { paddingHorizontal: S.xs, marginBottom: 4 },
});
