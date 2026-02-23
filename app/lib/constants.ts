export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo';

export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const SOLANA_WS_URL = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? 'wss://api.devnet.solana.com';

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const MIN_BET_LAMPORTS = 100_000_000; // 0.1 SOL
export const MAX_BET_LAMPORTS = 10_000_000_000; // 10 SOL

export const GAME_PHASES = ['Waiting', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown', 'Finished'] as const;
export type GamePhase = typeof GAME_PHASES[number];

export const CARD_SUITS = ['Spades', 'Diamonds', 'Clubs', 'Hearts'] as const;
export const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export const CARD_UNKNOWN = 255;

// MagicBlock Ephemeral Rollup endpoints
export const MAGICBLOCK_ER_RPC_URL = process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL ?? 'https://devnet.magicblock.app';
export const MAGICBLOCK_ER_WS_URL = process.env.NEXT_PUBLIC_MAGICBLOCK_ER_WS_URL ?? 'wss://devnet.magicblock.app';
