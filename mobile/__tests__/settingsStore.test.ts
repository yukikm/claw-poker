import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettingsStore } from '../stores/settingsStore';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  // Reset store to defaults between tests
  useSettingsStore.setState({
    hapticsEnabled: true,
    pollingIntervalMs: 5_000,
    isLoaded: false,
  });
  jest.clearAllMocks();
});

describe('settingsStore', () => {
  it('has correct defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.hapticsEnabled).toBe(true);
    expect(state.pollingIntervalMs).toBe(5_000);
    expect(state.isLoaded).toBe(false);
  });

  it('setHapticsEnabled updates state and persists', () => {
    useSettingsStore.getState().setHapticsEnabled(false);
    expect(useSettingsStore.getState().hapticsEnabled).toBe(false);
    expect(mockSetItem).toHaveBeenCalledWith(
      'claw_poker_settings',
      expect.stringContaining('"hapticsEnabled":false')
    );
  });

  it('setPollingIntervalMs updates state and persists', () => {
    useSettingsStore.getState().setPollingIntervalMs(10_000);
    expect(useSettingsStore.getState().pollingIntervalMs).toBe(10_000);
    expect(mockSetItem).toHaveBeenCalledWith(
      'claw_poker_settings',
      expect.stringContaining('"pollingIntervalMs":10000')
    );
  });

  it('loadSettings restores saved values', async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ hapticsEnabled: false, pollingIntervalMs: 3000 })
    );
    await useSettingsStore.getState().loadSettings();
    const state = useSettingsStore.getState();
    expect(state.hapticsEnabled).toBe(false);
    expect(state.pollingIntervalMs).toBe(3000);
    expect(state.isLoaded).toBe(true);
  });

  it('loadSettings uses defaults when storage is empty', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await useSettingsStore.getState().loadSettings();
    const state = useSettingsStore.getState();
    expect(state.hapticsEnabled).toBe(true);
    expect(state.pollingIntervalMs).toBe(5_000);
    expect(state.isLoaded).toBe(true);
  });

  it('loadSettings handles corrupted storage gracefully', async () => {
    mockGetItem.mockResolvedValueOnce('not-valid-json{{{');
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().isLoaded).toBe(true);
  });
});
