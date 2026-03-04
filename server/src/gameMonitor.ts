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
  lastCheckpointHand: number;
  player1Committed: number;
  player2Committed: number;
  winner: string | null;
  bettingClosed: boolean;
  streetActionTaken: boolean;
  lastActionAt: number;
  /** ショーダウン時のPlayer1ホールカード ([255,255] = 未公開/クリア済み) */
  showdownCardsP1: [string, string] | null;
  /** ショーダウン時のPlayer2ホールカード ([255,255] = 未公開/クリア済み) */
  showdownCardsP2: [string, string] | null;
  player1HasFolded: boolean;
  player2HasFolded: boolean;
  player1IsAllIn: boolean;
  player2IsAllIn: boolean;
}

export class GameMonitor {
  private subscriptions = new Map<string, {
    l1Sub: number;
    erSub: number;
    teeSub?: number;
    teeConn?: Connection;
  }>();

  /**
   * ゲームアカウントの変更を購読する。
   * teeConnection が指定された場合、プライベートER（TEE）からリアルタイム変更を受信する。
   * TEE未指定時は公開ER（erConnection）を使うが、プライベートERゲームでは変更通知が届かない。
   */
  watchGame(
    gameId: string,
    gamePda: PublicKey,
    l1Connection: Connection,
    erConnection: Connection,
    onUpdate: (gameState: DecodedGameState) => void,
    teeConnection?: Connection,
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

    // プライベートER（TEE）WebSocket購読: ゲームアカウントのリアルタイム変更を受信する
    let teeSub: number | undefined;
    if (teeConnection) {
      teeSub = teeConnection.onAccountChange(gamePda, handleAccountChange, 'confirmed');
      console.log(`[GameMonitor] Watching game ${gameId} (L1 + public ER + private ER TEE)`);
    } else {
      console.log(`[GameMonitor] Watching game ${gameId} (L1 + public ER only, no TEE)`);
    }

    this.subscriptions.set(gameId, { l1Sub, erSub, teeSub, teeConn: teeConnection });

    // onAccountChange はアカウントの「変化」のみ通知し、初期状態は通知しない。
    // プライベートERではTEE接続から初期取得する。公開ERにはアカウントが存在しない。
    const primaryConn = teeConnection ?? erConnection;
    void this.fetchInitialState(gameId, gamePda, primaryConn, l1Connection, handleAccountChange);
  }

  unwatchGame(gameId: string, l1Connection: Connection, erConnection: Connection): void {
    const subs = this.subscriptions.get(gameId);
    if (!subs) return;

    l1Connection.removeAccountChangeListener(subs.l1Sub);
    erConnection.removeAccountChangeListener(subs.erSub);
    if (subs.teeSub !== undefined && subs.teeConn) {
      subs.teeConn.removeAccountChangeListener(subs.teeSub);
    }
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

      const lastCheckpointHand = Number(data.readBigUInt64LE(offset));
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

      // showdown_cards_p1 (2 bytes)
      const sdCard1P1 = data.readUInt8(offset);
      const sdCard2P1 = data.readUInt8(offset + 1);
      offset += 2;
      const showdownCardsP1: [string, string] | null =
        sdCard1P1 !== CARD_UNKNOWN && sdCard2P1 !== CARD_UNKNOWN
          ? [decodeCard(sdCard1P1), decodeCard(sdCard2P1)]
          : null;

      // showdown_cards_p2 (2 bytes)
      const sdCard1P2 = data.readUInt8(offset);
      const sdCard2P2 = data.readUInt8(offset + 1);
      offset += 2;
      const showdownCardsP2: [string, string] | null =
        sdCard1P2 !== CARD_UNKNOWN && sdCard2P2 !== CARD_UNKNOWN
          ? [decodeCard(sdCard1P2), decodeCard(sdCard2P2)]
          : null;

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
        lastCheckpointHand,
        player1Committed,
        player2Committed,
        winner,
        bettingClosed,
        streetActionTaken,
        lastActionAt,
        showdownCardsP1,
        showdownCardsP2,
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

  private async fetchInitialState(
    gameId: string,
    gamePda: PublicKey,
    erConnection: Connection,
    l1Connection: Connection,
    handleAccountChange: (info: AccountInfo<Buffer>) => void,
  ): Promise<void> {
    const MAX_RETRIES = 4;
    const RETRY_DELAY_MS = 1500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const info = await erConnection.getAccountInfo(gamePda, 'confirmed');
        if (info) {
          handleAccountChange(info as AccountInfo<Buffer>);
          return;
        }
        // ER に未反映の場合は L1 からフォールバック（デリゲーション完了前の可能性）
        if (attempt === MAX_RETRIES) {
          const l1Info = await l1Connection.getAccountInfo(gamePda, 'confirmed');
          if (l1Info) {
            handleAccountChange(l1Info as AccountInfo<Buffer>);
          } else {
            console.warn(`[GameMonitor] Game ${gameId}: account not found after ${MAX_RETRIES} retries`);
          }
          return;
        }
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          console.error(`[GameMonitor] Failed to fetch initial state for game ${gameId}:`, err);
          return;
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
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
