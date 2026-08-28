import React from 'react';
import { Tabs } from 'expo-router';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { TabBar } from '@/ui/components/TabBar';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Danas' }} />
      <Tabs.Screen name="timeline" options={{ title: 'Sve' }} />
      <Tabs.Screen name="search" options={{ title: 'Traži' }} />
    </Tabs>
  );
}
