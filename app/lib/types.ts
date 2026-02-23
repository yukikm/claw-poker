import { PublicKey } from '@solana/web3.js';
import { GamePhase } from './constants';

export interface CardDisplay {
  suit: 'Spades' | 'Diamonds' | 'Clubs' | 'Hearts';
  rank: number; // 0-12 (0=2, 12=Ace)
  isUnknown: boolean;
}

export interface AgentState {
  address: PublicKey;
  chips: number; // lamports (chip units)
  chipsCommitted: number;
  hasFolded: boolean;
  isAllIn: boolean;
  lastAction: string | null;
}

export interface GameState {
  gameId: bigint;
  gamePda: PublicKey;
  phase: GamePhase;
  handNumber: number;
  pot: number;
  currentTurn: 0 | 1 | 2; // 1=Player1, 2=Player2, 0=no active turn (between streets / deal pending)
  boardCards: CardDisplay[];
  player1: AgentState;
  player2: AgentState;
  player1Key: PublicKey;
  player2Key: PublicKey;
  winner: PublicKey | null;
  bettingPoolPda: PublicKey;
  dealerPosition: number;
  lastRaiseAmount: number;
  showdownCardsP1: CardDisplay[];
  showdownCardsP2: CardDisplay[];
}

export interface GameSummary {
  gameId: bigint;
  gamePda: PublicKey;
  phase: GamePhase;
  handNumber: number;
  player1: PublicKey;
  player2: PublicKey;
  pot: number;
  winner: PublicKey | null;
  bettingPoolPda: PublicKey;
  isBettable: boolean;
  bettingClosed: boolean;
}

export interface BettingPoolState {
  gameId: bigint;
  totalBetPlayer1: number;
  totalBetPlayer2: number;
  betCount: number;
  isClosed: boolean;
  winner: PublicKey | null; // ゲーム終了時に設定される勝者のPublicKey
  distributed: boolean;
}

export interface MyBet {
  gameId: string; // stringified bigint for serialization
  gamePda: string;
  bettingPoolPda: string;
  betRecordPda: string;
  playerChoice: 1 | 2;
  amount: number; // lamports
  timestamp: number;
  status: 'active' | 'won' | 'lost' | 'claimed';
  payout: number | null;
  txSignature: string;
}
