'use client';

import { motion } from 'framer-motion';
import { type CardDisplay } from '@/lib/types';
import { cardDisplayString } from '@/lib/format';

interface CommunityCardsProps {
  cards: CardDisplay[];
  phase: string;
}

function PlayingCard({ card, index }: { card: CardDisplay; index: number }) {
  const isRed = card.suit === 'Hearts' || card.suit === 'Diamonds';
  const isVisible = !card.isUnknown;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, rotateY: 180 }}
      animate={{ opacity: isVisible ? 1 : 0.3, y: 0, rotateY: 0 }}
      transition={{ duration: 0.4, delay: index * 0.15, ease: 'easeOut' }}
      className={`
        w-[52px] h-[72px] md:w-[72px] md:h-[100px] rounded-lg border-2 shadow-card
        flex items-center justify-center text-lg md:text-2xl font-bold
        ${isVisible
          ? 'bg-white border-white/80 ' + (isRed ? 'text-red-600' : 'text-slate-900')
          : 'bg-slate-800 border-white/10 text-slate-600'
        }
      `}
      aria-label={isVisible ? cardDisplayString(card) : '未公開カード'}
    >
      {isVisible ? cardDisplayString(card) : '?'}
    </motion.div>
  );
}

export function CommunityCards({ cards, phase }: CommunityCardsProps) {
  const visibleCount = {
    Waiting: 0, Shuffling: 0, PreFlop: 0, Flop: 3, Turn: 4, River: 5, Showdown: 5, Finished: 5,
  }[phase] ?? 0;

  const displayCards = cards.slice(0, 5).map((card, i) =>
    i < visibleCount ? card : { suit: 'Spades' as const, rank: 0, isUnknown: true }
  );

  return (
    <div className="flex gap-2 md:gap-3 items-center justify-center" role="list" aria-label="コミュニティカード">
      {displayCards.map((card, i) => (
        <div key={i} role="listitem">
          <PlayingCard card={card} index={i} />
        </div>
      ))}
    </div>
  );
}
