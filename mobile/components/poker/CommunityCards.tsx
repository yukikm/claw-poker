import { View, StyleSheet } from 'react-native';
import { type CardDisplay } from '../../lib/types';
import { PlayingCard } from './PlayingCard';

interface CommunityCardsProps {
  cards: CardDisplay[];
}

const CASCADE_DELAY_MS = 100;

export function CommunityCards({ cards }: CommunityCardsProps) {
  // Always show 5 card slots
  const slots: CardDisplay[] = Array.from({ length: 5 }, (_, i) =>
    cards[i] ?? { suit: 'Spades' as const, rank: 0, isUnknown: true }
  );

  return (
    <View style={styles.container} accessibilityLabel={`Community cards: ${cards.length} revealed`}>
      {slots.map((card, i) => (
        <PlayingCard key={i} card={card} size="md" delay={i * CASCADE_DELAY_MS} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
});
