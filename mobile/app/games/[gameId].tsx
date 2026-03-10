import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '../../providers/ConnectionProvider';
import { useWatchGameStore } from '../../stores/watchGameStore';
import { useGamesStore } from '../../stores/gamesStore';
import { getProgramId } from '../../lib/anchor';
import { colors, fontSize, spacing, borderRadius } from '../../lib/theme';
import { PokerTable } from '../../components/poker/PokerTable';
import { BettingPanel } from '../../components/betting/BettingPanel';

export default function GameDetailScreen() {
  const { gameId: gameIdParam } = useLocalSearchParams<{ gameId: string }>();
  const { game, bettingPool, isLoading, subscribeToGame, unsubscribeFromGame } = useWatchGameStore();
  const { fetchGames } = useGamesStore();
  const { connection } = useConnection();
  const programId = getProgramId();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const [notFound, setNotFound] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!gameIdParam) return;

    let gamePda: PublicKey;
    try {
      gamePda = new PublicKey(gameIdParam);
    } catch {
      console.error('[GameDetail] Invalid gameId param:', gameIdParam);
      setNotFound(true);
      return;
    }

    // Read games snapshot once (not reactive - avoids re-subscribe on every poll)
    const currentGames = useGamesStore.getState().games;
    const gameSummary = currentGames.find((g) => g.gamePda.toBase58() === gameIdParam);

    if (gameSummary) {
      setNotFound(false);
      subscribeToGame(
        gamePda,
        gameSummary.bettingPoolPda,
        programId,
        gameSummary.gameId.toString()
      );
    } else {
      // Games not yet loaded or game not found - fetch and retry
      fetchGames(connectionRef.current, programId).then(() => {
        const found = useGamesStore.getState().games.find(
          (g) => g.gamePda.toBase58() === gameIdParam
        );
        if (found) {
          setNotFound(false);
          subscribeToGame(
            gamePda,
            found.bettingPoolPda,
            programId,
            found.gameId.toString()
          );
        } else {
          setNotFound(true);
        }
      });
    }

    return () => {
      unsubscribeFromGame();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameIdParam, programId, retryCount]);

  if (notFound) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Game not found</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => {
            setNotFound(false);
            setRetryCount((c) => c + 1);
          }}
          accessibilityRole="button"
          accessibilityLabel="Retry loading game"
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading || !game) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.cyan.DEFAULT} />
        <Text style={styles.loadingText}>Loading game...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <PokerTable game={game} />
      <View style={styles.bettingSection}>
        <BettingPanel game={game} bettingPool={bettingPool} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg.primary,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
  },
  errorText: {
    color: colors.text.secondary,
    fontSize: fontSize.lg,
  },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.cyan.DEFAULT,
  },
  retryText: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  bettingSection: {
    marginTop: spacing.lg,
  },
});
