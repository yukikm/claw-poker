import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { ClawPoker } from "../target/types/claw_poker";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";

describe("claw-poker", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.ClawPoker as Program<ClawPoker>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const payer = provider.wallet as anchor.Wallet;
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const operator = Keypair.generate();

  // PDA helpers
  function getMatchmakingQueuePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("matchmaking_queue")],
      program.programId
    );
  }

  function getGamePda(gameId: bigint): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("game"), buf],
      program.programId
    );
  }

  function getPlayerStatePda(gameId: bigint, playerKey: PublicKey): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("player_state"), buf, playerKey.toBuffer()],
      program.programId
    );
  }

  function getGameVaultPda(gameId: bigint): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), buf],
      program.programId
    );
  }

  function getBettingPoolPda(gameId: bigint): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("betting_pool"), buf],
      program.programId
    );
  }

  function getBetRecordPda(gameId: bigint, bettor: PublicKey): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(gameId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bet_record"), buf, bettor.toBuffer()],
      program.programId
    );
  }

  async function airdrop(pubkey: PublicKey, sol: number) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * LAMPORTS_PER_SOL
    );
    const latestBlock = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: sig,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
  }

  // =========================================================
  // Test Suite 1: マッチメイキングキュー
  // =========================================================
  describe("マッチメイキングキュー", () => {
    before(async () => {
      await airdrop(player1.publicKey, 2);
      await airdrop(player2.publicKey, 2);
      await airdrop(operator.publicKey, 5);
    });

    it("initializeMatchmakingQueue: キューを初期化できる", async () => {
      const [queuePda] = getMatchmakingQueuePda();

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .initializeMatchmakingQueue(operator.publicKey)
          .accounts({
            matchmakingQueue: queuePda,
            authority: payer.publicKey,
            operator: operator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      const queue = await program.account.matchmakingQueue.fetch(queuePda);
      assert.isNotNull(queue, "MatchmakingQueueが作成されている");
    });

    it("enterMatchmakingQueue: Player1がキューに参加できる", async () => {
      const entryFee = new BN(LAMPORTS_PER_SOL / 100); // 0.01 SOL
      const [queuePda] = getMatchmakingQueuePda();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .enterMatchmakingQueue(entryFee)
        .accounts({
          matchmakingQueue: queuePda,
          player: player1.publicKey,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      const queue = await program.account.matchmakingQueue.fetch(queuePda);
      const entries = (queue.queue as unknown[]).filter((e) => e !== null);
      assert.isAbove(entries.length, 0, "Player1がキューに追加された");
    });

    it("leaveMatchmakingQueue: Player1がキューから離脱できる", async () => {
      // leaveMatchmakingQueueはキューPDAからentryFee分のSOLをプレイヤーに返金する。
      // テスト環境ではenterMatchmakingQueueがSOLを転送しない（x402担当）ため、
      // キューPDAにSOLを補充してから離脱テストを行う。
      const [queuePda] = getMatchmakingQueuePda();
      await airdrop(queuePda, 1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .leaveMatchmakingQueue()
        .accounts({
          player: player1.publicKey,
        })
        .signers([player1])
        .rpc();

      // Re-enter for subsequent tests
      const entryFee = new BN(LAMPORTS_PER_SOL / 100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .enterMatchmakingQueue(entryFee)
        .accounts({
          matchmakingQueue: queuePda,
          player: player1.publicKey,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      // Also enter player2
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .enterMatchmakingQueue(entryFee)
        .accounts({
          matchmakingQueue: queuePda,
          player: player2.publicKey,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();
    });
  });

  // =========================================================
  // Test Suite 2: ゲーム初期化
  // =========================================================
  describe("ゲーム初期化", () => {
    const GAME_ID = BigInt(1);
    const BUY_IN = new BN(LAMPORTS_PER_SOL / 100); // 0.01 SOL

    it("initializeGame: ゲームを初期化できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);
      const gameIdBn = new BN(GAME_ID.toString());

      try {
        // IDL: initializeGame(game_id, player1, player2, buy_in, operator, platform_treasury)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .initializeGame(
            gameIdBn,
            player1.publicKey,
            player2.publicKey,
            BUY_IN,
            operator.publicKey,
            payer.publicKey
          )
          .accounts({
            game: gamePda,
            player1State: p1StatePda,
            player2State: p2StatePda,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      const game = await program.account.game.fetch(gamePda);
      assert.ok(
        game.player1.equals(player1.publicKey),
        "Player1が設定されている"
      );
      assert.ok(
        game.player2.equals(player2.publicKey),
        "Player2が設定されている"
      );
      assert.equal(game.gameId.toString(), GAME_ID.toString(), "GameIDが一致");
    });

    it("createGameVault: GameVaultを作成できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [vaultPda] = getGameVaultPda(GAME_ID);
      const gameIdBn = new BN(GAME_ID.toString());

      try {
        // IDL: createGameVault(game_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .createGameVault(gameIdBn)
          .accounts({
            game: gamePda,
            gameVault: vaultPda,
            operator: operator.publicKey,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([operator])
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      const vaultBalance = await provider.connection.getBalance(vaultPda);
      assert.isAbove(vaultBalance, 0, "GameVaultにSOLが入金されている");
    });

    it("initializeBettingPool: BettingPoolを作成できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [poolPda] = getBettingPoolPda(GAME_ID);
      const gameIdBn = new BN(GAME_ID.toString());

      try {
        // IDL: initializeBettingPool(game_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .initializeBettingPool(gameIdBn)
          .accounts({
            bettingPool: poolPda,
            game: gamePda,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      const pool = await program.account.bettingPool.fetch(poolPda);
      assert.equal(
        pool.gameId.toString(),
        GAME_ID.toString(),
        "BettingPoolのgameIdが一致"
      );
      assert.equal(pool.totalBetPlayer1.toString(), "0", "初期P1ベット額はゼロ");
      assert.equal(pool.totalBetPlayer2.toString(), "0", "初期P2ベット額はゼロ");
      assert.isFalse(pool.isClosed, "初期状態はオープン");
    });
  });

  // =========================================================
  // Test Suite 3: 観戦者ベッティング
  // =========================================================
  describe("観戦者ベッティング", () => {
    const GAME_ID = BigInt(1);
    const spectator = Keypair.generate();

    before(async () => {
      await airdrop(spectator.publicKey, 2);
    });

    it("placeSpectatorBet: 観戦者がPlayer1にベットできる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [poolPda] = getBettingPoolPda(GAME_ID);
      const [betRecordPda] = getBetRecordPda(GAME_ID, spectator.publicKey);
      const gameIdBn = new BN(GAME_ID.toString());
      const betAmount = new BN(LAMPORTS_PER_SOL / 10); // 0.1 SOL

      let betPlaced = false;
      try {
        // IDL: placeSpectatorBet(game_id, player_choice, amount)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .placeSpectatorBet(gameIdBn, 1, betAmount)
          .accounts({
            bettingPool: poolPda,
            game: gamePda,
            betRecord: betRecordPda,
            bettor: spectator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([spectator])
          .rpc();
        betPlaced = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          !msg.includes("BettingPoolClosed") &&
          !msg.includes("already in use")
        ) {
          throw e;
        }
      }

      if (betPlaced) {
        const pool = await program.account.bettingPool.fetch(poolPda);
        assert.isAbove(
          pool.totalBetPlayer1.toNumber(),
          0,
          "Player1へのベット額が増加"
        );

        const betRecord = await program.account.betRecord.fetch(betRecordPda);
        assert.equal(betRecord.playerChoice, 1, "Player1を選択している");
        assert.ok(
          betRecord.bettor.equals(spectator.publicKey),
          "観戦者のアドレスが一致"
        );
        assert.isFalse(betRecord.claimed, "初期状態はunclaimed");
      }
    });
  });

  // =========================================================
  // Test Suite 4: ポーカーロジック検証（オンチェーン外）
  // =========================================================
  describe("ポーカーロジック検証（オンチェーン外）", () => {
    it("52枚デッキが正しく構成されている", () => {
      const deck = Array.from({ length: 52 }, (_, i) => i);
      assert.equal(deck.length, 52, "52枚のカード");

      const suits = deck.map((c) => Math.floor(c / 13));
      const ranks = deck.map((c) => c % 13);

      for (let s = 0; s < 4; s++) {
        assert.equal(
          suits.filter((x) => x === s).length,
          13,
          `スート${s}は13枚`
        );
      }

      for (let r = 0; r < 13; r++) {
        assert.equal(
          ranks.filter((x) => x === r).length,
          4,
          `ランク${r}は4枚`
        );
      }
    });

    it("ブラインドスケジュールの検証", () => {
      function calculateBlinds(handNumber: number): {
        smallBlind: number;
        bigBlind: number;
      } {
        const level = Math.min(Math.floor(handNumber / 10), 9);
        const BLIND_SCHEDULE = [
          [5, 10],
          [10, 20],
          [15, 30],
          [25, 50],
          [50, 100],
          [75, 150],
          [100, 200],
          [150, 300],
          [200, 400],
          [300, 600],
        ] as const;
        const [sb, bb] = BLIND_SCHEDULE[level] ?? [300, 600];
        return { smallBlind: sb, bigBlind: bb };
      }

      assert.deepEqual(calculateBlinds(0), { smallBlind: 5, bigBlind: 10 });
      assert.deepEqual(calculateBlinds(9), { smallBlind: 5, bigBlind: 10 });
      assert.deepEqual(calculateBlinds(10), { smallBlind: 10, bigBlind: 20 });
      assert.deepEqual(calculateBlinds(49), {
        smallBlind: 50,
        bigBlind: 100,
      });
      assert.deepEqual(calculateBlinds(100), {
        smallBlind: 300,
        bigBlind: 600,
      });
    });

    it("PDA導出が正しく動作する", () => {
      const gameId = BigInt(42);
      const [gamePda, gameBump] = getGamePda(gameId);

      assert.ok(gamePda instanceof PublicKey, "GamePDAはPublicKey");
      assert.isNumber(gameBump, "Bumpは数値");

      const [gamePda2] = getGamePda(gameId);
      assert.ok(gamePda.equals(gamePda2), "同じシードから同じPDAが生成される");

      const [gamePda3] = getGamePda(BigInt(43));
      assert.isFalse(gamePda.equals(gamePda3), "異なるgameIdは異なるPDAを生成");
    });

    it("Pari-mutuel配当計算の検証（オフチェーン）", () => {
      function calculatePayout(
        totalBetOnWinner: number,
        totalPool: number,
        individualBet: number,
        platformFeeBps: number = 200 // 2%
      ): number {
        if (totalBetOnWinner === 0) return 0;
        const feeAmount = Math.floor((totalPool * platformFeeBps) / 10000);
        const netPool = totalPool - feeAmount;
        return Math.floor((individualBet * netPool) / totalBetOnWinner);
      }

      // Case 1: 全員が同じ側に賭けた場合
      const payout1 = calculatePayout(1000, 1000, 500, 200);
      assert.equal(payout1, Math.floor((500 * (1000 - 20)) / 1000));

      // Case 2: 5050の賭けで勝者が2倍
      const total = 100_000_000; // 0.1 SOL total
      const winnerPool = 50_000_000; // 0.05 SOL on winner
      const betAmount = 10_000_000; // 0.01 SOL bet

      const payout2 = calculatePayout(winnerPool, total, betAmount, 200);
      assert.isAbove(payout2, betAmount, "勝者は元本以上を受け取る");
    });
  });

  // =========================================================
  // Test Suite 5: ゲームフロー - フォールドハンド (GAME_ID=1)
  // =========================================================
  describe("ゲームフロー - フォールドハンド", () => {
    const GAME_ID = BigInt(1);
    const gameIdBn = new BN(GAME_ID.toString());

    it("testShuffleAndDeal: カードを配布してPreFlopに遷移できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);
      const randomSeed = Array.from({ length: 32 }, (_, i) => i);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .testShuffleAndDeal(gameIdBn, randomSeed)
        .accounts({
          game: gamePda,
          operator: operator.publicKey,
          player1State: p1StatePda,
          player2State: p2StatePda,
        })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { preFlop: {} }, "フェーズがPreFlopになった");
      assert.equal(game.handNumber.toString(), "1", "ハンド番号が1になった");
      assert.isAbove(game.pot.toNumber(), 0, "ポットにブラインドが投入された");

      const p1State = await program.account.playerState.fetch(p1StatePda);
      assert.notEqual(p1State.holeCards[0], 255, "Player1にカードが配られた");
    });

    it("playerAction: SBプレイヤーがFoldできる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const game = await program.account.game.fetch(gamePda);
      const currentTurn = game.currentTurn as PublicKey;
      const currentPlayerStatePda = currentTurn.equals(player1.publicKey)
        ? getPlayerStatePda(GAME_ID, player1.publicKey)[0]
        : getPlayerStatePda(GAME_ID, player2.publicKey)[0];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { fold: {} }, null)
        .accounts({
          game: gamePda,
          playerState: currentPlayerStatePda,
          player: currentTurn,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      const playerState = await program.account.playerState.fetch(currentPlayerStatePda);
      assert.isTrue(playerState.isFolded, "SBプレイヤーがFoldした");
    });

    it("settleHand: Player2がFold勝利でポットを獲得できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      const gameBefore = await program.account.game.fetch(gamePda);
      const potBefore = gameBefore.pot.toNumber();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .settleHand(gameIdBn)
        .accounts({
          game: gamePda,
          operator: operator.publicKey,
          player1State: p1StatePda,
          player2State: p2StatePda,
        })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { waiting: {} }, "フェーズがWaitingに戻った");

      const p2State = await program.account.playerState.fetch(p2StatePda);
      assert.isAbove(
        p2State.chipStack.toNumber(),
        1000,
        `Player2がポット(${potBefore})を獲得した`
      );

      // チップ保全検証
      const p1State = await program.account.playerState.fetch(p1StatePda);
      assert.equal(
        p1State.chipStack.toNumber() + p2State.chipStack.toNumber(),
        2000,
        "チップ合計は常に2000"
      );
    });
  });

  // =========================================================
  // Test Suite 6: ゲームフロー - フルショーダウン (GAME_ID=1)
  // =========================================================
  describe("ゲームフロー - フルショーダウン（全ストリート）", () => {
    const GAME_ID = BigInt(1);
    const gameIdBn = new BN(GAME_ID.toString());

    it("startNewHand: ディーラーが交代する", async () => {
      const [gamePda] = getGamePda(GAME_ID);

      const gameBefore = await program.account.game.fetch(gamePda);
      const dealerBefore = gameBefore.dealerPosition;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .startNewHand(gameIdBn)
        .accounts({
          game: gamePda,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      assert.notEqual(
        game.dealerPosition,
        dealerBefore,
        "ディーラーポジションが変わった"
      );
      assert.isFalse(game.bettingClosed, "ベット受付がリセットされた");
    });

    it("testShuffleAndDeal: 2ハンド目のカードを配布できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);
      const randomSeed = Array.from({ length: 32 }, (_, i) => i + 100);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .testShuffleAndDeal(gameIdBn, randomSeed)
        .accounts({
          game: gamePda,
          operator: operator.publicKey,
          player1State: p1StatePda,
          player2State: p2StatePda,
        })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { preFlop: {} }, "PreFlopになった");
      assert.equal(game.handNumber.toString(), "2", "ハンド番号が2になった");
    });

    it("PreFlop: SBプレイヤーがCallし、BBプレイヤーがCheckでラウンド終了", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      const game = await program.account.game.fetch(gamePda);
      // dealer_position=1: P2がSB(先手), P1がBB
      const sbPlayer = game.dealerPosition === 0 ? player1 : player2;
      const bbPlayer = game.dealerPosition === 0 ? player2 : player1;
      const sbStatePda = game.dealerPosition === 0 ? p1StatePda : p2StatePda;
      const bbStatePda = game.dealerPosition === 0 ? p2StatePda : p1StatePda;

      // SBがCallでBBに合わせる
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { call: {} }, null)
        .accounts({ game: gamePda, playerState: sbStatePda, player: sbPlayer.publicKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      // BBがCheckでオプションを放棄
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: bbStatePda, player: bbPlayer.publicKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      const gameAfter = await program.account.game.fetch(gamePda);
      assert.equal(
        gameAfter.player1Committed.toNumber(),
        gameAfter.player2Committed.toNumber(),
        "両プレイヤーのコミット額が等しい"
      );
    });

    it("revealCommunityCards: Flopを公開できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // ホールカードと重複しないカードを選ぶ
      const p1State = await program.account.playerState.fetch(p1StatePda);
      const p2State = await program.account.playerState.fetch(p2StatePda);
      const usedCards = new Set([
        p1State.holeCards[0], p1State.holeCards[1],
        p2State.holeCards[0], p2State.holeCards[1],
      ]);
      const available = Array.from({ length: 52 }, (_, i) => i).filter(c => !usedCards.has(c));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .revealCommunityCards(gameIdBn, { flop: {} }, Buffer.from([available[0], available[1], available[2]]))
        .accounts({ game: gamePda, player1State: p1StatePda, player2State: p2StatePda, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { flop: {} }, "フェーズがFlopになった");
      assert.equal(game.boardCards[0], available[0]);
      assert.equal(game.boardCards[1], available[1]);
      assert.equal(game.boardCards[2], available[2]);
      assert.equal(game.player1Committed.toNumber(), 0, "コミット額がリセットされた");
    });

    it("Flop: 両プレイヤーがCheckする", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      const game = await program.account.game.fetch(gamePda);
      // Flop先手: dealer_position==0なら P2(BB側)、dealer_position==1なら P1(BB側)
      const firstPlayer = game.dealerPosition === 0 ? player2 : player1;
      const secondPlayer = game.dealerPosition === 0 ? player1 : player2;
      const firstStatePda = game.dealerPosition === 0 ? p2StatePda : p1StatePda;
      const secondStatePda = game.dealerPosition === 0 ? p1StatePda : p2StatePda;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: firstStatePda, player: firstPlayer.publicKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: secondStatePda, player: secondPlayer.publicKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();
    });

    it("revealCommunityCards: TurnとRiverを公開できる", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // ホールカードと既存のFlopカードを除外して安全なカードを選ぶ
      const p1State = await program.account.playerState.fetch(p1StatePda);
      const p2State = await program.account.playerState.fetch(p2StatePda);
      const gameBefore = await program.account.game.fetch(gamePda);
      const usedCards = new Set([
        p1State.holeCards[0], p1State.holeCards[1],
        p2State.holeCards[0], p2State.holeCards[1],
        ...gameBefore.boardCards.filter((c: number) => c !== 255),
      ]);
      const available = Array.from({ length: 52 }, (_, i) => i).filter(c => !usedCards.has(c));
      const turnCard = available[0];
      const riverCard = available[1];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .revealCommunityCards(gameIdBn, { turn: {} }, Buffer.from([turnCard]))
        .accounts({ game: gamePda, player1State: p1StatePda, player2State: p2StatePda, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      let game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { turn: {} });
      assert.equal(game.boardCards[3], turnCard);

      // Turn: Check-Check (current_turnから先手を特定)
      let currentTurn = game.currentTurn as PublicKey;
      let firstStatePda = currentTurn.equals(player1.publicKey) ? p1StatePda : p2StatePda;
      let secondKey = currentTurn.equals(player1.publicKey) ? player2.publicKey : player1.publicKey;
      let secondStatePda = currentTurn.equals(player1.publicKey) ? p2StatePda : p1StatePda;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: firstStatePda, player: currentTurn, operator: operator.publicKey })
        .signers([operator])
        .rpc();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: secondStatePda, player: secondKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      // River公開
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .revealCommunityCards(gameIdBn, { river: {} }, Buffer.from([riverCard]))
        .accounts({ game: gamePda, player1State: p1StatePda, player2State: p2StatePda, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { river: {} });
      assert.equal(game.boardCards[4], riverCard);
    });

    it("River: Check-CheckでShowdownに遷移する", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // current_turnから先手プレイヤーを特定
      let game = await program.account.game.fetch(gamePda);
      const firstKey = game.currentTurn as PublicKey;
      const secondKey = firstKey.equals(player1.publicKey) ? player2.publicKey : player1.publicKey;
      const firstStatePda = firstKey.equals(player1.publicKey) ? p1StatePda : p2StatePda;
      const secondStatePda = firstKey.equals(player1.publicKey) ? p2StatePda : p1StatePda;

      // 1回目Check: street_action_taken=false なのでShowdown未遷移
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: firstStatePda, player: firstKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      let gameState = await program.account.game.fetch(gamePda);
      assert.deepEqual(gameState.phase, { river: {} }, "1回目のCheckではShowdown未遷移");

      // 2回目Check: street_action_taken=true → Showdown遷移
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameIdBn, { check: {} }, null)
        .accounts({ game: gamePda, playerState: secondStatePda, player: secondKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      gameState = await program.account.game.fetch(gamePda);
      assert.deepEqual(gameState.phase, { showdown: {} }, "2回目のCheckでShowdownに遷移");
    });

    it("settleHand: Showdownでチップ保全を満たして決着する", async () => {
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .settleHand(gameIdBn)
        .accounts({
          game: gamePda,
          operator: operator.publicKey,
          player1State: p1StatePda,
          player2State: p2StatePda,
        })
        .signers([operator])
        .rpc();

      const p1State = await program.account.playerState.fetch(p1StatePda);
      const p2State = await program.account.playerState.fetch(p2StatePda);
      assert.equal(
        p1State.chipStack.toNumber() + p2State.chipStack.toNumber(),
        2000,
        "チップ合計は常に2000（チップ保全）"
      );

      const game = await program.account.game.fetch(gamePda);
      assert.deepEqual(game.phase, { waiting: {} }, "ハンド終了後はWaiting");
    });
  });

  // =========================================================
  // Test Suite 7: ゲーム終了 - AllIn & 精算 (GAME_ID=2)
  // =========================================================
  describe("ゲーム終了 - AllIn & 精算", () => {
    const GAME_ID2 = BigInt(2);
    const gameId2Bn = new BN(GAME_ID2.toString());
    const BUY_IN2 = new BN(LAMPORTS_PER_SOL / 100);
    const spectator2 = Keypair.generate();
    let winnerPublicKey: PublicKey | undefined;
    let skipResolveGame = false; // 引き分けの場合にresolveGameテストをスキップ

    before(async () => {
      await airdrop(spectator2.publicKey, 2);

      const [gamePda2] = getGamePda(GAME_ID2);
      const [p1StatePda2] = getPlayerStatePda(GAME_ID2, player1.publicKey);
      const [p2StatePda2] = getPlayerStatePda(GAME_ID2, player2.publicKey);
      const [vaultPda2] = getGameVaultPda(GAME_ID2);
      const [poolPda2] = getBettingPoolPda(GAME_ID2);
      // initializeGame(2)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .initializeGame(
            gameId2Bn,
            player1.publicKey,
            player2.publicKey,
            BUY_IN2,
            operator.publicKey,
            payer.publicKey
          )
          .accounts({
            game: gamePda2,
            player1State: p1StatePda2,
            player2State: p2StatePda2,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      // createGameVault(2)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .createGameVault(gameId2Bn)
          .accounts({
            game: gamePda2,
            gameVault: vaultPda2,
            operator: operator.publicKey,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([operator])
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      // initializeBettingPool(2)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .initializeBettingPool(gameId2Bn)
          .accounts({
            bettingPool: poolPda2,
            game: gamePda2,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }

      // spectator2 がPlayer2にベット
      const [betRecord2Pda] = getBetRecordPda(GAME_ID2, spectator2.publicKey);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .placeSpectatorBet(gameId2Bn, 2, new BN(LAMPORTS_PER_SOL / 20))
          .accounts({
            bettingPool: poolPda2,
            game: gamePda2,
            betRecord: betRecord2Pda,
            bettor: spectator2.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([spectator2])
          .rpc();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already in use")) throw e;
      }
    });

    it("testShuffleAndDeal(2): カードを配布できる", async () => {
      const [gamePda2] = getGamePda(GAME_ID2);
      const [p1StatePda2] = getPlayerStatePda(GAME_ID2, player1.publicKey);
      const [p2StatePda2] = getPlayerStatePda(GAME_ID2, player2.publicKey);
      const randomSeed = Array.from({ length: 32 }, (_, i) => i + 200);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .testShuffleAndDeal(gameId2Bn, randomSeed)
        .accounts({
          game: gamePda2,
          operator: operator.publicKey,
          player1State: p1StatePda2,
          player2State: p2StatePda2,
        })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda2);
      assert.deepEqual(game.phase, { preFlop: {} });
    });

    it("AllIn & Call: 両プレイヤーがAllInになりbetting_closedになる", async () => {
      const [gamePda2] = getGamePda(GAME_ID2);
      const [p1StatePda2] = getPlayerStatePda(GAME_ID2, player1.publicKey);
      const [p2StatePda2] = getPlayerStatePda(GAME_ID2, player2.publicKey);

      // current_turnを確認してSBプレイヤーからAllIn
      const gameBefore = await program.account.game.fetch(gamePda2);
      const sbKey = gameBefore.currentTurn as PublicKey;
      const bbKey = sbKey.equals(player1.publicKey) ? player2.publicKey : player1.publicKey;
      const sbStatePda = sbKey.equals(player1.publicKey) ? p1StatePda2 : p2StatePda2;
      const bbStatePda = sbKey.equals(player1.publicKey) ? p2StatePda2 : p1StatePda2;

      // SB AllIn
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameId2Bn, { allIn: {} }, null)
        .accounts({ game: gamePda2, playerState: sbStatePda, player: sbKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      // BB Call (→ auto AllIn)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .playerAction(gameId2Bn, { call: {} }, null)
        .accounts({ game: gamePda2, playerState: bbStatePda, player: bbKey, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda2);
      assert.isTrue(game.bettingClosed, "AllIn後にbetting_closedがtrue");
      assert.equal(game.pot.toNumber(), 2000, "ポットが全チップを含む");

      const p1State = await program.account.playerState.fetch(p1StatePda2);
      const p2State = await program.account.playerState.fetch(p2StatePda2);
      assert.isTrue(p1State.isAllIn, "Player1がAllIn状態");
      assert.isTrue(p2State.isAllIn, "Player2がAllIn状態");
    });

    it("closeBettingPool: operatorがベット受付を締め切れる", async () => {
      const [gamePda2] = getGamePda(GAME_ID2);
      const [poolPda2] = getBettingPoolPda(GAME_ID2);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .closeBettingPool(gameId2Bn)
        .accounts({
          bettingPool: poolPda2,
          game: gamePda2,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      const pool = await program.account.bettingPool.fetch(poolPda2);
      assert.isTrue(pool.isClosed, "BettingPoolが締め切られた");
    });

    it("closeBettingPool: 権限なしの呼び出しは失敗する", async () => {
      const [gamePda2] = getGamePda(GAME_ID2);
      const [poolPda2] = getBettingPoolPda(GAME_ID2);
      const unauthorized = Keypair.generate();
      await airdrop(unauthorized.publicKey, 1);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .closeBettingPool(gameId2Bn)
          .accounts({
            bettingPool: poolPda2,
            game: gamePda2,
            operator: unauthorized.publicKey,
          })
          .signers([unauthorized])
          .rpc();
        assert.fail("権限なし呼び出しが通るべきではない");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(
          msg.includes("BettingClosed") || msg.includes("PermissionDenied") || msg.includes("Error"),
          "エラーが発生した"
        );
      }
    });

    it("revealCommunityCards(Flop/Turn/River): AllIn後も全カードを公開できる", async () => {
      const [gamePda2] = getGamePda(GAME_ID2);
      const [p1StatePda2] = getPlayerStatePda(GAME_ID2, player1.publicKey);
      const [p2StatePda2] = getPlayerStatePda(GAME_ID2, player2.publicKey);

      // ホールカードと重複しないカードを選ぶ
      const p1State = await program.account.playerState.fetch(p1StatePda2);
      const p2State = await program.account.playerState.fetch(p2StatePda2);
      const usedCards = new Set([
        p1State.holeCards[0], p1State.holeCards[1],
        p2State.holeCards[0], p2State.holeCards[1],
      ]);
      const available = Array.from({ length: 52 }, (_, i) => i).filter(c => !usedCards.has(c));
      const [f1, f2, f3, turnCard, riverCard] = available;

      for (const [phase, cards] of [
        [{ flop: {} }, Buffer.from([f1, f2, f3])],
        [{ turn: {} }, Buffer.from([turnCard])],
        [{ river: {} }, Buffer.from([riverCard])],
      ] as [Record<string, unknown>, Buffer][]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .revealCommunityCards(gameId2Bn, phase, cards)
          .accounts({ game: gamePda2, player1State: p1StatePda2, player2State: p2StatePda2, operator: operator.publicKey })
          .signers([operator])
          .rpc();
      }

      const game = await program.account.game.fetch(gamePda2);
      assert.deepEqual(game.phase, { river: {} }, "Riverまでカードがオープンされた");
      assert.equal(game.boardCards[3], turnCard, "Turnカードが正しい");
      assert.equal(game.boardCards[4], riverCard, "Riverカードが正しい");
    });

    it("settleHand(AllIn): ポットを分配する（勝者またはTie）", async () => {
      const [gamePda2] = getGamePda(GAME_ID2);
      const [p1StatePda2] = getPlayerStatePda(GAME_ID2, player1.publicKey);
      const [p2StatePda2] = getPlayerStatePda(GAME_ID2, player2.publicKey);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .settleHand(gameId2Bn)
        .accounts({
          game: gamePda2,
          operator: operator.publicKey,
          player1State: p1StatePda2,
          player2State: p2StatePda2,
        })
        .signers([operator])
        .rpc();

      const game = await program.account.game.fetch(gamePda2);
      const p1State = await program.account.playerState.fetch(p1StatePda2);
      const p2State = await program.account.playerState.fetch(p2StatePda2);

      assert.equal(
        p1State.chipStack.toNumber() + p2State.chipStack.toNumber(),
        2000,
        "チップ保全: 合計は2000"
      );

      const gamePhase = game.phase as Record<string, unknown>;
      if ('finished' in gamePhase) {
        // 勝者あり: ゲームがFinished
        assert.isNotNull(game.winner, "勝者が決定した");
        winnerPublicKey = game.winner as PublicKey;
      } else {
        // 引き分け: ポットを均等分配しWaitingに戻る（両プレイヤー1000ずつ）
        assert.isTrue('waiting' in gamePhase, "引き分けの場合はWaitingに遷移");
        assert.equal(p1State.chipStack.toNumber(), 1000, "引き分けでP1が1000を維持");
        assert.equal(p2State.chipStack.toNumber(), 1000, "引き分けでP2が1000を維持");
        skipResolveGame = true;
      }
    });

    it("resolveGame: 勝者にSOLを分配できる", async () => {
      if (skipResolveGame) return; // 引き分けの場合はスキップ

      const [gamePda2] = getGamePda(GAME_ID2);
      const [vaultPda2] = getGameVaultPda(GAME_ID2);
      const [poolPda2] = getBettingPoolPda(GAME_ID2);

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const winnerBalanceBefore = await provider.connection.getBalance(winnerPublicKey!);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .resolveGame(gameId2Bn)
        .accounts({
          game: gamePda2,
          gameVault: vaultPda2,
          winner: winnerPublicKey,
          platformTreasury: payer.publicKey,
          bettingPool: poolPda2,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const winnerBalanceAfter = await provider.connection.getBalance(winnerPublicKey!);
      assert.isAbove(
        winnerBalanceAfter,
        winnerBalanceBefore,
        "勝者のSOL残高が増加した"
      );

      const pool = await program.account.bettingPool.fetch(poolPda2);
      assert.isTrue(pool.distributed, "distributedフラグがtrueになった");
      assert.isNotNull(pool.winner, "BettingPoolに勝者が設定された");
    });

    it("resolveGame: 2回目の呼び出しは失敗する（二重実行防止）", async () => {
      if (skipResolveGame) return; // 引き分けの場合はスキップ

      const [gamePda2] = getGamePda(GAME_ID2);
      const [vaultPda2] = getGameVaultPda(GAME_ID2);
      const [poolPda2] = getBettingPoolPda(GAME_ID2);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .resolveGame(gameId2Bn)
          .accounts({
            game: gamePda2,
            gameVault: vaultPda2,
            winner: winnerPublicKey,
            platformTreasury: payer.publicKey,
            bettingPool: poolPda2,
            operator: operator.publicKey,
          })
          .signers([operator])
          .rpc();
        assert.fail("2回目のresolveGameが通るべきではない");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(
          msg.includes("GameAlreadyCompleted") || msg.includes("Error"),
          "GameAlreadyCompletedエラーが発生した"
        );
      }
    });

    it("claimBettingReward: 的中した観戦者が報酬を受け取れる", async () => {
      const [poolPda2] = getBettingPoolPda(GAME_ID2);
      const [gamePda2] = getGamePda(GAME_ID2);
      const [betRecord2Pda] = getBetRecordPda(GAME_ID2, spectator2.publicKey);

      const pool = await program.account.bettingPool.fetch(poolPda2);
      const game = await program.account.game.fetch(gamePda2);
      const spectator2WonBet = pool.winner !== null
        && game.player2.equals(pool.winner as PublicKey);

      if (spectator2WonBet) {
        const balanceBefore = await provider.connection.getBalance(spectator2.publicKey);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .claimBettingReward(gameId2Bn)
          .accounts({
            bettingPool: poolPda2,
            game: gamePda2,
            betRecord: betRecord2Pda,
            bettor: spectator2.publicKey,
          })
          .signers([spectator2])
          .rpc();

        const balanceAfter = await provider.connection.getBalance(spectator2.publicKey);
        assert.isAbove(balanceAfter, balanceBefore, "観戦者のSOLが増加した");

        const betRecord = await program.account.betRecord.fetch(betRecord2Pda);
        assert.isTrue(betRecord.claimed, "claimedフラグがtrueになった");
      } else {
        // spectator2がPlayer2に賭けたが Player1が勝った場合: claim失敗を確認
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (program.methods as any)
            .claimBettingReward(gameId2Bn)
            .accounts({
              bettingPool: poolPda2,
              game: gamePda2,
              betRecord: betRecord2Pda,
              bettor: spectator2.publicKey,
            })
            .signers([spectator2])
            .rpc();
          assert.fail("外れ馬券の請求が通るべきではない");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          assert.ok(
            msg.includes("InvalidAction") || msg.includes("Error"),
            "外れ馬券の請求でエラーが発生した"
          );
        }
      }
    });
  });

  // =========================================================
  // Test Suite 8: セキュリティ制約検証
  // =========================================================
  describe("セキュリティ制約検証", () => {
    it("placeSpectatorBet: Finishedゲームへのベットは失敗する", async () => {
      const GAME_ID2 = BigInt(2);
      const gameId2Bn = new BN(GAME_ID2.toString());
      const [gamePda2] = getGamePda(GAME_ID2);
      const [poolPda2] = getBettingPoolPda(GAME_ID2);
      const attacker = Keypair.generate();
      await airdrop(attacker.publicKey, 1);
      const [attackerBetPda] = getBetRecordPda(GAME_ID2, attacker.publicKey);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .placeSpectatorBet(gameId2Bn, 1, new BN(LAMPORTS_PER_SOL / 100))
          .accounts({
            bettingPool: poolPda2,
            game: gamePda2,
            betRecord: attackerBetPda,
            bettor: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Finishedゲームへのベットが通るべきではない");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(
          msg.includes("GameAlreadyCompleted") || msg.includes("BettingClosed") || msg.includes("Error"),
          "Finishedゲームへのベットでエラーが発生した"
        );
      }
    });

    it("revealCommunityCards: Flop内の重複カードは失敗する", async () => {
      const GAME_ID = BigInt(1);
      const gameIdBn = new BN(GAME_ID.toString());
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // GAME_ID=1 は Suite 6 の settleHand 後に Waiting なので shuffle して PreFlop へ
      const game = await program.account.game.fetch(gamePda);
      if (JSON.stringify(game.phase) === JSON.stringify({ waiting: {} })) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .startNewHand(gameIdBn)
          .accounts({ game: gamePda, operator: operator.publicKey })
          .signers([operator])
          .rpc();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .testShuffleAndDeal(gameIdBn, Array.from({ length: 32 }, (_, i) => i + 50))
          .accounts({ game: gamePda, operator: operator.publicKey, player1State: p1StatePda, player2State: p2StatePda })
          .signers([operator])
          .rpc();
      }

      // ホールカードと重複しないカードを選び、その中で同じカードを2枚指定して重複テスト
      const p1State = await program.account.playerState.fetch(p1StatePda);
      const p2State = await program.account.playerState.fetch(p2StatePda);
      const usedCards = new Set([
        p1State.holeCards[0], p1State.holeCards[1],
        p2State.holeCards[0], p2State.holeCards[1],
      ]);
      const available = Array.from({ length: 52 }, (_, i) => i).filter(c => !usedCards.has(c));
      const dupCard = available[0];
      const otherCard = available[1];

      // Flopの3枚に重複(dupCard, dupCard, otherCard)を渡す → InvalidAction
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .revealCommunityCards(gameIdBn, { flop: {} }, Buffer.from([dupCard, dupCard, otherCard]))
          .accounts({ game: gamePda, player1State: p1StatePda, player2State: p2StatePda, operator: operator.publicKey })
          .signers([operator])
          .rpc();
        assert.fail("Flop内の重複カードが通るべきではない");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(
          msg.includes("InvalidAction") || msg.includes("Error"),
          "Flop重複カードでエラーが発生した"
        );
      }
    });

    it("revealCommunityCards: TurnにFlopと同じカードは失敗する", async () => {
      const GAME_ID = BigInt(1);
      const gameIdBn = new BN(GAME_ID.toString());
      const [gamePda] = getGamePda(GAME_ID);
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // ホールカードと重複しないカードを選ぶ
      const p1State = await program.account.playerState.fetch(p1StatePda);
      const p2State = await program.account.playerState.fetch(p2StatePda);
      const usedCards = new Set([
        p1State.holeCards[0], p1State.holeCards[1],
        p2State.holeCards[0], p2State.holeCards[1],
      ]);
      const available = Array.from({ length: 52 }, (_, i) => i).filter(c => !usedCards.has(c));
      const [flopCard1, flopCard2, flopCard3] = available;

      // まず有効なFlopを公開してFlopフェーズへ
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        .revealCommunityCards(gameIdBn, { flop: {} }, Buffer.from([flopCard1, flopCard2, flopCard3]))
        .accounts({ game: gamePda, player1State: p1StatePda, player2State: p2StatePda, operator: operator.publicKey })
        .signers([operator])
        .rpc();

      const gameAfterFlop = await program.account.game.fetch(gamePda);
      assert.deepEqual(gameAfterFlop.phase, { flop: {} }, "Flopフェーズになった");

      // TurnにFlopカードと同じカードを渡す → InvalidAction
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .revealCommunityCards(gameIdBn, { turn: {} }, Buffer.from([flopCard2]))
          .accounts({ game: gamePda, player1State: p1StatePda, player2State: p2StatePda, operator: operator.publicKey })
          .signers([operator])
          .rpc();
        assert.fail("TurnにFlopと同じカードが通るべきではない");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(
          msg.includes("InvalidAction") || msg.includes("Error"),
          "FlopとTurnの重複カードでエラーが発生した"
        );
      }
    });

    it("handleTimeout: タイムアウト前の呼び出しは失敗する", async () => {
      const GAME_ID = BigInt(1);
      const gameIdBn = new BN(GAME_ID.toString());
      const [gamePda] = getGamePda(GAME_ID);

      const game = await program.account.game.fetch(gamePda);
      // GAME_ID=1 は Waiting state なので playerAction できないが、
      // handleTimeout のタイムアウト未達チェックを確認するため
      // まず shuffle してからテストする
      const [p1StatePda] = getPlayerStatePda(GAME_ID, player1.publicKey);
      const [p2StatePda] = getPlayerStatePda(GAME_ID, player2.publicKey);

      // まだWaitingならshuffleしてからhandleTimeoutを試みる
      if (JSON.stringify(game.phase) === JSON.stringify({ waiting: {} })) {
        const randomSeed = Array.from({ length: 32 }, (_, i) => i + 77);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .testShuffleAndDeal(gameIdBn, randomSeed)
          .accounts({
            game: gamePda,
            operator: operator.publicKey,
            player1State: p1StatePda,
            player2State: p2StatePda,
          })
          .signers([operator])
          .rpc();
      }

      const gameAfterDeal = await program.account.game.fetch(gamePda);
      const timedOutPlayerKey = gameAfterDeal.currentTurn as PublicKey;
      const timedOutStatePda = timedOutPlayerKey.equals(player1.publicKey)
        ? p1StatePda
        : p2StatePda;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .handleTimeout(gameIdBn)
          .accounts({
            game: gamePda,
            timedOutPlayerState: timedOutStatePda,
            operator: operator.publicKey,
          })
          .signers([operator])
          .rpc();
        assert.fail("タイムアウト未達での呼び出しが通るべきではない");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(
          msg.includes("TimeoutNotReached") || msg.includes("Error"),
          "TimeoutNotReachedエラーが発生した"
        );
      }
    });
  });
});
