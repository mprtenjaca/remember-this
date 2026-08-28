import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { FONT, R, S, T } from '../theme/tokens';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  mono?: boolean; // tabular figures for time chips
  icon?: IoniconName;
  style?: ViewStyle;
}

/** Glass pill. Every clarify answer is a Chip — never a text input. Selected = solid blue like the segmented reference. */
export function Chip({ label, onPress, selected, mono, icon, style }: Props) {
  const t = useTheme();
  const fg = selected ? t.c.onAccent : t.c.fg;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      disabled={!onPress}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? t.c.accent : t.c.glass, borderColor: selected ? t.c.accent : t.c.glassBorder, opacity: pressed ? 0.75 : 1 },
        selected ? { shadowColor: t.c.accent, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } } : null,
        style,
      ]}
    >
      <View pointerEvents="none" style={[styles.shine, { backgroundColor: t.c.glassHighlight, opacity: selected ? 0.5 : 0.8 }]} />
      {icon ? <Ionicons name={icon} size={15} color={fg} /> : null}
      <Text style={{ fontFamily: FONT.bodyMedium, fontSize: T.sm, color: fg, fontVariant: mono ? ['tabular-nums'] : undefined }} maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.sm,
    overflow: 'hidden',
  },
  shine: { position: 'absolute', top: 0, left: 14, right: 14, height: 1 },
});
