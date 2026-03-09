import { View, StyleSheet } from 'react-native';
import { type CardDisplay } from '../../lib/types';
import { PlayingCard } from './PlayingCard';

interface HoleCardsProps {
  cards: CardDisplay[];
  size?: 'sm' | 'md' | 'lg';
}

export function HoleCards({ cards, size = 'md' }: HoleCardsProps) {
  const card1 = cards[0] ?? { suit: 'Spades' as const, rank: 0, isUnknown: true };
  const card2 = cards[1] ?? { suit: 'Spades' as const, rank: 0, isUnknown: true };

  return (
    <View style={styles.container} accessibilityLabel="Hole cards">
      <PlayingCard card={card1} size={size} delay={0} />
      <PlayingCard card={card2} size={size} delay={80} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 4,
  },
});
