'use client';

import { motion } from 'framer-motion';

interface PotDisplayProps {
  pot: number; // chip units
}

export function PotDisplay({ pot }: PotDisplayProps) {
  return (
    <motion.div
      key={pot}
      initial={{ scale: 0.9 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-1"
      aria-live="polite"
      aria-label={`Pot: ${pot} chips`}
    >
      <span className="text-xs text-slate-500 uppercase tracking-wider">POT</span>
      <div className="glass-cyan rounded-full px-5 py-2">
        <span className="text-xl font-bold text-cyan-300 font-mono">{pot}</span>
        <span className="text-xs text-cyan-500 ml-1">chips</span>
      </div>
    </motion.div>
  );
}
