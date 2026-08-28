import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/**
 * Keyboard height in px (0 when hidden). KeyboardAvoidingView mis-measures inside modals; padding the footer by
 * this value keeps the Save button above the keyboard on every presentation style.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(show, (e: KeyboardEvent) => setHeight(Math.max(0, e.endCoordinates?.height ?? 0)));
    const s2 = Keyboard.addListener(hide, () => setHeight(0));
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);
  return height;
}
