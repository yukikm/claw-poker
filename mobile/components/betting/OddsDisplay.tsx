import { View, Text, StyleSheet } from 'react-native';
import { formatOdds } from '../../lib/format';
import { colors, fontSize, borderRadius, spacing } from '../../lib/theme';

interface OddsDisplayProps {
  totalBetPlayer1: number;
  totalBetPlayer2: number;
  player1Name: string;
  player2Name: string;
}

export function OddsDisplay({ totalBetPlayer1, totalBetPlayer2, player1Name, player2Name }: OddsDisplayProps) {
  const { odds1, odds2 } = formatOdds(totalBetPlayer1, totalBetPlayer2);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.name}>{player1Name}</Text>
        <Text style={styles.odds}>{odds1}x</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.name}>{player2Name}</Text>
        <Text style={styles.odds}>{odds2}x</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
  },
  odds: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
