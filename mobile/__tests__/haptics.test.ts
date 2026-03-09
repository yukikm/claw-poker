import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '../stores/settingsStore';
import { hapticLight, hapticMedium, hapticSuccess, hapticError, hapticSelection } from '../lib/haptics';

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.setState({ hapticsEnabled: true });
});

describe('haptics', () => {
  it('triggers haptic when enabled', () => {
    hapticLight();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('does not trigger haptic when disabled', () => {
    useSettingsStore.setState({ hapticsEnabled: false });
    hapticLight();
    hapticMedium();
    hapticSuccess();
    hapticError();
    hapticSelection();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('hapticMedium calls Medium impact', () => {
    hapticMedium();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  });

  it('hapticSuccess calls Success notification', () => {
    hapticSuccess();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('hapticError calls Error notification', () => {
    hapticError();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('hapticSelection calls selectionAsync', () => {
    hapticSelection();
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });
});
