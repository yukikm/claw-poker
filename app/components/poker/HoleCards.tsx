'use client';

import { motion } from 'framer-motion';

interface HoleCardsProps {
  isRevealed: boolean;
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
      aria-label="カード（裏面）"
    >
      <div className="w-full h-full flex items-center justify-center opacity-30">
        <svg viewBox="0 0 40 40" className="w-8 h-8" fill="currentColor" aria-hidden="true">
          <path d="M20 2L4 20l16 18 16-18L20 2z" fill="rgba(6,182,212,0.5)" />
        </svg>
      </div>
    </motion.div>
  );
}

export function HoleCards({ isRevealed, position }: HoleCardsProps) {
  return (
    <div
      className={`flex gap-1 md:gap-2 ${position === 'left' ? '' : 'flex-row-reverse'}`}
      aria-label={`ホールカード（${isRevealed ? '公開済み' : '非公開'}）`}
    >
      <CardBack delay={0} />
      <CardBack delay={0.15} />
    </div>
  );
}
