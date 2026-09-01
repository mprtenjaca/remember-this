import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { TabBar } from '@/ui/components/TabBar';
import { CaptureToast } from '@/ui/components/CaptureToast';
import { uiLang } from '@/ui/theme/locale';

export default function TabsLayout() {
  const t = useTheme();
  const hr = uiLang() === 'hr';
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: t.c.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: hr ? 'Danas' : 'Today' }} />
        <Tabs.Screen name="timeline" options={{ title: hr ? 'Sve' : 'All' }} />
        <Tabs.Screen name="search" options={{ title: hr ? 'Traži' : 'Search' }} />
      </Tabs>
      {/* Above the dock, on whichever tab the capture sheet closed onto. Hosted once, here, for that reason. */}
      <CaptureToast />
    </View>
  );
}
