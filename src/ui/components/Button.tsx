import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { R, S, FONT, T } from '../theme/tokens';

type Variant = 'primary' | 'glass' | 'soft' | 'ghost' | 'danger' | 'signal'; // 'soft' is an alias of 'glass'
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: IoniconName;
  disabled?: boolean;
  haptic?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/** Primary = blue gradient pill with a soft glow. Glass = translucent pill. Ghost = text only. */
export function Button({ title, onPress, variant: variantProp = 'glass', size = 'md', icon, disabled, haptic = true, style, accessibilityLabel }: Props) {
  const t = useTheme();
  const variant: Exclude<Variant, 'soft'> = variantProp === 'soft' ? 'glass' : variantProp;
  const fg = variant === 'primary' ? t.c.onAccent : variant === 'danger' ? t.c.danger : variant === 'ghost' ? t.c.ion : t.c.fg;
  const bg = variant === 'glass' ? t.c.glass : variant === 'signal' ? t.c.signalSoft : 'transparent';
  const border = variant === 'glass' ? t.c.glassBorder : variant === 'signal' ? t.c.signalBorder : 'transparent';
  const h = size === 'sm' ? 38 : 48;
  // An icon adds its own visual weight on the left, so the pill's leading padding tightens to keep the
  // icon+label pair optically centred instead of sitting right of centre.
  const padX = size === 'sm' ? (icon ? S.sm + 2 : S.md) : icon ? S.lg : S.xl;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      android_ripple={{ color: t.c.hairline, borderless: false }}
      style={({ pressed }) => [
        styles.base,
        { minHeight: h, paddingHorizontal: padX, backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed && Platform.OS === 'ios' ? 0.75 : 1 },
        variant === 'primary' && !disabled
          ? { shadowColor: t.c.accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 }
          : null,
        style,
      ]}
    >
      {/* Gradient stops derive from the theme's own tokens (ion → accent), never hardcoded hex — a literal
          blue here is exactly how a themed button ends up two-toned after a palette change. */}
      {variant === 'primary' ? (
        <LinearGradient colors={[t.c.ion, t.c.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : null}
      {variant === 'primary' ? <View pointerEvents="none" style={[styles.shine, { backgroundColor: t.c.glassHighlight }]} /> : null}
      {/* Icon↔label gap is tighter on `sm` and the horizontal padding shrinks when an icon is present.
          Ionicons glyphs carry their own side bearing, so a uniform 8 px gap reads as a detached icon on
          the small pill (the checkmark on "Spremi" floated well left of its word). */}
      <View style={[styles.inner, { gap: size === 'sm' ? S.xs : S.sm }]}>
        {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={fg} /> : null}
        <Text style={{ fontFamily: FONT.bodySemibold, fontSize: size === 'sm' ? T.sm : T.md, color: fg }} maxFontSizeMultiplier={1.6}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: R.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  inner: { flexDirection: 'row', alignItems: 'center' },
  shine: { position: 'absolute', top: 0, left: 12, right: 12, height: 1 },
});
