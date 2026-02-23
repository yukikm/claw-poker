import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { AnchorProvider, Program, BN, Idl, Wallet } from '@coral-xyz/anchor';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require(path.join(__dirname, '../../app/lib/claw_poker_idl.json')) as Idl;

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');

const PLATFORM_TREASURY = new PublicKey(
  process.env.PLATFORM_TREASURY_PUBKEY ?? SystemProgram.programId.toBase58(),
);

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

export interface ActiveGame {
  gameId: bigint;
  gamePda: string;
  player1: string;
  player2: string;
  phase: string;
  pot: number;
  handNumber: number;
}

/** Anchor VariantオブジェクトにPlayerActionを変換 */
function toAnchorAction(action: ActionType): Record<string, Record<string, never>> {
  const map: Record<ActionType, string> = {
    fold: 'fold',
    check: 'check',
    call: 'call',
    bet: 'bet',
    raise: 'raise',
    all_in: 'allIn',
  };
  return { [map[action]]: {} };
}

export class AnchorClient {
  private l1Connection: Connection;
  private erConnection: Connection;
  private operatorKeypair: Keypair;
  private l1Program: Program;
  private erProgram: Program;

  constructor(rpcUrl: string, erRpcUrl: string) {
    this.l1Connection = new Connection(rpcUrl, 'confirmed');
    this.erConnection = new Connection(erRpcUrl, 'confirmed');

    const operatorPrivKey = process.env.OPERATOR_PRIVATE_KEY;
    if (!operatorPrivKey) {
      console.warn('[AnchorClient] OPERATOR_PRIVATE_KEY not set, using ephemeral keypair (dev only)');
      this.operatorKeypair = Keypair.generate();
    } else {
      // OPERATOR_PRIVATE_KEY はsolana-keygenと同じJSON配列形式: [1,2,...,64]
      try {
        this.operatorKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(operatorPrivKey) as number[]),
        );
      } catch {
        console.warn('[AnchorClient] Invalid OPERATOR_PRIVATE_KEY format. Using ephemeral keypair.');
        this.operatorKeypair = Keypair.generate();
      }
    }

    // AnchorProviderのWalletインターフェースを実装（NodeWallet互換）
    const makeWallet = (kp: Keypair): Wallet => ({
      payer: kp,
      publicKey: kp.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
        if (tx instanceof Transaction) {
          tx.partialSign(kp);
        }
        return tx;
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
        txs.forEach((tx) => {
          if (tx instanceof Transaction) {
            tx.partialSign(kp);
          }
        });
        return txs;
      },
    });

    const l1Provider = new AnchorProvider(this.l1Connection, makeWallet(this.operatorKeypair), {
      commitment: 'confirmed',
    });
    const erProvider = new AnchorProvider(this.erConnection, makeWallet(this.operatorKeypair), {
      commitment: 'confirmed',
    });

    this.l1Program = new Program(IDL, l1Provider);
    this.erProgram = new Program(IDL, erProvider);
  }

  getL1Connection(): Connection {
    return this.l1Connection;
  }

  getERConnection(): Connection {
    return this.erConnection;
  }

  getOperatorPublicKey(): PublicKey {
    return this.operatorKeypair.publicKey;
  }

  // ─── PDA導出 ─────────────────────────────────────────────────────────────

  deriveGamePda(gameId: bigint): [PublicKey, number] {
    const gameIdBuffer = Buffer.alloc(8);
    gameIdBuffer.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync([Buffer.from('game'), gameIdBuffer], PROGRAM_ID);
  }

  /** game_vault PDA: seeds = [b"game_vault", game_id_le] */
  deriveVaultPda(gameId: bigint): [PublicKey, number] {
    const gameIdBuffer = Buffer.alloc(8);
    gameIdBuffer.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync([Buffer.from('game_vault'), gameIdBuffer], PROGRAM_ID);
  }

  /** matchmaking_queue PDA: seeds = [b"matchmaking_queue"] */
  deriveMatchmakingQueuePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('matchmaking_queue')], PROGRAM_ID);
  }

  derivePlayerStatePda(gameId: bigint, playerPubkey: PublicKey): [PublicKey, number] {
    const gameIdBuffer = Buffer.alloc(8);
    gameIdBuffer.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('player_state'), gameIdBuffer, playerPubkey.toBuffer()],
      PROGRAM_ID,
    );
  }

  deriveBettingPoolPda(gameId: bigint): [PublicKey, number] {
    const gameIdBuffer = Buffer.alloc(8);
    gameIdBuffer.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync([Buffer.from('betting_pool'), gameIdBuffer], PROGRAM_ID);
  }

  // ─── トランザクション検証 ──────────────────────────────────────────────────

  /** sha256("global:enter_matchmaking_queue")[0..8] */
  private static readonly ENTER_QUEUE_DISCRIMINATOR = Buffer.from([222, 121, 183, 27, 168, 28, 129, 37]);

  /**
   * enter_matchmaking_queue トランザクションを検証する。
   * - 送信者が expectedSender であること
   * - 本プログラムの enter_matchmaking_queue 命令が含まれていること（discriminatorで検証）
   * - 送金先が MatchmakingQueue PDA であること
   * - 送金額が expectedAmount 以上であること
   * - トランザクションが確認済みであること
   * - 同じ署名の二重使用がないこと（呼び出し元でチェック）
   */
  async verifyEntryFeeTransaction(
    txSignature: string,
    expectedSender: string,
    expectedAmount: number,
  ): Promise<boolean> {
    try {
      const tx = await this.l1Connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) return false;
      if (tx.meta.err !== null) return false;

      const accountKeys = tx.transaction.message.getAccountKeys();

      // 送信者検証 (index 0 はフィー支払者 / 最初のsigner)
      const senderKey = accountKeys.get(0);
      if (!senderKey || senderKey.toBase58() !== expectedSender) return false;

      // 本プログラムの enter_matchmaking_queue 命令が呼ばれていることを discriminator で検証
      // これにより直接 SOL 送金での偽検証を防ぐ
      const instructions = tx.transaction.message.compiledInstructions;
      const hasValidInstruction = instructions.some((ix) => {
        const programKey = accountKeys.get(ix.programIdIndex);
        if (!programKey || programKey.toBase58() !== PROGRAM_ID.toBase58()) return false;
        const data = Buffer.from(ix.data);
        return (
          data.length >= 8 &&
          data.slice(0, 8).equals(AnchorClient.ENTER_QUEUE_DISCRIMINATOR)
        );
      });
      if (!hasValidInstruction) return false;

      // MatchmakingQueue PDA が含まれているか確認
      const [queuePda] = this.deriveMatchmakingQueuePda();
      const queueIndex = Array.from({ length: accountKeys.length }, (_, i) => i).find(
        (i) => accountKeys.get(i)?.toBase58() === queuePda.toBase58(),
      );
      if (queueIndex === undefined) return false;

      // 残高変化でキューへの送金額を検証
      const preBalances = tx.meta.preBalances;
      const postBalances = tx.meta.postBalances;
      const queueBalanceIncrease = postBalances[queueIndex] - preBalances[queueIndex];
      if (queueBalanceIncrease < expectedAmount) return false;

      return true;
    } catch (err) {
      console.error('[AnchorClient] Failed to verify entry fee transaction:', err);
      return false;
    }
  }

  // ─── オンチェーン命令呼び出し ─────────────────────────────────────────────

  /**
   * ゲームを初期化し、GameVaultを作成する。
   * マッチング成立後にサーバーが呼び出す。
   */
  async initializeGame(
    gameId: bigint,
    player1: PublicKey,
    player2: PublicKey,
    buyIn: bigint,
  ): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2);
    const [vaultPda] = this.deriveVaultPda(gameId);
    const [queuePda] = this.deriveMatchmakingQueuePda();
    const operatorPubkey = this.operatorKeypair.publicKey;

    // Step 1: initialize_game
    await (this.l1Program.methods as unknown as {
      initializeGame: (
        gameId: BN,
        player1: PublicKey,
        player2: PublicKey,
        buyIn: BN,
        operator: PublicKey,
        platformTreasury: PublicKey,
      ) => { accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> } };
    })
      .initializeGame(
        new BN(gameId.toString()),
        player1,
        player2,
        new BN(buyIn.toString()),
        operatorPubkey,
        PLATFORM_TREASURY,
      )
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 2: create_game_vault（QueueからVaultへ資金移動）
    const txSig = await (this.l1Program.methods as unknown as {
      createGameVault: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .createGameVault(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        gameVault: vaultPda,
        matchmakingQueue: queuePda,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`[AnchorClient] Game ${gameId} initialized: ${gamePda.toBase58()}, vault: ${vaultPda.toBase58()}`);
    return txSig;
  }

  /**
   * TEEオペレーターとしてプレイヤーアクションをER上で実行する。
   * player_action.rsのoperatorをSignerとするパターンを使用。
   */
  async submitPlayerAction(
    gameId: bigint,
    playerWallet: PublicKey,
    action: ActionType,
    amount?: number,
  ): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [playerStatePda] = this.derivePlayerStatePda(gameId, playerWallet);
    const operatorPubkey = this.operatorKeypair.publicKey;

    const anchorAmount = amount !== undefined ? new BN(amount) : null;

    const txSig = await (this.erProgram.methods as unknown as {
      playerAction: (
        gameId: BN,
        action: Record<string, Record<string, never>>,
        amount: BN | null,
      ) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .playerAction(new BN(gameId.toString()), toAnchorAction(action), anchorAmount)
      .accounts({
        game: gamePda,
        playerState: playerStatePda,
        player: playerWallet,
        operator: operatorPubkey,
      })
      .rpc();

    console.log(`[AnchorClient] Action ${action} for ${playerWallet.toBase58()} in game ${gameId}: ${txSig}`);
    return txSig;
  }

  // ─── マッチメイキングキュー離脱 ──────────────────────────────────────────────

  /**
   * leave_matchmaking_queue を呼び出してプレイヤーにエントリーフィーを返金する。
   * オペレーターがplayerの代理として署名する（TEE/PERパターン）。
   */
  async leaveMatchmakingQueue(playerWallet: PublicKey): Promise<string> {
    const [queuePda] = this.deriveMatchmakingQueuePda();

    const txSig = await (this.l1Program.methods as unknown as {
      leaveMatchmakingQueue: () => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .leaveMatchmakingQueue()
      .accounts({
        matchmakingQueue: queuePda,
        player: playerWallet,
      })
      .rpc();

    console.log(`[AnchorClient] Player ${playerWallet.toBase58()} left queue, refund tx: ${txSig}`);
    return txSig;
  }

  // ─── PlayerState読み取り ───────────────────────────────────────────────────

  /**
   * PlayerStateアカウントからホールカードを読み取る。
   * ERコネクションから読み取り（ゲーム中はER上に存在）。
   */
  async getPlayerHoleCards(
    gameId: bigint,
    playerWallet: PublicKey,
  ): Promise<[string, string] | null> {
    try {
      const [playerStatePda] = this.derivePlayerStatePda(gameId, playerWallet);
      const accountInfo = await this.erConnection.getAccountInfo(playerStatePda, 'confirmed');
      if (!accountInfo) return null;

      const decoded = this.erProgram.coder.accounts.decode('PlayerState', accountInfo.data) as {
        holeCards: number[];
      };

      const cards = decoded.holeCards;
      if (!cards || cards[0] === 255 || cards[1] === 255) return null;

      return [decodeCardToString(cards[0]), decodeCardToString(cards[1])];
    } catch (err) {
      console.error(`[AnchorClient] Failed to read hole cards for ${playerWallet.toBase58()}:`, err);
      return null;
    }
  }

  // ─── ゲーム解決（resolve_game） ─────────────────────────────────────────────

  /**
   * ゲーム終了後にresolve_gameを呼び出し、勝者へのpayoutとプラットフォーム手数料を処理する。
   * L1上で実行（commit_game後に呼び出す）。
   */
  async resolveGame(
    gameId: bigint,
    winnerPubkey: PublicKey,
  ): Promise<{ payout: number; signature: string }> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [vaultPda] = this.deriveVaultPda(gameId);
    const [bettingPoolPda] = this.deriveBettingPoolPda(gameId);
    const operatorPubkey = this.operatorKeypair.publicKey;

    const txSig = await (this.l1Program.methods as unknown as {
      resolveGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .resolveGame(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        gameVault: vaultPda,
        winner: winnerPubkey,
        platformTreasury: PLATFORM_TREASURY,
        bettingPool: bettingPoolPda,
        operator: operatorPubkey,
      })
      .rpc();

    // Gameアカウントからbuy_inを読み取ってpayout計算（pot = buyIn * 2, fee = 2%, payout = pot - fee）
    const gameAccount = await this.l1Connection.getAccountInfo(gamePda, 'confirmed');
    let payout = 0;
    if (gameAccount) {
      // buy_in offset: 8 (discriminator) + 8 (game_id) + 32 (operator) + 32 (platform_treasury) + 32 (player1) + 32 (player2) = 144
      const buyIn = Number(gameAccount.data.readBigUInt64LE(144));
      const pot = buyIn * 2;
      const fee = Math.floor((pot * 2) / 100);
      payout = pot - fee;
    }

    console.log(`[AnchorClient] Game ${gameId} resolved. Winner: ${winnerPubkey.toBase58()}, payout: ${payout}, tx: ${txSig}`);
    return { payout, signature: txSig };
  }

  // ─── ゲーム一覧取得（IDL使用） ─────────────────────────────────────────────

  async getActiveGames(): Promise<ActiveGame[]> {
    try {
      // Anchor IDLを使ってGame accountsをデコード
      const accounts = await this.erConnection.getProgramAccounts(PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [{ dataSize: 8 + 350 }], // Game accountの概算サイズ
      });

      const games: ActiveGame[] = [];
      for (const account of accounts) {
        try {
          const data = account.account.data;
          if (data.length < 8 + 8) continue;

          // GameMonitorと同じバイナリデコードを使用（IDLデコードの代替）
          let offset = 8; // skip discriminator
          const gameId = data.readBigUInt64LE(offset);
          offset += 8;
          offset += 32; // operator
          offset += 32; // platform_treasury
          const player1 = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
          offset += 32;
          const player2 = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
          offset += 32;
          offset += 8; // buy_in
          const pot = Number(data.readBigUInt64LE(offset));
          offset += 8;
          offset += 32; // current_turn
          const phaseIndex = data.readUInt8(offset);
          offset += 1;

          const phases = ['Waiting', 'Shuffling', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown', 'Finished'];
          const phase = phases[phaseIndex] ?? 'Unknown';

          if (phase === 'Finished' || phase === 'Waiting') continue;

          offset += 5 + 32 + 8 + 8; // board_cards + deck_commitment + p1_committed + p2_committed
          const handNumber = Number(data.readBigUInt64LE(offset));

          games.push({
            gameId,
            gamePda: account.pubkey.toBase58(),
            player1,
            player2,
            phase,
            pot,
            handNumber,
          });
        } catch {
          continue;
        }
      }

      return games;
    } catch (err) {
      console.error('[AnchorClient] Failed to fetch active games:', err);
      return [];
    }
  }
}

/** card value 0-51 → "2C", "AS"等の文字列にデコード */
function decodeCardToString(cardValue: number): string {
  if (cardValue >= 52) return '??';
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['C', 'D', 'H', 'S'];
  const rank = ranks[cardValue % 13];
  const suit = suits[Math.floor(cardValue / 13)];
  return `${rank}${suit}`;
}
