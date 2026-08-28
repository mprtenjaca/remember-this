// An icon that spins, swaps and settles — the whole transition for a view switch, contained in the control
// that caused it.
//
// This replaces a full-screen wipe. The wipe read as far too big a gesture for what actually changes (the
// order of a list), and on device the moving fill stuttered. Keeping the motion inside the button says the
// same thing — "this control just changed what you are looking at" — at the scale of the thing that changed.
//
// The glyph swaps at the half-turn, where the icon is edge-on and effectively invisible, so it is never seen
// morphing. That is about the ICON only — the screen behind it changes on the tap, immediately. An animation
// that gates the thing it announces makes the control feel like it missed the press.

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  /** The icon for the state you are in now. Changing it plays the flip. */
  name: IoniconName;
  size?: number;
  /**
   * Fires at the half-turn, when the glyph is hidden. Optional, and NOT the way to sequence a screen change:
   * the content should change on the tap, with this spin running alongside it. Gating a list behind the
   * animation made the button feel unresponsive.
   */
  onHalfway?: (landed: IoniconName) => void;
}

const SPIN_MS = 460;

export function FlipIcon({ name, size = 19, onHalfway }: Props) {
  const t = useTheme();
  // Held one turn behind `name` so the glyph on screen only changes at the half-turn.
  const [shown, setShown] = useState(name);
  const spin = useSharedValue(0);
  const first = React.useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      setShown(name);
      return;
    }
    if (name === shown) return;
    spin.value = 0;
    spin.value = withSequence(
      // Out to the half-turn, then on to the full one. Split so the swap lands exactly edge-on.
      withTiming(0.5, { duration: SPIN_MS * 0.5, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) {
          runOnJS(setShown)(name);
          if (onHalfway) runOnJS(onHalfway)(name);
        }
      }),
      withTiming(1, { duration: SPIN_MS * 0.5, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const style = useAnimatedStyle(() => ({
    // Edge-on at the half-turn: scaleX through zero hides the glyph without needing a 3D transform.
    transform: [{ rotate: `${spin.value * 360}deg` }, { scaleX: interpolate(spin.value, [0, 0.5, 1], [1, 0, 1]) }],
  }));

  // The button fills solid lime through the turn and drains back. Held at full colour across the middle
  // rather than peaking at a single instant, so the swap happens while the fill is unambiguous.
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(spin.value, [0, 0.25, 0.75, 1], ['transparent', t.c.accent, t.c.accent, 'transparent']),
  }));

  // A dark copy fading in over the normal one, in step with the fill. Two layers rather than an animated
  // colour, because Ionicons takes a plain colour prop that no animation can drive.
  const dark = useAnimatedStyle(() => ({ opacity: interpolate(spin.value, [0, 0.25, 0.75, 1], [0, 1, 1, 0]) }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fill]} />
      <Animated.View style={style}>
        <Ionicons name={shown} size={size} color={t.c.accent} />
        {/* Centred explicitly: the rotating parent is sized by the glyph, so an absolutely-filled child
            would otherwise anchor to its top-left rather than sitting exactly on top of it. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, dark]}>
          <Ionicons name={shown} size={size} color={t.c.onAccent} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Stretches to the host button so the lime fills it edge to edge; a wrapper hugging the glyph would show a
  // small disc floating inside a larger pill.
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fill: { borderRadius: 999 },
  overlay: { alignItems: 'center', justifyContent: 'center' },
});
