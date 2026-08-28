import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';

interface Props {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** 'strong' for sheets/docks that sit over content; 'soft' for cards on the background. */
  variant?: 'soft' | 'strong';
  padded?: boolean;
  /** Border colour override — e.g. accent for the clarify card, signal for surfacing. */
  borderColor?: string;
  /** Adds an accent-tinted glow shadow (iOS) — use sparingly. */
  glow?: boolean;
  /** Square off the bottom corners — for a full-width drawer sitting on the screen edge. */
  flatBottom?: boolean;
}

/**
 * Liquid glass, borderless: translucent fill + a soft shadow for depth. No hard edge — the previous
 * 1px border + top "reflection" hairline read as a seam, not glass. `borderColor` (accent/amber/danger)
 * still draws a real border when a card needs to say something (question, surfacing, danger); otherwise
 * the card floats on shadow alone. Real blur on iOS (BlurView); Android gets the translucent fill only
 * (Expo Go blur on Android is costly and looks worse than none).
 */
export function Glass({ children, style, radius = R.lg, variant = 'soft', padded, borderColor, glow, flatBottom }: Props) {
  const t = useTheme();
  const fill = variant === 'strong' ? t.c.glassStrong : t.c.glass;
  const blur = Platform.OS === 'ios' && t.dark;
  // Both the outer frame and the inner clip need it, or the clip rounds off content the frame kept square.
  const corners = flatBottom ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null;
  return (
    <View
      style={[
        styles.wrap,
        {
          borderRadius: radius,
          borderWidth: borderColor ? StyleSheet.hairlineWidth : 0,
          borderColor: borderColor ?? 'transparent',
          backgroundColor: blur ? 'transparent' : Platform.OS === 'android' && variant === 'strong' ? t.c.surface : fill,
          shadowColor: '#000',
          shadowOpacity: t.dark ? 0.28 : 0.1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        glow ? { shadowColor: t.c.accent, shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } } : null,
        corners,
        style,
      ]}
    >
      <View style={[styles.clip, { borderRadius: radius }, corners]}>
        {blur ? (
          <BlurView intensity={variant === 'strong' ? 40 : 22} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
          </BlurView>
        ) : null}
        <View style={padded ? styles.padded : null}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  clip: { overflow: 'hidden' },
  padded: { paddingHorizontal: S.lg, paddingVertical: S.lg },
});
