import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The night field: vertical gradient plus two soft radial glows near the top — a light source
 * above the content, like the reference. Absolute-filled; render once per screen behind content.
 */
export function Background() {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[t.c.bgTop, t.c.bg, t.c.bgBottom]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ga" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={t.c.glowA} stopOpacity={t.dark ? 0.55 : 0.5} />
            <Stop offset="1" stopColor={t.c.glowA} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="gb" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={t.c.glowB} stopOpacity={t.dark ? 0.5 : 0.35} />
            <Stop offset="1" stopColor={t.c.glowB} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={width * 0.5} cy={-height * 0.05} rx={width * 0.9} ry={height * 0.34} fill="url(#ga)" />
        <Ellipse cx={width * 0.85} cy={height * 0.22} rx={width * 0.55} ry={height * 0.2} fill="url(#gb)" />
      </Svg>
    </View>
  );
}
