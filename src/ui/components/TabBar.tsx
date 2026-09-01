// Floating dock, centred: a glass pill with the three destinations, and the primary "+" beside it.
// Both are the same height so they read as one control strip rather than a small bar next to a big button.
// Voice lives inside the capture screen (the orb), not here — writing is the app's one verb.

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { R, S } from '../theme/tokens';
import { Glass } from './Glass';
import { uiLang } from '../theme/locale';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Labels are read by screen readers only (the dock is icon-only), and follow the DEVICE language like all UI copy.
const ICONS: Record<string, { on: IoniconName; off: IoniconName; label: { hr: string; en: string } }> = {
  // A calendar page with today's dot, not a sun: the sun read as weather (Marko, 2026-08-28).
  index: { on: 'today', off: 'today-outline', label: { hr: 'Danas', en: 'Today' } },
  timeline: { on: 'layers', off: 'layers-outline', label: { hr: 'Sve', en: 'All' } },
  search: { on: 'search', off: 'search-outline', label: { hr: 'Traži', en: 'Search' } },
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hr = uiLang() === 'hr';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
      <Glass variant="strong" radius={R.pill} style={styles.pill}>
        <View style={styles.row}>
          {state.routes.map((route, i) => {
            const focused = state.index === i;
            const icon = ICONS[route.name] ?? { on: 'ellipse', off: 'ellipse-outline', label: { hr: route.name, en: route.name } };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={icon.label[hr ? 'hr' : 'en']}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  navigation.navigate(route.name);
                }}
                style={[styles.tab, focused ? { backgroundColor: t.c.fg } : null]}
              >
                <Ionicons name={focused ? icon.on : icon.off} size={22} color={focused ? t.c.bg : t.c.fg2} />
              </Pressable>
            );
          })}
        </View>
      </Glass>

      {/* Primary action: a plus. Writing a note is the app's one verb. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hr ? 'Zapiši bilješku' : 'Write a note'}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          router.push('/capture');
        }}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: t.c.accent, shadowColor: t.c.accent, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] },
        ]}
      >
        <Ionicons name="add" size={30} color={t.c.onAccent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.sm,
  },
  pill: { paddingHorizontal: 6, paddingVertical: 6, justifyContent: 'center' },
  fab: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tab: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
