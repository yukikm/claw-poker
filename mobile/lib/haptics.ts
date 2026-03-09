import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '../stores/settingsStore';

/** Silently ignore haptic errors on unsupported devices, log unexpected errors */
function safeHaptic(fn: () => Promise<void>): void {
  if (!useSettingsStore.getState().hapticsEnabled) return;
  fn().catch((err: unknown) => {
    // expo-haptics throws on unsupported devices (emulators, etc.) - ignore
    const message = err instanceof Error ? err.message : '';
    if (!message.includes('not supported') && !message.includes('not available')) {
      console.warn('[haptics] unexpected error:', err);
    }
  });
}

/** Light tap for button presses and selections */
export function hapticLight(): void {
  safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Medium tap for confirmations */
export function hapticMedium(): void {
  safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Success notification (bet placed, reward claimed) */
export function hapticSuccess(): void {
  safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Error notification (transaction failed) */
export function hapticError(): void {
  safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** Selection change (player toggle, preset pick) */
export function hapticSelection(): void {
  safeHaptic(() => Haptics.selectionAsync());
}
