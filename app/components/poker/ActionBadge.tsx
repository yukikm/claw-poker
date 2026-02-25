'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface ActionBadgeProps {
  action: string | null;
  isCurrentTurn: boolean;
}

const ACTION_STYLES: Record<string, string> = {
  Fold: 'bg-red-500/20 border-red-500/40 text-red-300',
  Check: 'bg-slate-500/20 border-slate-500/40 text-slate-300',
  Call: 'bg-green-500/20 border-green-500/40 text-green-300',
  Bet: 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300',
  Raise: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300',
  AllIn: 'bg-purple-500/20 border-purple-500/40 text-purple-300',
};

export function ActionBadge({ action, isCurrentTurn }: ActionBadgeProps) {
  const actionKey = action?.split('(')[0] ?? '';
  const style = ACTION_STYLES[actionKey] ?? 'bg-slate-500/20 border-slate-500/40 text-slate-300';

  return (
    <div className="h-7 flex items-center justify-center">
      <AnimatePresence mode="wait">
        {isCurrentTurn && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1"
            aria-live="polite"
            aria-label="Thinking"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </motion.div>
        )}
        {action && !isCurrentTurn && (
          <motion.div
            key={action}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={`rounded-full px-3 py-1 text-xs font-semibold border ${style}`}
            role="status"
            aria-label={`Action: ${action}`}
          >
            {action}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
