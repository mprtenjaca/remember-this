import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Hairline({ style, color }: { style?: ViewStyle; color?: string }) {
  const t = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: color ?? t.c.hairline, alignSelf: 'stretch' }, style]} />;
}
