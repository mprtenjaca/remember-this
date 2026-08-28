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

export default function SearchScreen() {
  const t = useTheme();
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
            Traži
          </Display>
          <Mono tone="muted" style={{ marginTop: S.xs }}>
            {aiConfigured() ? 'značenje + riječi' : 'po riječima · semantika stiže s AI proxyjem'}
          </Mono>
        </View>

        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Traži kako bi pitao prijatelja…"
          placeholderTextColor={t.c.muted}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.input, { backgroundColor: t.c.glass, borderColor: t.c.glassBorder, color: t.c.fg }]}
          accessibilityLabel="Pretraga bilješki"
        />

        {hits == null ? (
          q.trim().length === 0 ? (
            <EmptyState title="Što ti je trebalo prije pola godine?" body="Traži po značenju: „dobar mehaničar”, „poklon za Anu”, „onaj restoran u Zadru”." />
          ) : null
        ) : hits.length === 0 ? (
          <EmptyState title={busy ? '…' : 'Ništa slično.'} body={busy ? undefined : 'Možda još nije zapisano. Ako jest — zapiši opet, ovaj put s više riječi.'} />
        ) : (
          <View style={{ marginTop: S.lg, gap: S.sm }}>
            {hits.map((h) => (
              <View key={h.note.id}>
                <View style={styles.meta}>
                  <Mono tone={h.mode === 'semantic' ? 'accent' : 'muted'} size="xs">
                    {h.mode === 'semantic' ? `≈ ${Math.round(h.score * 100)}%` : '= riječi'}
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
