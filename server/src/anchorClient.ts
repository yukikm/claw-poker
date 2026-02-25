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
import nacl from 'tweetnacl';
import { encode as encodeBase58 } from 'bs58';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require(path.join(__dirname, '../../app/lib/claw_poker_idl.json')) as Idl;

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');

const PLATFORM_TREASURY = new PublicKey(
  process.env.PLATFORM_TREASURY_PUBKEY ?? SystemProgram.programId.toBase58(),
);

/** MagicBlock Delegation Program ID */
const DELEGATION_PROG = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
/** MagicBlock Permission Program ID */
const PERMISSION_PROG = new PublicKey('PERMwfoGhaxc4V7SREhGEJrHjfMKMWBi9zfqRiAhmkd');
/** MagicBlock TEE Validator (Devnet). 環境変数 MAGICBLOCK_VALIDATOR で上書き可能 */
const VALIDATOR_PUBKEY = new PublicKey(
  process.env.MAGICBLOCK_VALIDATOR ?? 'FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA',
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

/** TEE認証トークンのキャッシュ（トークン再取得までのバッファ: 5分） */
interface TeeAuthCache {
  token: string;
  expiresAt: number;
  connection: Connection;
}

export class AnchorClient {
  private l1Connection: Connection;
  private erConnection: Connection;
  private operatorKeypair: Keypair;
  private l1Program: Program;
  private erProgram: Program;
  private teeRpcUrl: string | null;
  private teeWsUrl: string | null;
  private teeAuthCache: TeeAuthCache | null = null;

  constructor(rpcUrl: string, erRpcUrl: string) {
    this.l1Connection = new Connection(rpcUrl, 'confirmed');
    this.erConnection = new Connection(erRpcUrl, 'confirmed');

    const operatorPrivKey = process.env.OPERATOR_PRIVATE_KEY;
    if (!operatorPrivKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('OPERATOR_PRIVATE_KEY is required in production');
      }
      console.warn('⚠️  OPERATOR_PRIVATE_KEY not set, using ephemeral keypair (dev only)');
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
        } else {
          (tx as VersionedTransaction).sign([kp]);
        }
        return tx;
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
        txs.forEach((tx) => {
          if (tx instanceof Transaction) {
            tx.partialSign(kp);
          } else {
            (tx as VersionedTransaction).sign([kp]);
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

    // TEE RPC URL（Private Ephemeral Rollup用。未設定時はホールカード読み取りがERフォールバック）
    this.teeRpcUrl = process.env.MAGICBLOCK_TEE_RPC_URL ?? null;
    this.teeWsUrl = process.env.MAGICBLOCK_TEE_WS_URL ?? null;
    if (this.teeRpcUrl) {
      console.log('[AnchorClient] TEE RPC configured for private PlayerState access');
    } else {
      console.warn(
        '[AnchorClient] MAGICBLOCK_TEE_RPC_URL not set. ' +
        'Hole card reads will use ER connection (privacy not enforced).',
      );
    }
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

  /** Permission PDA: seeds = [b"permission", account_pubkey] under PERMISSION_PROG */
  private derivePermissionPda(account: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('permission'), account.toBuffer()],
      PERMISSION_PROG,
    )[0];
  }

  /** Delegation Buffer PDA: seeds = [b"buffer", account_pubkey] under DELEGATION_PROG */
  private deriveDelegationBuffer(account: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('buffer'), account.toBuffer()],
      DELEGATION_PROG,
    )[0];
  }

  /** Delegation Record PDA: seeds = [b"delegation-record", account_pubkey] under DELEGATION_PROG */
  private deriveDelegationRecord(account: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('delegation-record'), account.toBuffer()],
      DELEGATION_PROG,
    )[0];
  }

  /** Delegation Metadata PDA: seeds = [b"delegation-metadata", account_pubkey] under DELEGATION_PROG */
  private deriveDelegationMetadata(account: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('delegation-metadata'), account.toBuffer()],
      DELEGATION_PROG,
    )[0];
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
    await (this.l1Program.methods as unknown as {
      createGameVault: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .createGameVault(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        gameVault: vaultPda,
        operator: operatorPubkey,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 3: initialize_betting_pool（観戦者ベット受付用）
    const [bettingPoolPda] = this.deriveBettingPoolPda(gameId);
    await (this.l1Program.methods as unknown as {
      initializeBettingPool: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .initializeBettingPool(new BN(gameId.toString()))
      .accounts({
        bettingPool: bettingPoolPda,
        game: gamePda,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // ── MagicBlock Private ER 初期化フロー ──────────────────────────────────
    // Permission PDA 導出（Game + Player1State + Player2State 用）
    const permissionGame = this.derivePermissionPda(gamePda);
    const permissionP1   = this.derivePermissionPda(player1StatePda);
    const permissionP2   = this.derivePermissionPda(player2StatePda);

    // Step 4: create_permission_game（Game は public: members: None）
    await (this.l1Program.methods as unknown as {
      createPermissionGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .createPermissionGame(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        permission: permissionGame,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 5: create_permission_player1（player + operator を ACL に追加）
    await (this.l1Program.methods as unknown as {
      createPermissionPlayer1: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .createPermissionPlayer1(new BN(gameId.toString()))
      .accounts({
        playerState: player1StatePda,
        player: player1,
        permission: permissionP1,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
        game: gamePda,
      })
      .rpc();

    // Step 6: create_permission_player2
    await (this.l1Program.methods as unknown as {
      createPermissionPlayer2: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .createPermissionPlayer2(new BN(gameId.toString()))
      .accounts({
        playerState: player2StatePda,
        player: player2,
        permission: permissionP2,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
        game: gamePda,
      })
      .rpc();

    // Step 7: delegate_game（Game データアカウントを ER に委譲）
    await (this.l1Program.methods as unknown as {
      delegateGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .delegateGame(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        game: gamePda,
        ownerProgram: PROGRAM_ID,
        validator: VALIDATOR_PUBKEY,
        buffer: this.deriveDelegationBuffer(gamePda),
        delegationRecord: this.deriveDelegationRecord(gamePda),
        delegationMetadata: this.deriveDelegationMetadata(gamePda),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 8: delegate_player1（Player1State データアカウントを ER に委譲）
    await (this.l1Program.methods as unknown as {
      delegatePlayer1: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .delegatePlayer1(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        player: player1,
        playerState: player1StatePda,
        ownerProgram: PROGRAM_ID,
        validator: VALIDATOR_PUBKEY,
        buffer: this.deriveDelegationBuffer(player1StatePda),
        delegationRecord: this.deriveDelegationRecord(player1StatePda),
        delegationMetadata: this.deriveDelegationMetadata(player1StatePda),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 9: delegate_player2
    await (this.l1Program.methods as unknown as {
      delegatePlayer2: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .delegatePlayer2(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        player: player2,
        playerState: player2StatePda,
        ownerProgram: PROGRAM_ID,
        validator: VALIDATOR_PUBKEY,
        buffer: this.deriveDelegationBuffer(player2StatePda),
        delegationRecord: this.deriveDelegationRecord(player2StatePda),
        delegationMetadata: this.deriveDelegationMetadata(player2StatePda),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 10: delegate_permission_game（Game Permission PDA を ER に委譲）
    await (this.l1Program.methods as unknown as {
      delegatePermissionGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .delegatePermissionGame(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        game: gamePda,
        permission: permissionGame,
        permissionProgram: PERMISSION_PROG,
        validator: VALIDATOR_PUBKEY,
        delegationBuffer: this.deriveDelegationBuffer(permissionGame),
        delegationRecord: this.deriveDelegationRecord(permissionGame),
        delegationMetadata: this.deriveDelegationMetadata(permissionGame),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 11: delegate_permission_player1（Player1 Permission PDA を ER に委譲）
    await (this.l1Program.methods as unknown as {
      delegatePermissionPlayer1: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .delegatePermissionPlayer1(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        player: player1,
        playerState: player1StatePda,
        permission: permissionP1,
        permissionProgram: PERMISSION_PROG,
        validator: VALIDATOR_PUBKEY,
        delegationBuffer: this.deriveDelegationBuffer(permissionP1),
        delegationRecord: this.deriveDelegationRecord(permissionP1),
        delegationMetadata: this.deriveDelegationMetadata(permissionP1),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 12: delegate_permission_player2
    const txSig = await (this.l1Program.methods as unknown as {
      delegatePermissionPlayer2: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .delegatePermissionPlayer2(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        player: player2,
        playerState: player2StatePda,
        permission: permissionP2,
        permissionProgram: PERMISSION_PROG,
        validator: VALIDATOR_PUBKEY,
        delegationBuffer: this.deriveDelegationBuffer(permissionP2),
        delegationRecord: this.deriveDelegationRecord(permissionP2),
        delegationMetadata: this.deriveDelegationMetadata(permissionP2),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`[AnchorClient] Game ${gameId} initialized with full Private ER delegation: gamePda=${gamePda.toBase58()}`);
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
   * leave_matchmaking_queue を呼び出してキューからプレイヤーエントリーを削除する。
   * enter_matchmaking_queueと同様にoperatorが代理で呼び出す（playerはSignerではない）。
   * 参加費の返金はx402プロトコル側で処理されるため、このメソッドはキュー削除のみを行う。
   */
  async leaveMatchmakingQueue(playerWallet: PublicKey): Promise<string> {
    const [queuePda] = this.deriveMatchmakingQueuePda();
    const operatorPubkey = this.operatorKeypair.publicKey;

    const txSig = await (this.l1Program.methods as unknown as {
      leaveMatchmakingQueue: () => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .leaveMatchmakingQueue()
      .accounts({
        matchmakingQueue: queuePda,
        player: playerWallet,
        operator: operatorPubkey,
      })
      .rpc();

    console.log(`[AnchorClient] Player ${playerWallet.toBase58()} removed from queue, tx: ${txSig}`);
    return txSig;
  }

  /**
   * x402支払い後にキュー登録が失敗した場合、オペレーターウォレットからプレイヤーにSOLを返金する。
   * オペレーターが直接SOL転送を行う。
   */
  async refundEntryFee(playerPubkey: PublicKey, lamports: bigint): Promise<void> {
    const { blockhash } = await this.l1Connection.getLatestBlockhash();
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: this.operatorKeypair.publicKey,
    });
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: this.operatorKeypair.publicKey,
        toPubkey: playerPubkey,
        lamports: Number(lamports),
      }),
    );
    transaction.sign(this.operatorKeypair);
    const sig = await this.l1Connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
    });
    await this.l1Connection.confirmTransaction(sig, 'confirmed');
    console.log(`[AnchorClient] Refunded ${lamports} lamports to ${playerPubkey.toBase58()}: ${sig}`);
  }

  /**
   * 30秒アクションタイムアウト時にhandle_timeout命令を呼び出す。
   * ER上で実行し、タイムアウトしたプレイヤーのPlayerStateを更新する。
   */
  async handleTimeout(gameId: bigint, timedOutPlayerWallet: PublicKey): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [playerStatePda] = this.derivePlayerStatePda(gameId, timedOutPlayerWallet);
    const operatorPubkey = this.operatorKeypair.publicKey;

    const txSig = await (this.erProgram.methods as unknown as {
      handleTimeout: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .handleTimeout(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        timedOutPlayerState: playerStatePda,
        operator: operatorPubkey,
      })
      .rpc();

    console.log(`[AnchorClient] Timeout handled for game ${gameId}, player ${timedOutPlayerWallet.toBase58()}: ${txSig}`);
    return txSig;
  }

  /**
   * x402支払い検証後にオペレーターが呼び出すキュー登録命令。
   * SOL転送はx402プロトコルが担当し、このメソッドはキュー登録のみ行う。
   */
  async enterMatchmakingQueue(playerPubkey: PublicKey, entryFeeLamports: bigint): Promise<void> {
    const [queuePda] = this.deriveMatchmakingQueuePda();
    const operatorPubkey = this.operatorKeypair.publicKey;

    await (this.l1Program.methods as unknown as {
      enterMatchmakingQueue: (entryFee: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .enterMatchmakingQueue(new BN(entryFeeLamports.toString()))
      .accounts({
        matchmakingQueue: queuePda,
        player: playerPubkey,
        operator: operatorPubkey,
      })
      .rpc();

    console.log(`[AnchorClient] Player ${playerPubkey.toBase58()} entered queue, fee: ${entryFeeLamports} lamports`);
  }

  // ─── チェックポイントコミット ──────────────────────────────────────────────

  /**
   * 50ハンドチェックポイントでER上の状態をL1にコミットする。
   * commit_game命令をphase==Waitingの状態で呼び出す（中間チェックポイント）。
   */
  async commitGameCheckpoint(gameId: bigint): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const operatorPubkey = this.operatorKeypair.publicKey;

    // ER上のGameアカウントからplayer1/player2を読み取る
    const gameAccount = await this.erConnection.getAccountInfo(gamePda, 'confirmed');
    if (!gameAccount) {
      throw new Error(`Game account not found for gameId ${gameId}`);
    }

    // M-x402-2と同様にIDLのcoder.accounts.decodeで動的にデコードし、バイナリオフセットのハードコードを排除
    const decodedGame = this.erProgram.coder.accounts.decode('Game', gameAccount.data) as {
      player1: PublicKey;
      player2: PublicKey;
    };
    const player1 = decodedGame.player1;
    const player2 = decodedGame.player2;

    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2);

    // Permission PDA導出（クラス定数のPERMISSION_PROGを使用）
    const permissionP1   = this.derivePermissionPda(player1StatePda);
    const permissionP2   = this.derivePermissionPda(player2StatePda);
    const permissionGame = this.derivePermissionPda(gamePda);

    const txSig = await (this.erProgram.methods as unknown as {
      commitGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .commitGame(new BN(gameId.toString()))
      .accounts({
        payer: operatorPubkey,
        operator: operatorPubkey,
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        permissionP1: permissionP1,
        permissionP2: permissionP2,
        permissionGame: permissionGame,
        permissionProgram: PERMISSION_PROG,
      })
      .rpc();

    console.log(`[AnchorClient] Checkpoint commit for game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * ER上のGameアカウントから現在のpotとプレイヤーチップスタックを取得する。
   * submitPlayerAction後の正確な状態をaction_accepted/opponent_actionメッセージに使用する。
   */
  async fetchGamePotAndStacks(gameId: bigint): Promise<{ pot: number; player1ChipStack: number; player2ChipStack: number } | null> {
    try {
      const [gamePda] = this.deriveGamePda(gameId);
      const accountInfo = await this.erConnection.getAccountInfo(gamePda, 'confirmed');
      if (!accountInfo) return null;

      const decoded = this.erProgram.coder.accounts.decode('Game', accountInfo.data) as {
        pot: { toNumber: () => number };
        player1ChipStack?: { toNumber: () => number };
        player2ChipStack?: { toNumber: () => number };
      };

      return {
        pot: decoded.pot.toNumber(),
        player1ChipStack: decoded.player1ChipStack?.toNumber() ?? 0,
        player2ChipStack: decoded.player2ChipStack?.toNumber() ?? 0,
      };
    } catch (err) {
      console.warn(`[AnchorClient] Failed to fetch game state for ${gameId}:`, err);
      return null;
    }
  }

  // ─── TEE認証 ────────────────────────────────────────────────────────────

  /** TEE認証トークンの有効期限バッファ（5分前に再取得） */
  private static readonly TEE_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

  /**
   * TEE認証済みConnectionを取得する。
   * operatorKeypairでチャレンジに署名してTEE RPCの認証トークンを取得し、
   * トークン付きURLでConnectionを作成する。トークンはキャッシュされ、
   * 有効期限の5分前に自動的に再取得される。
   *
   * TEE RPC URLが未設定の場合はnullを返す。
   */
  private async getTeeConnection(): Promise<Connection | null> {
    if (!this.teeRpcUrl) return null;

    // キャッシュが有効ならそのまま返す
    if (
      this.teeAuthCache &&
      this.teeAuthCache.expiresAt > Date.now() + AnchorClient.TEE_TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.teeAuthCache.connection;
    }

    // TEE RPCにチャレンジを要求
    const challengeRes = await fetch(
      `${this.teeRpcUrl}/auth/challenge?pubkey=${this.operatorKeypair.publicKey.toString()}`,
    );
    const challengeJson = await challengeRes.json() as { challenge?: string; error?: string };
    if (challengeJson.error) {
      throw new Error(`TEE challenge failed: ${challengeJson.error}`);
    }
    if (!challengeJson.challenge) {
      throw new Error('TEE challenge: no challenge received');
    }

    // operatorKeypairでチャレンジに署名（ed25519 detached signature）
    const challengeBytes = new Uint8Array(Buffer.from(challengeJson.challenge, 'utf-8'));
    const signature = nacl.sign.detached(challengeBytes, this.operatorKeypair.secretKey);
    const signatureBase58 = encodeBase58(signature);

    // 認証トークンを取得
    const authRes = await fetch(`${this.teeRpcUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pubkey: this.operatorKeypair.publicKey.toString(),
        challenge: challengeJson.challenge,
        signature: signatureBase58,
      }),
    });
    const authJson = await authRes.json() as { token?: string; expiresAt?: number; error?: string };
    if (authRes.status !== 200 || !authJson.token) {
      throw new Error(`TEE auth failed: ${authJson.error ?? 'no token received'}`);
    }

    // 30日デフォルト有効期限（MagicBlock SDK SESSION_DURATION準拠）
    const expiresAt = authJson.expiresAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000;

    const teeConnection = new Connection(
      `${this.teeRpcUrl}?token=${authJson.token}`,
      {
        commitment: 'processed',
        wsEndpoint: this.teeWsUrl ? `${this.teeWsUrl}?token=${authJson.token}` : undefined,
      },
    );

    this.teeAuthCache = { token: authJson.token, expiresAt, connection: teeConnection };
    console.log('[AnchorClient] TEE auth token acquired, expires:', new Date(expiresAt).toISOString());
    return teeConnection;
  }

  // ─── PlayerState読み取り ───────────────────────────────────────────────────

  /**
   * PlayerStateアカウントからホールカードを読み取る。
   *
   * MagicBlock Private Ephemeral Rollupでは、PlayerStateがPERにデリゲートされると
   * ホールカードデータはTEE内で暗号化され、通常のER RPCでは読み取れない。
   * TEE認証済みコネクション（operatorKeypairで認証）経由でのみアクセス可能。
   *
   * MAGICBLOCK_TEE_RPC_URL が設定されている場合はTEEコネクションを使用し、
   * 未設定の場合はERコネクションにフォールバックする（開発環境向け）。
   */
  async getPlayerHoleCards(
    gameId: bigint,
    playerWallet: PublicKey,
  ): Promise<[string, string] | null> {
    try {
      const [playerStatePda] = this.derivePlayerStatePda(gameId, playerWallet);

      // TEE認証済みコネクションを優先使用。未設定時はERフォールバック。
      let connection: Connection;
      try {
        const teeConn = await this.getTeeConnection();
        connection = teeConn ?? this.erConnection;
      } catch (teeErr) {
        console.warn('[AnchorClient] TEE auth failed, falling back to ER connection:', teeErr);
        connection = this.erConnection;
      }

      const accountInfo = await connection.getAccountInfo(playerStatePda, 'confirmed');
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
  ): Promise<{ payout: number; fee: number; signature: string }> {
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
    let fee = 0;
    if (gameAccount) {
      // M-x402-2: IDLのcoder.accounts.decodeで動的にデコードし、バイナリオフセットのハードコードを排除
      const decoded = this.l1Program.coder.accounts.decode('Game', gameAccount.data) as {
        buyIn: { toNumber?: () => number; toString: () => string };
      };
      const buyIn = typeof decoded.buyIn.toNumber === 'function'
        ? decoded.buyIn.toNumber()
        : Number(decoded.buyIn.toString());
      const pot = buyIn * 2;
      fee = Math.floor((pot * 2) / 100);
      payout = pot - fee;
    }

    console.log(`[AnchorClient] Game ${gameId} resolved. Winner: ${winnerPubkey.toBase58()}, payout: ${payout}, fee: ${fee}, tx: ${txSig}`);
    return { payout, fee, signature: txSig };
  }

  // ─── ゲーム一覧取得（IDL使用） ─────────────────────────────────────────────

  async getActiveGames(): Promise<ActiveGame[]> {
    try {
      // Game accountのdiscriminatorでフィルタリング（base58エンコード済み）
      const GAME_DISCRIMINATOR_BASE58 = '5aNQXizG8jB';
      const accounts = await this.erConnection.getProgramAccounts(PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          { memcmp: { offset: 0, bytes: GAME_DISCRIMINATOR_BASE58 } },
        ],
      });

      const phases = ['Waiting', 'Shuffling', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown', 'Finished'];
      const games: ActiveGame[] = [];

      for (const account of accounts) {
        try {
          const decoded = this.erProgram.coder.accounts.decode('Game', account.account.data) as {
            gameId: { toNumber?: () => number; toString: () => string };
            player1: PublicKey;
            player2: PublicKey;
            phase: Record<string, unknown>;
            pot: { toNumber?: () => number };
            handNumber: { toNumber?: () => number };
          };

          // Anchorのenum decode結果は { variantName: {} } 形式
          const phaseKey = Object.keys(decoded.phase)[0] ?? 'unknown';
          // camelCase→PascalCase変換（例: preFlop → PreFlop）
          const phase = phaseKey.charAt(0).toUpperCase() + phaseKey.slice(1);

          if (phase === 'Finished' || phase === 'Waiting') continue;

          // phases配列に含まれるかで正当性チェック
          const normalizedPhase = phases.includes(phase) ? phase : 'Unknown';

          const gameId = typeof decoded.gameId.toNumber === 'function'
            ? BigInt(decoded.gameId.toNumber())
            : BigInt(decoded.gameId.toString());
          const pot = typeof decoded.pot.toNumber === 'function'
            ? decoded.pot.toNumber()
            : Number(decoded.pot.toString());
          const handNumber = typeof decoded.handNumber.toNumber === 'function'
            ? decoded.handNumber.toNumber()
            : Number(decoded.handNumber.toString());

          games.push({
            gameId,
            gamePda: account.pubkey.toBase58(),
            player1: decoded.player1.toBase58(),
            player2: decoded.player2.toBase58(),
            phase: normalizedPhase,
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
  const suits = ['S', 'H', 'D', 'C'];
  const rank = ranks[cardValue % 13];
  const suit = suits[Math.floor(cardValue / 13)];
  return `${rank}${suit}`;
}
