import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SettingsData {
  hapticsEnabled: boolean;
  pollingIntervalMs: number;
}

interface SettingsState extends SettingsData {
  isLoaded: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
  setPollingIntervalMs: (ms: number) => void;
  loadSettings: () => Promise<void>;
}

const STORAGE_KEY = 'claw_poker_settings';

const DEFAULTS: SettingsData = {
  hapticsEnabled: true,
  pollingIntervalMs: 5_000,
};

/** Serialize full state to avoid read-modify-write race */
function persistFromStore(state: SettingsData): void {
  AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ hapticsEnabled: state.hapticsEnabled, pollingIntervalMs: state.pollingIntervalMs })
  ).catch((err: unknown) => {
    console.warn('[settingsStore] persist error:', err);
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  isLoaded: false,

  setHapticsEnabled: (enabled: boolean) => {
    set({ hapticsEnabled: enabled });
    persistFromStore({ ...get(), hapticsEnabled: enabled });
  },

  setPollingIntervalMs: (ms: number) => {
    set({ pollingIntervalMs: ms });
    persistFromStore({ ...get(), pollingIntervalMs: ms });
  },

  loadSettings: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsData>;
        set({
          hapticsEnabled: parsed.hapticsEnabled ?? DEFAULTS.hapticsEnabled,
          pollingIntervalMs: parsed.pollingIntervalMs ?? DEFAULTS.pollingIntervalMs,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch (err) {
      console.warn('[settingsStore] load error:', err);
      set({ isLoaded: true });
    }
  },
}));
