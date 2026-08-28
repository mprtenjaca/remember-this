import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { THEMES, type Theme, type ThemeChoice } from './tokens';

const KEY = 'ui.theme';

interface Ctx {
  theme: Theme;
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
  ready: boolean;
}

const ThemeCtx = createContext<Ctx | null>(null);

/** Default is the signature look ("deep") regardless of the OS setting; "system" and "paper" are opt-in. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('deep');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'paper' || v === 'deep' || v === 'system') setChoiceState(v);
      })
      .finally(() => setReady(true));
  }, []);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    void AsyncStorage.setItem(KEY, c);
  }, []);

  const theme = useMemo<Theme>(() => {
    if (choice === 'system') return system === 'light' ? THEMES.paper : THEMES.deep;
    return THEMES[choice];
  }, [choice, system]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.c.bg).catch(() => undefined);
  }, [theme]);

  const value = useMemo(() => ({ theme, choice, setChoice, ready }), [theme, choice, setChoice, ready]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx.theme;
}

export function useThemeChoice() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useThemeChoice outside ThemeProvider');
  return { choice: ctx.choice, setChoice: ctx.setChoice, ready: ctx.ready };
}
