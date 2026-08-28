import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Stack, router, useNavigationContainerRef } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Crypto from 'expo-crypto';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, useThemeChoice } from '@/ui/theme/ThemeProvider';
import { useAppFonts } from '@/ui/theme/fonts';
import { openDb } from '@/db';
import { setIdGenerator } from '@/lib/ids';
import { kickEnrichQueue } from '@/services/ai/queue';
import { refillScheduledWindow } from '@/services/scheduling/refill';
import { hasOnboarded } from '@/services/onboarding';
import { FONT } from '@/ui/theme/tokens';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
setIdGenerator(() => Crypto.randomUUID());

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Boot />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Boot() {
  const fontsReady = useAppFonts();
  const { ready: themeReady } = useThemeChoice();
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  // null = not read yet. Read BEFORE the splash lifts, so first launch never flashes the tabs and then jumps
  // to the welcome — the decision has to be made while the screen is still covered.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    openDb()
      .then(async () => {
        setOnboarded(await hasOnboarded());
        setDbReady(true);
        kickEnrichQueue(300);
        await refillScheduledWindow();
      })
      .catch((e: unknown) => setDbError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Foreground → pick up pending notes and re-fill the notification window.
  useEffect(() => {
    if (!dbReady) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        kickEnrichQueue(200);
        void refillScheduledWindow();
      }
    });
    return () => sub.remove();
  }, [dbReady]);

  const ready = fontsReady && themeReady && ((dbReady && onboarded != null) || !!dbError);
  useEffect(() => {
    // On a first launch the splash stays down: FirstLaunchGate lifts it once the redirect to the welcome has
    // landed, so the tabs never show for a frame first.
    // Expo Go + Fast Refresh can re-run this after the splash was already hidden (or never registered on this
    // view controller) — "No native splash screen registered" is harmless noise in dev, so swallow it silently.
    if (ready && onboarded !== false) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, onboarded]);

  if (!ready) return null;
  return <Navigation dbError={dbError} onboarded={onboarded ?? true} />;
}

/**
 * Sends a first launch to the welcome.
 *
 * `initialRouteName` on the Stack did NOT do this — in expo-router it only orders the stack's children
 * (`sortRoutesWithInitial`); the initial route still comes from linking, which resolves to the tabs. So a
 * reset "did nothing". The redirect is imperative instead, fired once navigation is ready, and it is the one
 * that lifts the splash — so the welcome is the first thing seen. The welcome later `replace`s itself with
 * the tabs, so there is never a route to go "back" to.
 *
 * Readiness comes from the container ref, NOT from `useRootNavigationState()`. That hook assumes it is called
 * from a ROUTE inside the root Stack (its own source says so) and THROWS when called here, in the layout
 * beside the Stack. The throw hit the error boundary, which remounted the tree, which remounted Boot, which
 * re-ran openDb() → refill → a screen that blinked forever while scheduler logs poured out.
 */
/** Set the moment the welcome has been navigated to, for the whole app session. */
let welcomeSent = false;

function FirstLaunchGate() {
  const nav = useNavigationContainerRef();
  useEffect(() => {
    if (welcomeSent) return;
    // Poll for readiness instead of subscribing to 'state'. The listener version fed itself: our own
    // replace() emits 'state', which re-ran the handler, and because the guard lived in a ref inside the
    // effect, any re-created effect (new router/nav identity) replaced onto the route we were already on —
    // remounting the welcome, emitting 'state' again. That was the blinking, and it only happened here
    // because the preview path from the debug screen never goes through this gate at all.
    //
    // `welcomeSent` is module-level on purpose: it must outlive remounts of this component, which a ref does not.
    let timer: ReturnType<typeof setTimeout>;
    const tryGo = () => {
      if (welcomeSent) return;
      if (!nav.isReady()) {
        timer = setTimeout(tryGo, 50);
        return;
      }
      welcomeSent = true;
      router.replace('/onboarding');
      SplashScreen.hideAsync().catch(() => undefined);
    };
    tryGo();
    // A stuck splash is worse than a flash of the tabs: if the redirect never lands, lift it regardless.
    const fallback = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 1500);
    return () => {
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, [nav]);
  return null;
}

function Navigation({ dbError, onboarded }: { dbError: string | null; onboarded: boolean }) {
  const t = useTheme();
  if (dbError) throw new Error(`Baza se nije otvorila: ${dbError}`);
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {!onboarded ? <FirstLaunchGate /> : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.c.bg },
          headerStyle: { backgroundColor: t.c.bg },
          headerTintColor: t.c.accent,
          headerTitleStyle: { fontFamily: FONT.bodySemibold, color: t.c.fg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen
          name="capture"
          options={{
            // Full native card modal (pull down to dismiss). formSheet detents opened half-height and kept the
            // content at the old size after expanding → hard gradient cut. The orb wants the whole stage anyway.
            presentation: 'modal',
            animation: 'slide_from_bottom',
            gestureEnabled: true,
            contentStyle: { backgroundColor: t.c.bg },
          }}
        />
        {/* Native header drew a solid band above the gradient (visible seam) and iOS 26 renders the back button as a
            large glass pill that fights the design — the screen draws its own small glass back button instead.
            Swipe-back gesture stays native. */}
        <Stack.Screen name="note/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="_debug/timeline" options={{ headerShown: true, title: 'Time travel' }} />
      </Stack>
    </>
  );
}
