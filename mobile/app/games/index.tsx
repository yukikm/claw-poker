import { useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useConnection } from '../../providers/ConnectionProvider';
import { useGamesStore } from '../../stores/gamesStore';
import { getProgramId } from '../../lib/anchor';
import { useAppStateReconnect } from '../../hooks/useAppStateReconnect';
import { colors } from '../../lib/theme';
import { GameList } from '../../components/game/GameList';

export default function GamesScreen() {
  const { connection } = useConnection();
  const { games, isLoading, serverConnected, startPolling, stopPolling, fetchGames } = useGamesStore();
  const programId = getProgramId();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  useEffect(() => {
    startPolling(connection, programId);
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  const handleRefresh = useCallback(() => {
    fetchGames(connectionRef.current, programId);
  }, [programId, fetchGames]);

  useAppStateReconnect(handleRefresh);

  return (
    <View style={styles.container}>
      <GameList
        games={games}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        serverConnected={serverConnected}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
});
