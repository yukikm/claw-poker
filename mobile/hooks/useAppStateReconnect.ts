import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export function useAppStateReconnect(onReconnect: () => void) {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const appSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/background/) && nextState === 'active') {
        onReconnect();
      }
      appState.current = nextState;
    });

    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        onReconnect();
      }
    });

    return () => {
      appSub.remove();
      netSub(); // NetInfo.addEventListener returns unsubscribe function
    };
  }, [onReconnect]);
}
