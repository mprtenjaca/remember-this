// Confirmation sound. Pairs with the haptic tick already fired by Button/Chip: the tap is felt, the
// commit is heard. Only for actions that actually wrote something — never for navigation or for typing.
//
// Two Expo Go constraints shape this file:
//   1. `createAudioPlayer` must be called ONCE, not per play. A fresh player per tap leaks native
//      handles and adds ~80 ms of load latency to a moment that is meant to feel instant.
//   2. The player must be created lazily (not at module scope) — `src/services/*` is imported by
//      domain-adjacent code and Vitest, where the native module does not exist.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

const DING = require('../../../assets/dragon-studio-ding-sfx-472366.mp3');

let player: AudioPlayer | null = null;
let unavailable = false;

/** The recorder flips `allowsRecording` on; leaving it on routes playback to the earpiece on iOS. */
function ensure(): AudioPlayer | null {
  if (unavailable) return null;
  if (player) return player;
  try {
    player = createAudioPlayer(DING);
    player.volume = 0.5;
    void setAudioModeAsync({ playsInSilentMode: false, allowsRecording: false }).catch(() => undefined);
    return player;
  } catch {
    // No native audio (Vitest, or a stripped build) — sound is decoration, never a failure path.
    unavailable = true;
    return null;
  }
}

/**
 * Play the confirmation ding. Fire-and-forget: never awaited by a save path, never throws.
 * `playsInSilentMode: false` is deliberate — a phone on silent stays silent (the haptic still fires).
 */
export function playDing(): void {
  const p = ensure();
  if (!p) return;
  try {
    // Rewind first: a second save inside the clip's length would otherwise be silent.
    void p.seekTo(0).then(() => p.play()).catch(() => undefined);
  } catch {
    /* ignore — a missed sound must never break a save */
  }
}

/** Expo Go keeps the JS context alive across reloads; drop the native handle on teardown. */
export function releaseDing(): void {
  try {
    player?.remove();
  } catch {
    /* ignore */
  }
  player = null;
}
