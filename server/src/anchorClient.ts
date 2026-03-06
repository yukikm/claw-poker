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
import bs58 from 'bs58';
import { randomBytes } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require(path.join(__dirname, '../../app/lib/claw_poker_idl.json')) as Idl;

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');

const PLATFORM_TREASURY = new PublicKey(
  process.env.PLATFORM_TREASURY_PUBKEY ?? SystemProgram.programId.toBase58(),
);

/** MagicBlock Delegation Program ID */
const DELEGATION_PROG = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
/** MagicBlock Permission Program ID */
const PERMISSION_PROG = new PublicKey(
  process.env.MAGICBLOCK_PERMISSION_PROGRAM_ID ?? 'ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1',
);
/** MagicBlock TEE Validator (Devnet). 環境変数 MAGICBLOCK_VALIDATOR で上書き可能 */
const VALIDATOR_PUBKEY = new PublicKey(
  process.env.MAGICBLOCK_VALIDATOR ?? 'FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA',
);
/** ephemeral-vrf-sdk::consts::DEFAULT_EPHEMERAL_QUEUE（PER内実行用） */
const DEFAULT_ORACLE_QUEUE = new PublicKey(
  process.env.MAGICBLOCK_ORACLE_QUEUE ?? '5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc',
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


/** 有効なアクションの集合（ランタイム検証用） */
const VALID_ACTIONS: ReadonlySet<string> = new Set<ActionType>([
  'fold', 'check', 'call', 'bet', 'raise', 'all_in',
]);

/** Anchor VariantオブジェクトにPlayerActionを変換 */
function toAnchorAction(action: ActionType): Record<string, Record<string, never>> {
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`Unknown action '${String(action)}'`);
  }
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

interface TeeChallengeResponse {
  challenge?: string;
  error?: string;
}

interface TeeLoginResponse {
  token?: string;
  expiresAt?: number;
  error?: string;
}

export class AnchorClient {
  private l1Connection: Connection;
  private erConnection: Connection;
  private operatorKeypair: Keypair;
  private l1Program: Program;
  private erProgram: Program;
  private teeRpcUrl: string | null;
  private teeWsUrl: string | null;
  /** オペレーター用TEEトークンキャッシュ */
  private teeAuthCache: TeeAuthCache | null = null;
  /** プレイヤー別TEE接続キャッシュ（pubkey.toString() → Connection） */
  private playerTeeConnections = new Map<string, { token: string; expiresAt: number; connection: Connection }>();
  /** getActiveErProgram用キャッシュ（オペレータートークンが変わったら再生成） */
  private cachedTeeProgram: { program: Program; token: string } | null = null;
  /** TEE認証トークンの有効期限バッファ（5分前に再取得） */
  private static readonly TEE_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
  private static readonly TEE_DEFAULT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
  private static readonly DEVNET_TEE_FALLBACK_HOST = 'devnet-tee.magicblock.app';
  private static readonly TEE_PRIMARY_HOST = 'tee.magicblock.app';
  private readonly allowDevnetTeeFallback: boolean;

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

    const l1Provider = new AnchorProvider(this.l1Connection, this.makeWallet(this.operatorKeypair), {
      commitment: 'confirmed',
    });
    // erProvider は公開ER用（skipPreflight: true でシミュレーション回避）
    const erProvider = new AnchorProvider(this.erConnection, this.makeWallet(this.operatorKeypair), {
      commitment: 'confirmed',
      skipPreflight: true,
    });

    this.l1Program = new Program(IDL, l1Provider);
    this.erProgram = new Program(IDL, erProvider);

    this.allowDevnetTeeFallback = (process.env.MAGICBLOCK_ENABLE_DEVNET_TEE_FALLBACK ?? '').toLowerCase() === 'true';

    // TEE RPC URL（Private Ephemeral Rollup用。未設定時はホールカード読み取りがERフォールバック）
    const rawTeeRpcUrl = process.env.MAGICBLOCK_TEE_RPC_URL;
    const rawTeeWsUrl = process.env.MAGICBLOCK_TEE_WS_URL;
    this.teeRpcUrl = rawTeeRpcUrl
      ? AnchorClient.sanitizeEndpoint(rawTeeRpcUrl, 'MAGICBLOCK_TEE_RPC_URL', 'rpc')
      : null;
    this.teeWsUrl = rawTeeWsUrl
      ? AnchorClient.sanitizeEndpoint(rawTeeWsUrl, 'MAGICBLOCK_TEE_WS_URL', 'ws')
      : null;
    if (this.teeRpcUrl) {
      console.log(`[AnchorClient] TEE RPC configured: ${this.teeRpcUrl}`);
      if (this.allowDevnetTeeFallback) {
        console.log('[AnchorClient] Devnet TEE fallback is enabled (MAGICBLOCK_ENABLE_DEVNET_TEE_FALLBACK=true)');
      }
    } else {
      console.warn(
        '[AnchorClient] MAGICBLOCK_TEE_RPC_URL not set. ' +
        'Hole card reads will use ER connection (privacy not enforced).',
      );
    }
  }

  private static sanitizeEndpoint(
    rawUrl: string,
    envKey: string,
    type: 'rpc' | 'ws',
  ): string {
    const cleaned = rawUrl.trim().replace(/^['"]+|['"]+$/g, '');
    if (!cleaned) {
      throw new Error(`${envKey} is empty`);
    }

    let parsed: URL;
    try {
      parsed = new URL(cleaned);
    } catch {
      throw new Error(`${envKey} must be a valid URL. Received: ${rawUrl}`);
    }

    if (type === 'rpc') {
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${envKey} must use http(s) or ws(s). Received: ${rawUrl}`);
      }
    } else {
      if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
      if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        throw new Error(`${envKey} must use ws(s) or http(s). Received: ${rawUrl}`);
      }
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  }

  private buildTeeRpcUrl(pathname = '', token?: string, rpcBase?: string): string {
    const base = rpcBase ?? this.teeRpcUrl;
    if (!base) {
      throw new Error('MAGICBLOCK_TEE_RPC_URL is not configured');
    }
    const url = new URL(base);
    if (pathname) {
      const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
      url.pathname = `${url.pathname.replace(/\/+$/, '')}${normalizedPath}`;
      url.search = '';
    } else {
      url.search = '';
    }
    if (token) {
      url.searchParams.set('token', token);
    }
    return url.toString();
  }

  private getDevnetTeeFallbackRpcBase(): string | null {
    if (!this.allowDevnetTeeFallback) return null;
    if (!this.teeRpcUrl) return null;
    const current = new URL(this.teeRpcUrl);
    if (current.hostname !== AnchorClient.TEE_PRIMARY_HOST) return null;
    current.hostname = AnchorClient.DEVNET_TEE_FALLBACK_HOST;
    current.search = '';
    current.hash = '';
    return current.toString().replace(/\/$/, '');
  }

  private shouldFallbackToDevnetTee(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (!lower.includes('http 403')) return false;
    return lower.includes('access restricted')
      || lower.includes('<!doctype html')
      || lower.includes('<html');
  }

  private activateTeeFallbackEndpoint(nextRpcBase: string): void {
    const previousRpcBase = this.teeRpcUrl;
    if (!previousRpcBase || previousRpcBase === nextRpcBase) return;

    let nextWsBase = this.teeWsUrl;
    try {
      if (nextWsBase) {
        const previousWsUrl = new URL(nextWsBase);
        const previousRpcUrl = new URL(previousRpcBase);
        const nextRpcUrl = new URL(nextRpcBase);
        if (previousWsUrl.hostname === previousRpcUrl.hostname) {
          previousWsUrl.hostname = nextRpcUrl.hostname;
          previousWsUrl.search = '';
          previousWsUrl.hash = '';
          nextWsBase = previousWsUrl.toString().replace(/\/$/, '');
        }
      }
    } catch {
      // ignore ws parse errors and keep original ws endpoint
    }

    this.teeRpcUrl = nextRpcBase;
    this.teeWsUrl = nextWsBase;
    this.teeAuthCache = null;
    this.cachedTeeProgram = null;
    this.playerTeeConnections.clear();
    console.warn(
      `[AnchorClient] Switched TEE endpoint to ${nextRpcBase} ` +
      `(fallback from ${previousRpcBase} after access restriction)`,
    );
  }

  private buildTeeWsUrl(token: string): string | undefined {
    const wsBase = this.teeWsUrl
      ?? (this.teeRpcUrl
        ? this.teeRpcUrl
          .replace(/^https:/, 'wss:')
          .replace(/^http:/, 'ws:')
        : null);
    if (!wsBase) return undefined;
    const url = new URL(wsBase);
    url.search = '';
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async fetchTeeJson<T extends object>(
    url: string,
    init: RequestInit,
    context: string,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');

    const response = await fetch(url, { ...init, headers });
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    const server = response.headers.get('server') ?? '-';
    const cfRay = response.headers.get('cf-ray') ?? '-';

    if (!response.ok) {
      throw new Error(
        `${context} HTTP ${response.status} (${url}) ` +
        `[server=${server} cf-ray=${cfRay}]: ${body.slice(0, 200)}`,
      );
    }
    if (!contentType.includes('application/json')) {
      throw new Error(
        `${context} returned non-JSON (${contentType}) (${url}): ${body.slice(0, 200)}`,
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`${context} returned invalid JSON (${url}): ${body.slice(0, 200)}`);
    }
  }

  private async requestTeeChallenge(pubkey: PublicKey): Promise<string> {
    const challengeUrl = new URL(this.buildTeeRpcUrl('/auth/challenge'));
    challengeUrl.searchParams.set('pubkey', pubkey.toBase58());
    let challengeJson: TeeChallengeResponse;
    try {
      challengeJson = await this.fetchTeeJson<TeeChallengeResponse>(
        challengeUrl.toString(),
        { method: 'GET' },
        'TEE challenge',
      );
    } catch (primaryError) {
      const fallbackBase = this.getDevnetTeeFallbackRpcBase();
      if (!fallbackBase || !this.shouldFallbackToDevnetTee(primaryError)) {
        throw primaryError;
      }
      const fallbackChallengeUrl = new URL(this.buildTeeRpcUrl('/auth/challenge', undefined, fallbackBase));
      fallbackChallengeUrl.searchParams.set('pubkey', pubkey.toBase58());
      challengeJson = await this.fetchTeeJson<TeeChallengeResponse>(
        fallbackChallengeUrl.toString(),
        { method: 'GET' },
        'TEE challenge (devnet fallback)',
      );
      this.activateTeeFallbackEndpoint(fallbackBase);
    }
    if (challengeJson.error) {
      throw new Error(`TEE challenge failed: ${challengeJson.error}`);
    }
    if (!challengeJson.challenge) {
      throw new Error('TEE challenge failed: no challenge received');
    }
    return challengeJson.challenge;
  }

  private async requestTeeLogin(
    pubkey: PublicKey,
    challenge: string,
    signatureBase58: string,
  ): Promise<{ token: string; expiresAt: number }> {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pubkey: pubkey.toBase58(),
        challenge,
        signature: signatureBase58,
      }),
    };

    let loginJson: TeeLoginResponse;
    try {
      loginJson = await this.fetchTeeJson<TeeLoginResponse>(
        this.buildTeeRpcUrl('/auth/login'),
        requestInit,
        'TEE login',
      );
    } catch (primaryError) {
      const fallbackBase = this.getDevnetTeeFallbackRpcBase();
      if (!fallbackBase || !this.shouldFallbackToDevnetTee(primaryError)) {
        throw primaryError;
      }
      loginJson = await this.fetchTeeJson<TeeLoginResponse>(
        this.buildTeeRpcUrl('/auth/login', undefined, fallbackBase),
        requestInit,
        'TEE login (devnet fallback)',
      );
      this.activateTeeFallbackEndpoint(fallbackBase);
    }
    if (!loginJson.token) {
      throw new Error(`TEE login failed: ${loginJson.error ?? 'no token received'}`);
    }
    return {
      token: loginJson.token,
      expiresAt: loginJson.expiresAt ?? Date.now() + AnchorClient.TEE_DEFAULT_SESSION_MS,
    };
  }

  /** AnchorProvider用Walletを生成する（クラスメソッド化でTEEプログラム生成にも再利用） */
  private makeWallet(kp: Keypair): Wallet {
    return {
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
    };
  }

  getL1Connection(): Connection {
    return this.l1Connection;
  }

  getERConnection(): Connection {
    return this.erConnection;
  }

  /**
   * 読み取り用の最適な接続を返す。
   * Private ER委譲後はアカウントがTEE上にのみ存在するため、TEE接続を返す。
   * TEE接続が取得できない場合はnullを返す（公開ERにはアカウントが存在しない）。
   * TEE RPC URLが未設定の場合のみ公開ERを返す（開発環境向け）。
   */
  async getReadConnection(): Promise<Connection | null> {
    if (!this.teeRpcUrl) return this.erConnection;
    const teeConn = await this.getTeeConnection();
    return teeConn;
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

  /** Permission PDA: seeds = [b"permission:", account_pubkey] under PERMISSION_PROG */
  private derivePermissionPda(account: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('permission:'), account.toBuffer()],
      PERMISSION_PROG,
    )[0];
  }

  /**
   * Delegation Buffer PDA: seeds = [b"buffer", account_pubkey] under ownerProgramId.
   * - claw-poker PDAs (game, player_state): ownerProgramId = PROGRAM_ID (default)
   * - permission PDAs: ownerProgramId = PERMISSION_PROG
   */
  private deriveDelegationBuffer(account: PublicKey, ownerProgramId: PublicKey = PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('buffer'), account.toBuffer()],
      ownerProgramId,
    )[0];
  }

  /** Delegation Record PDA: seeds = [b"delegation", account_pubkey] under DELEGATION_PROG */
  private deriveDelegationRecord(account: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('delegation'), account.toBuffer()],
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
        permissionProgram: PERMISSION_PROG,
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
        permissionProgram: PERMISSION_PROG,
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
        permissionProgram: PERMISSION_PROG,
        payer: operatorPubkey,
        systemProgram: SystemProgram.programId,
        game: gamePda,
      })
      .rpc();

    // Step 7: delegate_permission_game（Game Permission PDA を ER に委譲）
    // ※ Permission委譲は account委譲より先に実行する必要がある。
    //   account委譲後はgame/player_stateオーナーがDELEGATION_PROGに変わり、
    //   Anchorのアカウント型チェックが失敗するため。
    // ※ Permission PDAのバッファはowner_program = PERMISSION_PROGで導出する。
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
        delegationBuffer: this.deriveDelegationBuffer(permissionGame, PERMISSION_PROG),
        delegationRecord: this.deriveDelegationRecord(permissionGame),
        delegationMetadata: this.deriveDelegationMetadata(permissionGame),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 8: delegate_permission_player1（Player1 Permission PDA を ER に委譲）
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
        delegationBuffer: this.deriveDelegationBuffer(permissionP1, PERMISSION_PROG),
        delegationRecord: this.deriveDelegationRecord(permissionP1),
        delegationMetadata: this.deriveDelegationMetadata(permissionP1),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 9: delegate_permission_player2
    await (this.l1Program.methods as unknown as {
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
        delegationBuffer: this.deriveDelegationBuffer(permissionP2, PERMISSION_PROG),
        delegationRecord: this.deriveDelegationRecord(permissionP2),
        delegationMetadata: this.deriveDelegationMetadata(permissionP2),
        delegationProgram: DELEGATION_PROG,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Step 10: delegate_game（Game データアカウントを ER に委譲）
    // ※ Permission委譲完了後にアカウント委譲を実行する
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

    // Step 11: delegate_player1（Player1State データアカウントを ER に委譲）
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

    // Step 12: delegate_player2
    const txSig = await (this.l1Program.methods as unknown as {
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
    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      playerAction: (
        gameId: BN,
        action: Record<string, Record<string, never>>,
        amount: BN | null,
      ) => {
        accounts: (a: Record<string, PublicKey>) => {
          transaction: () => Promise<Transaction>;
        };
      };
    })
      .playerAction(new BN(gameId.toString()), toAnchorAction(action), anchorAmount)
      .accounts({
        game: gamePda,
        playerState: playerStatePda,
        player: playerWallet,
        operator: operatorPubkey,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Action ${action} for ${playerWallet.toBase58()} in game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * Waiting状態のゲームでディーラーボタンを進め、次ハンドの準備を行う。
   */
  async startNewHand(gameId: bigint): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const operatorPubkey = this.operatorKeypair.publicKey;
    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      startNewHand: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .startNewHand(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        operator: operatorPubkey,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Started new hand for game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * VRFシャッフルを要求し、Shufflingフェーズに遷移する。hand_numberをインクリメントする。
   * Private ERではVRFオラクルがcallbackを配信できないため、
   * 呼び出し後に即座にfallbackShuffleAndDealを実行する。
   */
  async requestShuffle(
    gameId: bigint,
    player1Wallet: PublicKey,
    player2Wallet: PublicKey,
    clientSeed: number,
  ): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1Wallet);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2Wallet);
    const operatorPubkey = this.operatorKeypair.publicKey;
    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      requestShuffle: (gameId: BN, clientSeed: number) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .requestShuffle(new BN(gameId.toString()), clientSeed)
      .accounts({
        game: gamePda,
        operator: operatorPubkey,
        player1State: player1StatePda,
        player2State: player2StatePda,
        oracleQueue: DEFAULT_ORACLE_QUEUE,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Requested shuffle for game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * request_shuffle後またはWaitingフェーズからデッキシャッフルとホールカード配布を実行する。
   * サーバー側で暗号学的乱数を生成し、test_shuffle_and_deal命令を直接呼び出す。
   * フェーズがShuffling（requestShuffle実行済み）またはWaiting（Private ERでVRF不可）の場合に使用可能。
   * Waitingからの呼び出し時はhand_numberがオンチェーンで自動インクリメントされる。
   */
  async fallbackShuffleAndDeal(
    gameId: bigint,
    player1Wallet: PublicKey,
    player2Wallet: PublicKey,
  ): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1Wallet);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2Wallet);
    const operatorPubkey = this.operatorKeypair.publicKey;
    const activeProgram = await this.getActiveErProgram();

    // 暗号学的安全な32バイト乱数を生成
    const randomSeed = [...randomBytes(32)];

    const tx = await (activeProgram.methods as unknown as {
      testShuffleAndDeal: (gameId: BN, randomSeed: number[]) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .testShuffleAndDeal(new BN(gameId.toString()), randomSeed)
      .accounts({
        game: gamePda,
        operator: operatorPubkey,
        player1State: player1StatePda,
        player2State: player2StatePda,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Fallback shuffle completed for game ${gameId}: ${txSig}`);
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
   * Waitingフェーズのゲームをキャンセルし、Vault内の資金を両プレイヤーに返金する。
   * TEE delegation失敗やサーバークラッシュで停止したゲームのクリーンアップ用。
   */
  async cancelGame(gameId: bigint, player1: PublicKey, player2: PublicKey): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [vaultPda] = this.deriveVaultPda(gameId);
    const [bettingPoolPda] = this.deriveBettingPoolPda(gameId);
    const operatorPubkey = this.operatorKeypair.publicKey;

    const txSig = await (this.l1Program.methods as unknown as {
      cancelGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .cancelGame(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        gameVault: vaultPda,
        player1,
        player2,
        bettingPool: bettingPoolPda,
        operator: operatorPubkey,
      })
      .rpc();

    console.log(`[AnchorClient] Game ${gameId} cancelled, refund tx: ${txSig}`);
    return txSig;
  }

  /**
   * 30秒アクションタイムアウト時にhandle_timeout命令を呼び出す。
   * ER上で実行し、タイムアウトしたプレイヤーのPlayerStateを更新する。
   */
  async handleTimeout(gameId: bigint, timedOutPlayerWallet: PublicKey): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [playerStatePda] = this.derivePlayerStatePda(gameId, timedOutPlayerWallet);
    const operatorPubkey = this.operatorKeypair.publicKey;

    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      handleTimeout: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .handleTimeout(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        timedOutPlayerState: playerStatePda,
        operator: operatorPubkey,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Timeout handled for game ${gameId}, player ${timedOutPlayerWallet.toBase58()}: ${txSig}`);
    return txSig;
  }

  // ─── ハンド決着・コミュニティカード公開・ショーダウン公開 ─────────────────

  /**
   * settle_hand命令を呼び出してハンドを決着させる。
   * Fold後、Showdown後、AllInランアウト後に呼ぶ。
   */
  async settleHand(gameId: bigint, player1Wallet: PublicKey, player2Wallet: PublicKey): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1Wallet);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2Wallet);
    const operatorPubkey = this.operatorKeypair.publicKey;
    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      settleHand: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .settleHand(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        operator: operatorPubkey,
        player1State: player1StatePda,
        player2State: player2StatePda,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Hand settled for game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * reveal_community_cards命令を呼び出してコミュニティカードを公開する。
   * ベッティングラウンド終了後にFlop/Turn/Riverを段階的に公開する。
   */
  async revealCommunityCards(
    gameId: bigint,
    player1Wallet: PublicKey,
    player2Wallet: PublicKey,
    targetPhase: number,
    boardCards: number[],
  ): Promise<string> {
    if (boardCards.length === 0 || boardCards.some(c => c === undefined || c === null || c < 0 || c > 51)) {
      throw new Error(`[revealCommunityCards] Invalid boardCards for game ${gameId}: ${JSON.stringify(boardCards)}`);
    }
    const [gamePda] = this.deriveGamePda(gameId);
    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1Wallet);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2Wallet);
    const operatorPubkey = this.operatorKeypair.publicKey;
    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      revealCommunityCards: (gameId: BN, phase: Record<string, unknown>, boardCards: Buffer) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .revealCommunityCards(
        new BN(gameId.toString()),
        this.encodeGamePhase(targetPhase),
        Buffer.from(boardCards),
      )
      .accounts({
        game: gamePda,
        operator: operatorPubkey,
        player1State: player1StatePda,
        player2State: player2StatePda,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Community cards revealed for game ${gameId}, phase ${targetPhase}: ${txSig}`);
    return txSig;
  }

  /**
   * reveal_showdown_cards命令を呼び出してショーダウン時のホールカードをGameに公開コピーする。
   */
  async revealShowdownCards(
    gameId: bigint,
    player1Wallet: PublicKey,
    player2Wallet: PublicKey,
  ): Promise<string> {
    const [gamePda] = this.deriveGamePda(gameId);
    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1Wallet);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2Wallet);
    const operatorPubkey = this.operatorKeypair.publicKey;
    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      revealShowdownCards: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
      };
    })
      .revealShowdownCards(new BN(gameId.toString()))
      .accounts({
        game: gamePda,
        operator: operatorPubkey,
        player1State: player1StatePda,
        player2State: player2StatePda,
      })
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Showdown cards revealed for game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * GamePhaseインデックスをAnchorのenum表現に変換する。
   * Anchor IDLではenumは { variantName: {} } 形式。
   */
  private encodeGamePhase(phaseIndex: number): Record<string, unknown> {
    const phaseNames = ['waiting', 'shuffling', 'preFlop', 'flop', 'turn', 'river', 'showdown', 'finished'];
    const name = phaseNames[phaseIndex] ?? 'waiting';
    return { [name]: {} };
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

    // プライベートER（TEE）からGameアカウントを読み取る。公開ERにはアカウントがない。
    const readConn = await this.getReadConnection();
    if (!readConn) {
      throw new Error(`TEE connection unavailable for commitGameCheckpoint gameId ${gameId}`);
    }
    const gameAccount = await readConn.getAccountInfo(gamePda, 'confirmed');
    if (!gameAccount || gameAccount.data.length < 8) {
      throw new Error(`Game account not found or not initialized for gameId ${gameId}`);
    }

    // M-x402-2と同様にIDLのcoder.accounts.decodeで動的にデコードし、バイナリオフセットのハードコードを排除
    let decodedGame: { player1: PublicKey; player2: PublicKey };
    try {
      decodedGame = this.erProgram.coder.accounts.decode('Game', gameAccount.data) as typeof decodedGame;
    } catch {
      throw new Error(`Game account for gameId ${gameId} exists but is not decodable (discriminator mismatch or not initialized)`);
    }
    const player1 = decodedGame.player1;
    const player2 = decodedGame.player2;

    const [player1StatePda] = this.derivePlayerStatePda(gameId, player1);
    const [player2StatePda] = this.derivePlayerStatePda(gameId, player2);

    // Permission PDA導出（クラス定数のPERMISSION_PROGを使用）
    const permissionP1   = this.derivePermissionPda(player1StatePda);
    const permissionP2   = this.derivePermissionPda(player2StatePda);
    const permissionGame = this.derivePermissionPda(gamePda);

    const activeProgram = await this.getActiveErProgram();

    const tx = await (activeProgram.methods as unknown as {
      commitGame: (gameId: BN) => {
        accounts: (a: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> };
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
      .transaction();

    const erConnection = (activeProgram.provider as AnchorProvider).connection;
    const txSig = await this.sendErTransaction(tx, erConnection);

    console.log(`[AnchorClient] Checkpoint commit for game ${gameId}: ${txSig}`);
    return txSig;
  }

  /**
   * ER上のGameアカウントから現在のpotとプレイヤーチップスタックを取得する。
   * submitPlayerAction後の正確な状態をaction_accepted/opponent_actionメッセージに使用する。
   *
   * Private ER委譲後はアカウントがTEE上にのみ存在するため、TEE接続を必須とする。
   * TEE接続失敗時は公開ERにフォールバックせず、リトライ後にnullを返す。
   */
  async fetchGamePotAndStacks(gameId: bigint): Promise<{ pot: number; player1ChipStack: number; player2ChipStack: number } | null> {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 800;
    const [gamePda] = this.deriveGamePda(gameId);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // プライベートER（TEE）からGameアカウントを読み取る。公開ERにはアカウントがない。
        const readConn = await this.getReadConnection();
        if (!readConn) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[AnchorClient] TEE connection unavailable for fetchGamePotAndStacks attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] TEE connection unavailable for fetchGamePotAndStacks after ${MAX_RETRIES} retries`);
          return null;
        }
        const accountInfo = await readConn.getAccountInfo(gamePda, 'confirmed');
        if (!accountInfo || accountInfo.data.length < 8) {
          if (attempt < MAX_RETRIES) {
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] Game account not found for ${gameId} after ${MAX_RETRIES} retries`);
          return null;
        }

        // delegation中はownerがDELEGATION_PROGになっている場合がある
        const ownerStr = accountInfo.owner.toBase58();
        if (ownerStr === DELEGATION_PROG.toBase58()) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[AnchorClient] Game account owned by delegation program (delegation in progress), attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] Game account still owned by delegation program after ${MAX_RETRIES} retries`);
          return null;
        }

        const data = accountInfo.data;
        // Game account raw binary layout (IDL: claw_poker v0.1.0, fixed offsets before Option<Pubkey>):
        // [8 disc][8 game_id][32 operator][32 platform][32 p1][32 p2][8 buy_in][8 pot][32 turn]
        // [1 phase][5 board][32 deck][8 p1_committed][8 p2_committed][8 hand_number][1 dealer]
        // [8 sb][8 bb][8 p1_chips][8 p2_chips] = 287 bytes
        // Note: pot=152, p1_chips=271, p2_chips=279 はすべてOption<Pubkey>(winner)より前の固定領域
        const MIN_GAME_SIZE = 287; // pot(152) + ... + p2_chips(279) + 8 = 287
        if (data.length < MIN_GAME_SIZE) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[AnchorClient] Game account data too short (${data.length} < ${MIN_GAME_SIZE}), attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] Game account data too short for ${gameId} after ${MAX_RETRIES} retries (len=${data.length})`);
          return null;
        }

        // Discriminator check (Game: [27, 90, 166, 125, 74, 100, 121, 18])
        // delegation過渡期にデータが不整合になる場合があるためリトライで回避する
        const GAME_DISC = Buffer.from([27, 90, 166, 125, 74, 100, 121, 18]);
        if (!data.subarray(0, 8).equals(GAME_DISC)) {
          if (attempt < MAX_RETRIES) {
            const hexDisc = data.subarray(0, 8).toString('hex');
            console.warn(`[AnchorClient] Game discriminator mismatch: got ${hexDisc}, attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          const hexDisc = data.subarray(0, 8).toString('hex');
          console.warn(`[AnchorClient] Game discriminator mismatch for ${gameId} after ${MAX_RETRIES} retries (disc=${hexDisc}, len=${data.length}, owner=${ownerStr})`);
          return null;
        }

        // Raw binary parsing: fixed offsets
        const pot = Number(data.readBigUInt64LE(152));            // offset 152
        const player1ChipStack = Number(data.readBigUInt64LE(271)); // offset 271
        const player2ChipStack = Number(data.readBigUInt64LE(279)); // offset 279

        return { pot, player1ChipStack, player2ChipStack };
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[AnchorClient] fetchGamePotAndStacks attempt ${attempt}/${MAX_RETRIES} failed for ${gameId}:`, err);
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          continue;
        }
        console.warn(`[AnchorClient] Failed to fetch game state for ${gameId} after ${MAX_RETRIES} retries:`, err);
        return null;
      }
    }
    return null;
  }

  // ─── TEE認証 ────────────────────────────────────────────────────────────

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

    const challenge = await this.requestTeeChallenge(this.operatorKeypair.publicKey);
    const challengeBytes = new Uint8Array(Buffer.from(challenge, 'utf-8'));
    const signatureBase58 = bs58.encode(
      nacl.sign.detached(challengeBytes, this.operatorKeypair.secretKey),
    );
    const { token, expiresAt } = await this.requestTeeLogin(
      this.operatorKeypair.publicKey,
      challenge,
      signatureBase58,
    );

    const teeConnection = new Connection(
      this.buildTeeRpcUrl('', token),
      {
        wsEndpoint: this.buildTeeWsUrl(token),
      },
    );

    this.teeAuthCache = { token, expiresAt, connection: teeConnection };
    console.log('[AnchorClient] TEE auth token acquired, expires:', new Date(expiresAt).toISOString());
    return teeConnection;
  }

  /**
   * ER向けトランザクションを送信・確認する。
   * Anchorの.rpc()はMagicBlock ER上でVersionedTransactionに起因するStructErrorを起こすため、
   * .transaction()でTxを構築し、Connection.sendRawTransactionで送信後、
   * Connection.confirmTransactionで確認する。
   */
  private async sendErTransaction(
    tx: Transaction,
    connection: Connection,
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.operatorKeypair.publicKey;
    tx.partialSign(this.operatorKeypair);

    const rawTx = tx.serialize();
    try {
      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
      });
      const confirmation = await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      // skipPreflight: true ではプログラムエラーが sendRawTransaction で検出されない。
      // confirmTransaction の結果で実際のオンチェーンエラーを検出する。
      if (confirmation.value.err) {
        throw new Error(
          `Transaction confirmed but failed on-chain: ${JSON.stringify(confirmation.value.err)} (sig: ${sig})`,
        );
      }
      return sig;
    } catch (err: unknown) {
      // 重複トランザクションは実質成功（既に処理済み）
      if (err instanceof Error && err.message.includes('already been processed')) {
        console.warn('[AnchorClient] Transaction already processed (duplicate), treating as success');
        return 'already-processed';
      }
      throw err;
    }
  }

  /**
   * プライベートER（TEE）用のAnchorProgramを取得する。
   * オペレータートークンが変わるまでProgramをキャッシュして再生成コストを削減する。
   * ER上への書き込みトランザクション（playerAction, requestShuffle等）はすべてこれを使う。
   */
  private async getActiveErProgram(): Promise<Program> {
    if (!this.teeRpcUrl) return this.erProgram;
    try {
      const teeConn = await this.getTeeConnection();
      if (!teeConn) return this.erProgram;
      // オペレータートークンが変わった場合のみProgramを再生成
      const currentToken = this.teeAuthCache?.token ?? '';
      if (this.cachedTeeProgram && this.cachedTeeProgram.token === currentToken) {
        return this.cachedTeeProgram.program;
      }
      // TEE接続はskipPreflight: trueが必須（ERはシミュレーション対象外）
      const teeProvider = new AnchorProvider(teeConn, this.makeWallet(this.operatorKeypair), {
        commitment: 'confirmed',
        skipPreflight: true,
      });
      const program = new Program(IDL, teeProvider);
      this.cachedTeeProgram = { program, token: currentToken };
      return program;
    } catch (err) {
      // TEE認証失敗時、ゲームアカウントはプライベートER上にのみ存在するため
      // 公開ERへのフォールバックは書き込みトランザクションを確実に失敗させる。
      // ただしTEEが一時的に利用不可の場合にサーバーがクラッシュしないようエラーを伝搬する。
      console.error('[AnchorClient] TEE program creation failed (no fallback for writes):', err);
      throw new Error(`TEE connection required for write operations but unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── プレイヤー別TEE認証（Private ER プライバシーモデル準拠） ─────────────────

  /** TEEが設定されているか確認（index.ts から条件分岐に使用） */
  isTeeConfigured(): boolean {
    return this.teeRpcUrl !== null;
  }

  /** マッチ開始前にTEE接続が有効かを検証する（失敗時は例外）。 */
  async ensureTeeReady(): Promise<void> {
    if (!this.teeRpcUrl) return;
    await this.getTeeConnection();
  }

  /**
   * GameMonitor用にオペレーターTEE接続を公開する。
   * プライベートERのWebSocketでゲームアカウントの変更を購読するために使用。
   */
  async createTeeConnectionForMonitor(): Promise<Connection | null> {
    try {
      return await this.getTeeConnection();
    } catch (err) {
      console.warn('[AnchorClient] TEE connection for monitor failed:', err);
      return null;
    }
  }

  /**
   * プレイヤー用TEEチャレンジを取得する。
   * TEE /auth/challenge?pubkey=<playerPubkey> を呼び出し、チャレンジ文字列を返す。
   * 返却値をプレイヤーに送り、プレイヤーが自分の秘密鍵で署名して返す（tee_auth_response）。
   */
  async createTeeChallenge(playerPubkey: PublicKey): Promise<string | null> {
    if (!this.teeRpcUrl) return null;
    return this.requestTeeChallenge(playerPubkey);
  }

  /**
   * プレイヤーが署名したTEEチャレンジを交換してプレイヤー専用トークンをキャッシュする。
   * 公式PERモデル準拠: 各プレイヤーが自分の鍵で認証 → 自分のPlayerStateのみTEE読み取り可能。
   * オペレーターはこのトークンを使ってそのプレイヤーのホールカードのみ読み取る。
   */
  async setPlayerTeeToken(
    playerPubkey: PublicKey,
    challenge: string,
    signatureBase58: string,
  ): Promise<void> {
    if (!this.teeRpcUrl) return;
    const { token, expiresAt } = await this.requestTeeLogin(
      playerPubkey,
      challenge,
      signatureBase58,
    );
    const conn = new Connection(
      this.buildTeeRpcUrl('', token),
      {
        wsEndpoint: this.buildTeeWsUrl(token),
      },
    );
    this.playerTeeConnections.set(playerPubkey.toString(), {
      token,
      expiresAt,
      connection: conn,
    });
    console.log(`[AnchorClient] Player TEE token set for ${playerPubkey.toBase58()}, expires: ${new Date(expiresAt).toISOString()}`);
  }

  // ─── PlayerState読み取り ───────────────────────────────────────────────────

  /**
   * PlayerStateアカウントからホールカードを読み取る。
   *
   * 接続優先順位（公式PER仕様準拠）:
   * 1. プレイヤー固有TEE接続（setPlayerTeeTokenでキャッシュ済み）← 最優先
   *    プレイヤーが自分の鍵で認証 → 自分のPlayerStateのみ読める。本来のPRIVACYモデル。
   * 2. オペレーターTEE接続（フォールバック、プレイヤートークン未取得時）
   *    警告ログを出力。オペレーターがACLに含まれている場合のみ動作。
   * 3. 公開ER接続（TEE未設定の開発環境のみ）
   *
   * Private ER委譲後はPlayerStateがTEE上にのみ存在するため、リトライロジック付き。
   */
  async getPlayerHoleCards(
    gameId: bigint,
    playerWallet: PublicKey,
  ): Promise<[string, string] | null> {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 800;
    const [playerStatePda] = this.derivePlayerStatePda(gameId, playerWallet);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        let connection: Connection;
        const playerKey = playerWallet.toString();
        const playerCached = this.playerTeeConnections.get(playerKey);

        if (
          playerCached &&
          playerCached.expiresAt > Date.now() + AnchorClient.TEE_TOKEN_REFRESH_BUFFER_MS
        ) {
          // 優先: プレイヤー自身のTEEトークン（公式PERモデル準拠）
          connection = playerCached.connection;
        } else {
          // フォールバック: オペレーターTEE接続（公開ERにはPlayerStateが存在しないためフォールバックしない）
          const teeConn = await this.getTeeConnection();
          if (!teeConn) {
            if (attempt < MAX_RETRIES) {
              await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
              continue;
            }
            console.warn(`[AnchorClient] TEE connection unavailable for ${playerWallet.toBase58()}`);
            return null;
          }
          if (attempt === 1) {
            console.warn(
              `[AnchorClient] Player TEE token not set for ${playerWallet.toBase58()}, ` +
              'using operator TEE (privacy degraded - player should respond to tee_auth_challenge)',
            );
          }
          connection = teeConn;
        }

        const accountInfo = await connection.getAccountInfo(playerStatePda, 'confirmed');
        if (!accountInfo || accountInfo.data.length < 8) {
          if (attempt < MAX_RETRIES) {
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] PlayerState not found for ${playerWallet.toBase58()} after ${MAX_RETRIES} retries`);
          return null;
        }

        // delegation中はownerがDELEGATION_PROGになっている場合がある
        const ownerStr = accountInfo.owner.toBase58();
        if (ownerStr === DELEGATION_PROG.toBase58()) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[AnchorClient] PlayerState owned by delegation program (delegation in progress) for ${playerWallet.toBase58()}, attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] PlayerState still owned by delegation program for ${playerWallet.toBase58()} after ${MAX_RETRIES} retries`);
          return null;
        }

        const data = accountInfo.data;
        // PlayerState raw binary layout:
        // [8 disc][8 game_id][32 player][2 hole_cards][8 chip_stack][8 committed][8 pot_this_hand][1 folded][1 all_in][1 bump]
        // delegation過渡期にデータが不整合になる場合があるためリトライで回避する
        const PLAYER_STATE_DISC = Buffer.from([56, 3, 60, 86, 174, 16, 244, 195]);
        const MIN_PLAYER_STATE_SIZE = 50; // 8(disc) + 8(game_id) + 32(player) + 2(hole_cards)
        if (data.length < MIN_PLAYER_STATE_SIZE) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[AnchorClient] PlayerState data too short (${data.length} < ${MIN_PLAYER_STATE_SIZE}) for ${playerWallet.toBase58()}, attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          console.warn(`[AnchorClient] PlayerState data too short for ${playerWallet.toBase58()} after ${MAX_RETRIES} retries (len=${data.length})`);
          return null;
        }

        if (!data.subarray(0, 8).equals(PLAYER_STATE_DISC)) {
          if (attempt < MAX_RETRIES) {
            const hexDisc = data.subarray(0, 8).toString('hex');
            console.warn(`[AnchorClient] PlayerState discriminator mismatch: got ${hexDisc} for ${playerWallet.toBase58()}, attempt ${attempt}/${MAX_RETRIES}`);
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            continue;
          }
          const hexDisc = data.subarray(0, 8).toString('hex');
          console.warn(`[AnchorClient] PlayerState discriminator mismatch for ${playerWallet.toBase58()} after ${MAX_RETRIES} retries (disc=${hexDisc}, len=${data.length}, owner=${ownerStr})`);
          return null;
        }

        // Raw binary parsing: hole_cards at offset 48 (8 disc + 8 game_id + 32 player)
        const card0 = data.readUInt8(48);
        const card1 = data.readUInt8(49);
        if (card0 === 255 || card1 === 255) return null;

        return [decodeCardToString(card0), decodeCardToString(card1)];
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[AnchorClient] getPlayerHoleCards attempt ${attempt}/${MAX_RETRIES} failed for ${playerWallet.toBase58()}:`, err);
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          continue;
        }
        console.error(`[AnchorClient] Failed to read hole cards for ${playerWallet.toBase58()} after ${MAX_RETRIES} retries:`, err);
        return null;
      }
    }
    return null;
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
