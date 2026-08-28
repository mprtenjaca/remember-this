import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FONT, T } from '../theme/tokens';

type Tone = 'fg' | 'fg2' | 'muted' | 'accent' | 'ion' | 'signal' | 'danger' | 'onAccent';
type Size = keyof typeof T;

interface Props extends TextProps {
  tone?: Tone;
  size?: Size;
  align?: TextStyle['textAlign'];
}

const line: Record<Size, number> = { xs: 14, sm: 18, md: 22, lg: 25, xl: 28, xxl: 40, hero: 54 };

function useTone(tone: Tone) {
  const t = useTheme();
  return t.c[tone];
}

/** Body — Inter. UI, descriptions, chat. */
export function Body({ tone = 'fg', size = 'md', align, style, ...rest }: Props) {
  const color = useTone(tone);
  return (
    <Text
      {...rest}
      style={[{ fontFamily: FONT.body, fontSize: T[size], lineHeight: line[size], color, textAlign: align }, style]}
      maxFontSizeMultiplier={2}
    />
  );
}

export function BodyMedium(p: Props) {
  return <Body {...p} style={[{ fontFamily: FONT.bodyMedium }, p.style]} />;
}

export function BodySemibold(p: Props) {
  return <Body {...p} style={[{ fontFamily: FONT.bodySemibold }, p.style]} />;
}

/** Display — Manrope. Note titles, big numbers, empty states. */
export function Display({ tone = 'fg', size = 'xl', align, style, weight, ...rest }: Props & { weight?: 'light' | 'semi' | 'bold' }) {
  const color = useTone(tone);
  const family = weight === 'bold' ? FONT.display : weight === 'light' ? FONT.displayLight : FONT.displayMedium;
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: family, fontSize: T[size], lineHeight: line[size], color, textAlign: align, letterSpacing: size === 'hero' || size === 'xxl' ? -1 : -0.3 },
        style,
      ]}
      maxFontSizeMultiplier={2}
    />
  );
}

/**
 * Meta — every date, time, offset and countdown. Inter Medium with tabular figures so columns of
 * dates line up; no typewriter face. (Kept as `Mono` for API stability.)
 */
export function Mono({ tone = 'muted', size = 'sm', align, style, ...rest }: Props) {
  const color = useTone(tone);
  return (
    <Text
      {...rest}
      style={[{ fontFamily: FONT.meta, fontSize: T[size], lineHeight: line[size], color, textAlign: align, fontVariant: ['tabular-nums'] }, style]}
      maxFontSizeMultiplier={1.6}
    />
  );
}
export const Meta = Mono;

/** Small uppercase section label. */
export function Label({ tone = 'muted', style, ...rest }: Props) {
  const color = useTone(tone);
  return (
    <Text
      {...rest}
      style={[{ fontFamily: FONT.bodySemibold, fontSize: T.xs, lineHeight: 14, color, letterSpacing: 1.1, textTransform: 'uppercase' }, style]}
      maxFontSizeMultiplier={1.6}
    />
  );
}
