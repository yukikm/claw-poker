import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';

const CARD_SUITS = ['S', 'H', 'D', 'C'] as const;
const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const CARD_UNKNOWN = 255;

export interface DecodedGameState {
  gameId: string;
  player1: string;
  player2: string;
  buyIn: number;
  pot: number;
  currentTurn: string;
  phase: string;
  boardCards: string[];
  handNumber: number;
  dealerPosition: number;
  currentSmallBlind: number;
  currentBigBlind: number;
  player1ChipStack: number;
  player2ChipStack: number;
  consecutiveTimeoutsP1: number;
  consecutiveTimeoutsP2: number;
  lastRaiseAmount: number;
  player1Committed: number;
  player2Committed: number;
  winner: string | null;
  bettingClosed: boolean;
  streetActionTaken: boolean;
  lastActionAt: number;
  player1HasFolded: boolean;
  player2HasFolded: boolean;
  player1IsAllIn: boolean;
  player2IsAllIn: boolean;
}

export class GameMonitor {
  private subscriptions = new Map<string, { l1Sub: number; erSub: number }>();

  watchGame(
    gameId: string,
    gamePda: PublicKey,
    l1Connection: Connection,
    erConnection: Connection,
    onUpdate: (gameState: DecodedGameState) => void,
  ): void {
    if (this.subscriptions.has(gameId)) {
      return;
    }

    const handleAccountChange = (accountInfo: AccountInfo<Buffer>): void => {
      try {
        const state = this.decodeGameAccount(accountInfo.data);
        if (state) {
          onUpdate(state);
        }
      } catch (err) {
        console.error(`[GameMonitor] Failed to decode game account for ${gameId}:`, err);
      }
    };

    const l1Sub = l1Connection.onAccountChange(gamePda, handleAccountChange, 'confirmed');
    const erSub = erConnection.onAccountChange(gamePda, handleAccountChange, 'confirmed');

    this.subscriptions.set(gameId, { l1Sub, erSub });
    console.log(`[GameMonitor] Watching game ${gameId}`);
  }

  unwatchGame(gameId: string, l1Connection: Connection, erConnection: Connection): void {
    const subs = this.subscriptions.get(gameId);
    if (!subs) return;

    l1Connection.removeAccountChangeListener(subs.l1Sub);
    erConnection.removeAccountChangeListener(subs.erSub);
    this.subscriptions.delete(gameId);
    console.log(`[GameMonitor] Unwatched game ${gameId}`);
  }

  decodeGameAccount(data: Buffer): DecodedGameState | null {
    // Anchor accounts have an 8-byte discriminator prefix
    if (data.length < 8) return null;

    try {
      // Skip 8-byte discriminator
      let offset = 8;

      const gameId = data.readBigUInt64LE(offset).toString();
      offset += 8;

      const operator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const platformTreasury = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const player1 = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const player2 = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const buyIn = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const pot = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const currentTurn = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const phaseIndex = data.readUInt8(offset);
      offset += 1;
      const phases = ['Waiting', 'Shuffling', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown', 'Finished'];
      const phase = phases[phaseIndex] ?? 'Unknown';

      const boardCards: string[] = [];
      for (let i = 0; i < 5; i++) {
        const cardByte = data.readUInt8(offset + i);
        if (cardByte !== CARD_UNKNOWN) {
          boardCards.push(decodeCard(cardByte));
        }
      }
      offset += 5;

      // deck_commitment (32 bytes) - skip
      offset += 32;

      const player1Committed = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const player2Committed = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const handNumber = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const dealerPosition = data.readUInt8(offset);
      offset += 1;

      const currentSmallBlind = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const currentBigBlind = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const player1ChipStack = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const player2ChipStack = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const consecutiveTimeoutsP1 = data.readUInt8(offset);
      offset += 1;

      const consecutiveTimeoutsP2 = data.readUInt8(offset);
      offset += 1;

      const lastRaiseAmount = Number(data.readBigUInt64LE(offset));
      offset += 8;

      // last_checkpoint_hand (u64) - skip
      offset += 8;

      // winner: Option<Pubkey> (1 byte tag + 32 bytes if Some)
      const winnerTag = data.readUInt8(offset);
      offset += 1;
      let winner: string | null = null;
      if (winnerTag === 1) {
        winner = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
      } else {
        offset += 32;
      }

      const bettingClosed = data.readUInt8(offset) === 1;
      offset += 1;

      const streetActionTaken = data.readUInt8(offset) === 1;
      offset += 1;

      const lastActionAt = Number(data.readBigInt64LE(offset));
      offset += 8;

      // created_at (i64) - skip
      offset += 8;

      // showdown_cards_p1 (2 bytes) - skip
      offset += 2;

      // showdown_cards_p2 (2 bytes) - skip
      offset += 2;

      const player1HasFolded = data.readUInt8(offset) === 1;
      offset += 1;

      const player2HasFolded = data.readUInt8(offset) === 1;
      offset += 1;

      const player1IsAllIn = data.readUInt8(offset) === 1;
      offset += 1;

      const player2IsAllIn = data.readUInt8(offset) === 1;

      return {
        gameId,
        player1,
        player2,
        buyIn,
        pot,
        currentTurn,
        phase,
        boardCards,
        handNumber,
        dealerPosition,
        currentSmallBlind,
        currentBigBlind,
        player1ChipStack,
        player2ChipStack,
        consecutiveTimeoutsP1,
        consecutiveTimeoutsP2,
        lastRaiseAmount,
        player1Committed,
        player2Committed,
        winner,
        bettingClosed,
        streetActionTaken,
        lastActionAt,
        player1HasFolded,
        player2HasFolded,
        player1IsAllIn,
        player2IsAllIn,
      };
    } catch (err) {
      console.error('[GameMonitor] Decode error:', err);
      return null;
    }
  }

  getWatchedGameCount(): number {
    return this.subscriptions.size;
  }
}

function decodeCard(byte: number): string {
  if (byte >= 52) return '??';
  const suitIndex = Math.floor(byte / 13);
  const rankIndex = byte % 13;
  return CARD_RANKS[rankIndex] + CARD_SUITS[suitIndex];
}
