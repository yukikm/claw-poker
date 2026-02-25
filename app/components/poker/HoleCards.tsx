'use client';

import { motion } from 'framer-motion';
import { type CardDisplay } from '@/lib/types';
import { cardDisplayString } from '@/lib/format';

interface HoleCardsProps {
  cards?: CardDisplay[];
  position: 'left' | 'right';
}

function CardBack({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay }}
      className="w-[60px] h-[84px] md:w-[90px] md:h-[126px] rounded-lg border-2 border-white/20 shadow-card overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0a1628 100%)' }}
      aria-label="Card (face down)"
    >
      <div className="w-full h-full flex items-center justify-center opacity-30">
        <svg viewBox="0 0 40 40" className="w-8 h-8" fill="currentColor" aria-hidden="true">
          <path d="M20 2L4 20l16 18 16-18L20 2z" fill="rgba(6,182,212,0.5)" />
        </svg>
      </div>
    </motion.div>
  );
}

function CardFace({ card, delay = 0 }: { card: CardDisplay; delay?: number }) {
  const isRed = card.suit === 'Hearts' || card.suit === 'Diamonds';
  return (
    <motion.div
      initial={{ opacity: 0, rotateY: 180 }}
      animate={{ opacity: 1, rotateY: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className={`
        w-[60px] h-[84px] md:w-[90px] md:h-[126px] rounded-lg border-2 border-white/80 shadow-card
        flex items-center justify-center text-xl md:text-3xl font-bold
        bg-white ${isRed ? 'text-red-600' : 'text-slate-900'}
      `}
      aria-label={cardDisplayString(card)}
    >
      {cardDisplayString(card)}
    </motion.div>
  );
}

export function HoleCards({ cards, position }: HoleCardsProps) {
  const isRevealed = cards && cards.length === 2 && cards.every(c => !c.isUnknown);

  return (
    <div
      className={`flex gap-1 md:gap-2 ${position === 'left' ? '' : 'flex-row-reverse'}`}
      aria-label={`Hole cards (${isRevealed ? 'revealed' : 'hidden'})`}
    >
      {isRevealed ? (
        <>
          <CardFace card={cards[0]} delay={0} />
          <CardFace card={cards[1]} delay={0.15} />
        </>
      ) : (
        <>
          <CardBack delay={0} />
          <CardBack delay={0.15} />
        </>
      )}
    </div>
  );
}
