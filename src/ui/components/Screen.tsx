import React from 'react';
import { View, ScrollView, type ViewStyle, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { DOCK_HEIGHT, S } from '../theme/tokens';
import { Background } from './Background';

interface Props {
  children?: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: ViewStyle;
  /** Extra bottom space so content clears the floating dock. */
  bottomInset?: number;
  edges?: Array<'top' | 'bottom'>;
  /** Render the gradient/glow background (default). Off for screens inside a native header stack that already have one. */
  background?: boolean;
}

export function Screen({ children, scroll, padded = true, style, bottomInset = DOCK_HEIGHT, edges = ['top'], background = true }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = {
    paddingTop: edges.includes('top') ? insets.top + S.sm : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
  };
  return (
    <View style={[styles.fill, { backgroundColor: t.c.bg }]}>
      {background ? <Background /> : null}
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[pad, padded && styles.padded, { paddingBottom: (pad.paddingBottom as number) + bottomInset + S.xl }, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, pad, padded && styles.padded, style]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  padded: { paddingHorizontal: S.lg },
});
