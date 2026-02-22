# MagicBlock PER活用: AIエージェント対戦ポーカー技術要件書

**バージョン**: 2.0
**最終更新日**: 2026-02-22

---

## プロジェクト概要

MagicBlock Private Ephemeral Rollup (PER)を活用したP2P AIエージェント対戦テキサスホールデムポーカーゲーム。

### 主要目標

- OpenClawのAIエージェント同士の自律的な対戦
- カード配布とゲーム進行におけるプライバシー保護（Intel TDX TEE + ACL）
- 人間による観戦機能（AIの手札は秘匿）
- Pari-mutuel方式の観戦ベッティング
- リアルタイム性能（100ms以下のアクション実行）

---

## 1. PERアーキテクチャ

### 1.1 システム全体図

```
┌──────────────────────────────────────────────────────────────────┐
│                    AIエージェント層                                │
│                                                                    │
│  ┌──────────────┐          ┌──────────────┐                       │
│  │ OpenClaw     │          │ OpenClaw     │                       │
│  │ Agent A      │          │ Agent B      │                       │
│  │ (SKILL.md)   │          │ (SKILL.md)   │                       │
│  └──────┬───────┘          └──────┬───────┘                       │
│         │ WebSocket                │ WebSocket                     │
└─────────┼──────────────────────────┼─────────────────────────────┘
          │                          │
┌─────────▼──────────────────────────▼─────────────────────────────┐
│                    ゲームサーバー層                                 │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Game Server (Off-chain)                                     │  │
│  │ - AIエージェントのWS接続管理                                 │  │
│  │ - マッチメイキング（キュー管理）                              │  │
│  │ - PER上でのゲーム進行オーケストレーション                     │  │
│  │ - Push通知: game_joined, your_turn, opponent_action等        │  │
│  │ - L1 / TEE デュアルコネクション管理                          │  │
│  └──────┬───────────────────────────────┬──────────────────────┘  │
│         │ L1 RPC                         │ TEE RPC                  │
└─────────┼───────────────────────────────┼──────────────────────────┘
          │                               │
┌─────────▼───────────────────┐ ┌────────▼──────────────────────────┐
│  Solana L1 (メインチェーン)  │ │  MagicBlock PER (TEE Validator)   │
│                              │ │                                    │
│  - ゲーム初期化              │ │  - カードシャッフル & 配布         │
│  - create_permission CPI     │ │  - プレイヤー手札（秘匿）         │
│  - delegate_pda CPI          │ │  - ベッティングラウンド処理        │
│  - Vault (SOL保管)           │ │  - ゲーム状態管理                  │
│  - Betting Pool (賭け管理)   │ │  - commit_game (結果確定)          │
│  - resolve_game (資金決済)   │ │  - commit_and_undelegate CPI      │
│  - MatchmakingQueue          │ │                                    │
└──────────────────────────────┘ └────────────────────────────────────┘
```

### 1.2 主要コンポーネント

#### Permission Program

- **アドレス**: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`
- **役割**: アカウントレベルのアクセス制御リスト (ACL) の管理
- ACLはPlayerStateアカウント内のフィールドではなく、Permission Programが管理する専用のPDAアカウントに格納される
- `create_permission` instructionへのCPIで、対象アカウントのACLを設定

#### Delegation Program

- **アドレス**: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- **役割**: アカウントをTEE Validatorに委譲（ルーティング）
- `delegate_pda` instructionへのCPIで、対象アカウントをPERに委譲
- 委譲中はDelegation Programがアカウントのownerとなる

#### TEE Validator

- **Devnet Validator Pubkey**: `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`
- **TEE URL**: `https://tee.magicblock.app`
- **ハードウェア**: Intel TDX (Trust Domain Extensions)

#### SDK依存関係

```toml
[dependencies]
ephemeral-rollups-sdk = { version = "0.8.0", features = ["anchor", "access-control"] }
```

---

## 2. Permission ProgramとACL

### 2.1 Permission PDAの仕組み

ACL（アクセス制御リスト）はPermission Programが管理するPDAアカウントに格納される。PlayerStateアカウント自体にACL情報を含めるのではなく、外部のPermission PDAで制御する。

```
Permission PDA の導出:
  seeds = ["permission", account_pda]
  program_id = ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1

Permission PDA の構造:
  members: [
    {
      pubkey: <player_pubkey>,
      flags: AUTHORITY_FLAG | TX_LOGS_FLAG
    }
  ]
```

### 2.2 ACLフラグ

| フラグ | 値 | 説明 |
|--------|---|------|
| `AUTHORITY_FLAG` | `1 << 0` | アカウントの読み取り権限。このフラグを持つpubkeyのみがTEE上でアカウントデータを読める |
| `TX_LOGS_FLAG` | `1 << 1` | トランザクションログへのアクセス権限。このフラグを持つpubkeyのみがTX logsを取得できる |

### 2.3 create_permission CPI

`create_permission`は、対象アカウントのACLを設定するinstruction。L1上で実行する。

```rust
// create_permission CPIの概要
// Permission Programの create_permission instruction にCPIする
//
// 必要なアカウント:
//   - payer: Signer (トランザクション手数料支払い)
//   - account_pda: 対象アカウント（ACLを設定する対象）
//   - permission_pda: Permission PDA（自動導出）
//   - permission_program: ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1
//   - system_program: SystemProgram
//
// 引数:
//   - members: Vec<PermissionMember>
//     各メンバーは { pubkey, flags } を持つ
```

### 2.4 delegate_pda CPI

`delegate_pda`は、対象アカウントをTEE Validatorに委譲するinstruction。L1上で実行する。

```rust
// delegate_pda CPIの概要
// Delegation Programの delegate_pda instruction にCPIする
//
// 必要なアカウント:
//   - payer: Signer (トランザクション手数料支払い)
//   - account_pda: 委譲対象アカウント
//   - owner_program: アカウントの現在のowner program
//   - delegation_record: Delegation記録PDA（自動導出）
//   - delegation_metadata: Delegation メタデータPDA（自動導出）
//   - delegation_program: DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
//   - system_program: SystemProgram
//
// 効果:
//   - アカウントのownerがdelegation_programに変更される
//   - TEE Validatorがアカウントの読み書きを管理
//   - ACLが設定されている場合、ACLに基づくアクセス制御が適用される
```

**重要**: `#[ephemeral]`マクロは使用しない。代わりに明示的に`create_permission`と`delegate_pda`のCPIを実行する。

---

## 3. アカウント構造とライフサイクル

### 3.1 アカウント一覧

#### Gameアカウント（公開情報）

```rust
// シード: ["game", game_id.to_le_bytes()]
// TEEに委譲: する（ゲーム中）
// ACL: なし（両プレイヤー・観戦者が読める）
#[account]
pub struct Game {
    pub game_id: u64,
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub buy_in: u64,                     // 参加費（lamports単位）
    pub pot: u64,                        // 現在のポット合計（チップ単位）
    pub current_turn: Pubkey,
    pub phase: GamePhase,                // Waiting, PreFlop, Flop, Turn, River, Showdown, Finished
    pub board_cards: [u8; 5],            // コミュニティカード（0-51エンコード、未公開は255）
    pub deck_seed: [u8; 32],             // VRFシャッフル用シード
    pub player1_committed: u64,          // Player1の現ラウンドのコミット額（チップ）
    pub player2_committed: u64,          // Player2の現ラウンドのコミット額（チップ）
    pub hand_number: u64,                // 現在のハンド番号（1始まり）
    pub dealer_position: u8,             // 0=Player1がSB/ディーラー, 1=Player2がSB/ディーラー
    pub current_small_blind: u64,        // 現在のスモールブラインド額（チップ）
    pub current_big_blind: u64,          // 現在のビッグブラインド額（チップ）
    pub player1_chip_stack: u64,         // Player1の総チップ数（フロントエンド向けミラー）
    pub player2_chip_stack: u64,         // Player2の総チップ数（フロントエンド向けミラー）
    pub consecutive_timeouts_p1: u8,     // Player1の連続タイムアウト回数
    pub consecutive_timeouts_p2: u8,     // Player2の連続タイムアウト回数
    pub last_raise_amount: u64,          // 最後のレイズ額（ミニマムレイズ計算用）
    pub last_checkpoint_hand: u64,       // 最後にL1チェックポイントしたハンド番号
    pub winner: Option<Pubkey>,          // 勝者（決定前はNone）
    pub betting_closed: bool,            // オールイン発生でtrue（観戦者ベット締め切り）
    pub created_at: i64,
    pub bump: u8,
}
```

#### PlayerStateアカウント（秘匿情報）

```rust
// シード: ["player_state", game_id.to_le_bytes(), player_pubkey]
// TEEに委譲: する（ゲーム中）
// ACL: 本人のみ（AUTHORITY_FLAG | TX_LOGS_FLAG）
#[account]
pub struct PlayerState {
    pub game_id: u64,
    pub player: Pubkey,
    pub hole_cards: [u8; 2],            // TEE内でのみ本人がアクセス可能（0-51エンコード）
    pub chip_stack: u64,                // 総チップ数（ゲーム通算の手持ち。初期値=1000）
    pub chips_committed: u64,           // 現ラウンドでコミットしたチップ量
    pub chips_in_pot_this_hand: u64,    // 今ハンドのポットへの累計投入量
    pub is_folded: bool,
    pub is_all_in: bool,
    pub bump: u8,
}
```

#### GameVaultアカウント（資金保管）

```rust
// シード: ["game_vault", game_id.to_le_bytes()]
// TEEに委譲: 絶対にしない（L1に常駐）
// 種別: SystemAccount（SOLを直接保管するPDA）
// 理由: 資金の安全性を確保するため、常にL1のプログラムが管理する
```

#### MatchmakingQueueアカウント（マッチング管理）

```rust
// シード: ["matchmaking_queue"]
// TEEに委譲: しない（L1に常駐）
// 注: 固定サイズ配列によるリングバッファ実装（最大10名）
#[account]
pub struct MatchmakingQueue {
    pub queue: [Option<QueueEntry>; 10],
    pub head: u8,
    pub tail: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct QueueEntry {
    pub player: Pubkey,
    pub entry_fee_paid: u64,
    pub joined_at: i64,
}
```

#### BettingPoolアカウント（観戦ベッティング）

```rust
// シード: ["betting_pool", game_id.to_le_bytes()]
// TEEに委譲: しない（L1に常駐）
// 注: 個別ベットはBetRecord PDA（["bet_record", game_id, bettor]）で管理
//     1人のベッターにつき1ゲーム1回のみベット可能
#[account]
pub struct BettingPool {
    pub game_id: u64,
    pub total_bet_player1: u64,  // Player1に賭けられた総額（lamports）
    pub total_bet_player2: u64,  // Player2に賭けられた総額（lamports）
    pub is_closed: bool,         // オールイン発生時にtrue（ベット締め切り）
    pub winner: Option<Pubkey>,  // ゲーム終了後に設定
    pub distributed: bool,       // 配当分配完了フラグ
    pub bet_count: u32,          // 総ベット数
    pub bump: u8,
}
```

### 3.2 アカウントライフサイクル

```
Phase 1: L1初期化
───────────────────────────────────────────────
  poker_program owns:
    - gamePda
    - player1StatePda
    - player2StatePda
    - vaultPda (SOL保管)
    - bettingPoolPda

Phase 2: create_permission + delegate_pda (L1で実行)
───────────────────────────────────────────────
  delegation_program owns:
    - gamePda              → TEEに委譲
    - player1StatePda      → TEEに委譲 (ACL: player1のみ)
    - player2StatePda      → TEEに委譲 (ACL: player2のみ)
  poker_program owns:
    - vaultPda             → 絶対に委譲しない
    - bettingPoolPda       → 絶対に委譲しない

Phase 3: ゲーム進行 (TEE上で実行)
───────────────────────────────────────────────
  TEE Validator が管理:
    - gamePda の読み書き（全員が読める）
    - player1StatePda の読み書き（player1のみ読める）
    - player2StatePda の読み書き（player2のみ読める）
  L1 が管理:
    - vaultPda（SOLロック中）
    - bettingPoolPda（ベット受付 → 締め切り）

Phase 4: commit_game (TEE上で実行)
───────────────────────────────────────────────
  commit_and_undelegate_accounts CPI により:
    poker_program regains ownership:
      - gamePda (game.winner がL1に見える)
      - player1StatePda
      - player2StatePda

Phase 5: resolve_game (L1で実行)
───────────────────────────────────────────────
  - vaultPda → winner へSOL送金
  - bettingPoolPda → 配当計算 & 配布
  - 全アカウントの最終状態がL1に記録
```

---

## 4. TEE認証フロー

### 4.1 概要

ゲームサーバーおよびAIエージェントがTEE Validatorに接続するためには、認証トークンが必要。このフローにより、TEE環境の真正性を検証し、安全な接続を確立する。

### 4.2 認証ステップ

#### Step 1: TEE RPC整合性検証

```typescript
import { verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-sdk";

// Intel TDX attestation を検証
// TEE Validatorが本物のIntel TDX環境で動作していることを暗号学的に証明
const isValid = await verifyTeeRpcIntegrity(TEE_RPC_URL);
if (!isValid) {
  throw new Error("TEE integrity verification failed");
}
```

**目的**: TEE Validatorが改ざんされていないことを、Intel TDXのハードウェアベースのattestation（リモート認証）で検証する。これにより、バリデータオペレータでさえもTEE内のメモリにアクセスできないことが暗号学的に保証される。

#### Step 2: 認証トークン取得

```typescript
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";

// ウォレット署名で認証トークンを取得
const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1時間有効
const token = await getAuthToken(
  wallet.publicKey,     // プレイヤーのpublic key
  wallet.signMessage,   // ウォレットの署名関数
  expiresAt             // トークン有効期限 (UNIX timestamp)
);
```

**処理内容**: ウォレットの秘密鍵で署名メッセージを作成し、TEE Validatorに提出。TEEはこの署名を検証し、そのpubkeyに対応するACL権限に基づいたアクセストークンを発行する。

#### Step 3: TEE接続確立

```typescript
// 認証トークン付きでTEE RPCに接続
const teeConnection = new Connection(
  `https://tee.magicblock.app?token=${token}`
);

// この接続を使ってTEE上のinstructionを送信
// ACLで許可されたアカウントのみ読み書き可能
```

---

## 5. デュアルコネクションアーキテクチャ

### 5.1 概要

ゲームサーバーはL1接続とTEE接続の2つのRPC接続を同時に管理する。各instructionは実行場所（L1 or TEE）が明確に決まっている。

### 5.2 L1接続で実行するInstruction

| Instruction | 説明 | 実行タイミング |
|-------------|------|---------------|
| `enter_matchmaking_queue` | マッチメイキングキューへのエントリー（参加費をQueueに一時預託） | ゲーム参加時 |
| `leave_matchmaking_queue` | マッチメイキングキューからの離脱（参加費返金） | キャンセル時 |
| `initialize_game` | Game, PlayerState, Vaultアカウントの作成 | マッチング成立時 |
| `create_game_vault` | GameVault PDA作成・参加費転送 | ゲーム初期化直後 |
| `create_permission_game` | Game PDAのACL設定（Permission ProgramへCPI） | GameVault作成直後 |
| `create_permission_player1/2` | PlayerState PDAのACL設定（各プレイヤーのみ） | ACL設定時 |
| `delegate_game` / `delegate_player1/2` | Game/PlayerStateアカウントのTEE委譲（Delegation ProgramへCPI） | ACL設定直後 |
| `initialize_betting_pool` | BettingPool PDA作成 | ゲーム初期化時 |
| `place_spectator_bet` | 観戦者がBettingPoolにベット（1ゲーム1ベット制限） | ゲーム進行中（オールイン前） |
| `resolve_game` | Vaultから勝者へSOL送金（手数料2%）、BettingPool勝者設定 | commit_game完了後 |
| `claim_betting_reward` | 観戦ベッティングの配当受取 | resolve_game完了後 |

**注**: ベット受付締め切りは明示的なinstructionではなく、TEE内でオールインが発生した際に`game.betting_closed = true`がセットされ、`commit_game`時に`betting_pool.is_closed`に同期される。

### 5.3 TEE接続で実行するInstruction

| Instruction | 説明 | 実行タイミング |
|-------------|------|---------------|
| `shuffle_and_deal` | カードシャッフルとホールカード配布（hand_number++、ブラインド投入） | 各ハンド開始時 |
| `reveal_community_cards` | コミュニティカード公開（Flop: 3枚, Turn: 1枚, River: 1枚） | 各フェーズ開始時 |
| `player_action` | プレイヤーアクション（Fold, Check, Call, Raise, All-in） | プレイヤーの手番 |
| `settle_hand` | ハンド後チップ再配・PlayerState初期化（フォールドまたはShowdown後） | ハンド終了時 |
| `start_new_hand` | ディーラー交代・次ハンド準備（betting_closedリセット等） | settle_hand後 |
| `commit_game` | 勝者確定・ハンド評価（Showdown時）・commit_and_undelegate CPI | ゲーム終了時（chip_stack=0） |

**マルチハンドフロー**: `shuffle_and_deal` → `player_action` × N → `reveal_community_cards` × 3 → `settle_hand` → `start_new_hand` → （次ハンドへループ）。いずれかのchip_stackが0になったら`commit_game`で終了。

### 5.4 接続管理の実装パターン

```typescript
// ゲームサーバーでのデュアルコネクション管理
interface DualConnection {
  l1: Connection;     // Solana L1 RPC
  tee: Connection;    // MagicBlock TEE RPC (認証トークン付き)
}

// L1接続: 常時使用可能
const l1Connection = new Connection("https://api.devnet.solana.com");

// TEE接続: 認証後に使用可能
const teeConnection = new Connection(
  `https://tee.magicblock.app?token=${authToken}`
);
```

---

## 6. マッチングシステム

### 6.1 MatchmakingQueueアカウント

L1上に存在するシングルトンアカウント。エントリーしたAIエージェントのリストを管理する。

```
seeds = ["matchmaking_queue"]
program_id = <poker_program_id>
```

### 6.2 ゲームサーバーの役割と責務

ゲームサーバーはオフチェーンのバックエンドサービスであり、以下の責務を持つ:

1. **AIエージェントのWS接続管理**
   - エージェントがWS接続を確立するとキュー待機状態になる
   - 接続の維持とハートビート管理
   - 切断時のタイムアウト処理

2. **マッチメイキング**
   - L1上のMatchmakingQueueをポーリング/サブスクライブ
   - 2エージェントが揃ったらペアリング
   - ゲーム初期化トランザクションの送信

3. **PER上でのゲーム進行オーケストレーション**
   - TEE認証トークンの取得と管理
   - TEE上のinstructionの送信タイミング制御
   - ターン管理とタイムアウト処理（30秒ルール）

4. **リアルタイム通知**
   - WS経由でAIエージェントにイベントをPush
   - 観戦者向けの状態ブロードキャスト

### 6.3 マッチングフロー

```
1. AIエージェントA → WS接続確立 → ゲームサーバー
2. エージェントA → enter_matchmaking_queue TX送信 → L1 (参加費をQueueに預託)
3. ゲームサーバー → L1のMatchmakingQueueを監視

4. AIエージェントB → WS接続確立 → ゲームサーバー
5. エージェントB → enter_matchmaking_queue TX送信 → L1 (参加費をQueueに預託)
6. ゲームサーバー → 2エージェント検出

7. ゲームサーバー → initialize_game TX → L1
   (Game, PlayerState x2 作成)

8. ゲームサーバー → create_game_vault TX → L1
   (GameVault PDA作成、MatchmakingQueue → GameVaultにSOL転送)

9. ゲームサーバー → initialize_betting_pool TX → L1
   (BettingPool PDA作成)

10. ゲームサーバー → create_permission_game + create_permission_player1 + create_permission_player2 TX → L1
    (gamePda: ACL=[player1, player2], player1/2StatePda: ACL=[各プレイヤー])

11. ゲームサーバー → delegate_game + delegate_player1 + delegate_player2 TX → L1
    (gamePda, player1StatePda, player2StatePda をTEEに委譲)

12. ゲームサーバー → WS通知: { type: "game_joined", game_id, opponent }
    → エージェントA, エージェントB

13. ゲームサーバー → shuffle_and_deal TX → TEE
    (カードシャッフル & ホールカード配布。ベット受付はオールイン発生まで継続)

14. ゲーム進行開始（TEE上）
```

**注**: ベット受付は明示的には締め切らない。TEE内でオールインが発生した時点でゲームサーバーが観戦者にベット締め切りを通知する。L1上の`betting_pool.is_closed`は`commit_game`実行時に同期される。

### 6.4 WS通知イベント一覧

| イベント | 送信先 | ペイロード |
|---------|--------|-----------|
| `queue_joined` | 当該エージェント | `{ position }` |
| `game_joined` | 両エージェント | `{ game_id, opponent, your_position }` |
| `your_turn` | 手番エージェント | `{ game_state, valid_actions, timeout_sec }` |
| `opponent_action` | 相手エージェント | `{ action, amount, new_pot }` |
| `community_cards` | 両エージェント + 観戦者 | `{ cards, phase }` |
| `showdown` | 両エージェント + 観戦者 | `{ hands, winner, pot }` |
| `game_ended` | 両エージェント + 観戦者 | `{ winner, payout }` |

---

## 7. カードシャッフルとプライバシー

### 7.1 シャッフルアルゴリズム

カードシャッフルはTEE内でのみ実行される。外部からシャッフル結果を予測することは不可能。

#### Seed生成

```
seed = SHA256(client_random + game_id + player1_pubkey + player2_pubkey + hand_number)
```

- `client_random`: TEE内で生成されるランダム値（Intel TDXのハードウェアRNG）
- `game_id`: ゲームの一意識別子
- `player1_pubkey`: プレイヤー1のSolana公開鍵
- `player2_pubkey`: プレイヤー2のSolana公開鍵
- `hand_number`: 現在のハンド番号（マルチハンドで各ハンドに異なるデッキを保証）

#### Fisher-Yatesシャッフル

```rust
// TEE内で実行
fn shuffle_deck(seed: [u8; 32]) -> [Card; 52] {
    let mut deck = Card::standard_deck(); // 52枚の標準デッキ
    let mut rng = ChaCha20Rng::from_seed(seed);

    // Fisher-Yatesアルゴリズム
    for i in (1..52).rev() {
        let j = rng.gen_range(0..=i);
        deck.swap(i, j);
    }

    deck
}
```

### 7.2 ホールカード配布

```rust
// TEE内で実行: shuffle_and_deal instruction
// 1. シードからデッキをシャッフル
// 2. player1StatePda.hole_cards = [deck[0], deck[1]]
// 3. player2StatePda.hole_cards = [deck[2], deck[3]]
// 4. gamePda内にデッキの残り（コミュニティカード用）を保持
//    ただしgamePdaのcommunity_cardsはフェーズ進行時に公開
```

### 7.3 プライバシー保証

1. **ACLによるアクセス制御**: `player1StatePda`のACLには`player1`のみがメンバーとして設定されている。player2やゲームサーバーはplayer1のホールカードを読めない。
2. **TEEハードウェア隔離**: PlayerStateアカウントのデータはIntel TDXの暗号化メモリ内に存在する。TEE Validatorのオペレータでさえもメモリの内容にアクセスできない。
3. **L1ログ非記録**: ACLに`TX_LOGS_FLAG`が設定されていないpubkeyは、TEE上のトランザクションログを取得できない。カード情報を含むinstructionのログはL1には記録されない。TEE内のトランザクションはL1から不可視。

---

## 8. Settlement（2フェーズコミット）

### 8.1 Phase 1: commit_game（TEE上で実行）

ゲームが終了したとき（ショーダウンまたはフォールド）、TEE上で`commit_game` instructionを実行する。

```rust
// commit_game の処理内容:
//
// 1. 勝者の決定
//    - ショーダウン: ハンド評価により勝者を決定
//    - フォールド: フォールドしなかったプレイヤーが勝者
//
// 2. game.winner に勝者のpubkeyを書き込み
//
// 3. game.status を Completed に変更
//
// 4. commit_and_undelegate_accounts CPI を実行
//    - Delegation Programに対してCPIを発行
//    - 委譲されていた全アカウント (gamePda, player1StatePda, player2StatePda) を
//      TEEからL1に返却
//    - アカウントのownerがdelegation_programからpoker_programに戻る
//    - アカウントの最新状態がL1に反映される
```

### 8.2 Phase 2: resolve_game（L1で実行）

commit_gameが完了し、アカウントがL1に返却された後、L1上で`resolve_game` instructionを実行する。

```rust
// resolve_game の処理内容:
//
// 1. game.winner の検証
//    - game.status が Completed であることを確認
//    - game.winner が設定されていることを確認
//
// 2. Vault → Winner へSOL送金
//    - vaultPda から game.winner へ全額送金
//    - PDAのsigner seedsを使った安全な送金
//
// 3. BettingPool の配当計算（別instructionまたは同一instruction内）
//    → セクション9で詳述
```

### 8.3 資金フロー

```
ゲーム開始時:
  Player1 → 100 SOL → Vault
  Player2 → 100 SOL → Vault
  Vault残高: 200 SOL

ゲーム終了後 (Player1が勝者の場合):
  commit_game (TEE): game.winner = Player1
  resolve_game (L1): Vault → 200 SOL → Player1
  Vault残高: 0 SOL
```

---

## 9. Pari-mutuel Bettingのオンチェーン処理

### 9.1 概要

観戦者がどちらのAIエージェントが勝つかにSOLを賭けるPari-mutuel（パリミュチュエル）方式のベッティングシステム。BettingPoolアカウントはL1上に常駐し、TEEには委譲しない。

### 9.2 ベッティングフロー

```
1. ゲーム初期化時にBettingPoolアカウント作成（L1）

2. ベット受付期間（ゲーム開始前）:
   観戦者 → place_bet TX → L1
   - BettingPool.bets に記録
   - player1_pool または player2_pool に加算
   - bettor の SOL を BettingPool PDA に送金

3. ベット締め切り:
   ゲームサーバー → close_betting TX → L1
   - BettingPool.betting_closed = true
   - 以降の place_bet は拒否

4. ゲーム終了後（resolve_game と同時または直後）:
   配当計算 → 各ベッターへ配布
```

### 9.3 配当計算のオンチェーンロジック

Pari-mutuel方式: 勝者サイドに賭けた全員で、負者サイドの賭け金を比例配分。

```
例: Player1が勝った場合
  total_pool = player1_pool + player2_pool
  各ベッターの配当 = (bet_amount / winning_pool) * total_pool

具体例:
  player1_pool = 300 SOL (3人: A=100, B=100, C=100)
  player2_pool = 200 SOL (2人: D=150, E=50)
  total_pool = 500 SOL

  Player1勝利の場合:
    A の配当 = (100 / 300) * 500 = 166.67 SOL
    B の配当 = (100 / 300) * 500 = 166.67 SOL
    C の配当 = (100 / 300) * 500 = 166.67 SOL
    D, E の配当 = 0 SOL
```

### 9.4 claim_winnings instruction

```rust
// 観戦者が自分の配当を受け取るinstruction（L1で実行）
//
// 検証:
//   - game.status == Completed
//   - betting_pool.settled == true
//   - 呼び出し元がbets内に存在
//   - backed_player == game.winner
//   - まだclaimしていない
//
// 処理:
//   - 配当額を計算
//   - BettingPool PDA → bettor へSOL送金
```

---

## 10. パフォーマンス目標

### 10.1 メトリクス

| メトリクス | 目標値 | 備考 |
|-----------|--------|------|
| TEEアクション実行時間 | < 100ms | player_action, deal等のTEE上のinstruction |
| L1トランザクション確認 | < 2秒 | initialize_game, resolve_game等 |
| ゲーム全体所要時間 | < 3分 | AI応答時間含む（30秒タイムアウト x 最大ラウンド数） |
| AIエージェント応答時間 | < 30秒 | タイムアウト: 30秒、超過で自動Fold |
| TEE認証フロー | < 3秒 | verifyTeeRpcIntegrity + getAuthToken |
| L1コミット（undelegate） | < 5秒 | commit_and_undelegate_accounts |
| WS通知遅延 | < 200ms | ゲームサーバー → エージェント/観戦者 |
| 同時ゲームセッション | 50+ | 初期目標、段階的にスケール |

### 10.2 コミット戦略: マルチハンド + 50ハンドチェックポイント

本プロジェクトでは以下のコミット戦略を採用する。

- **通常コミット**: ゲーム終了時（chip_stack=0）に`commit_game`でL1にコミット
- **定期チェックポイント**: 50ハンドごとに中間コミットを実行（`last_checkpoint_hand`で管理）。データロス防止と長時間ゲームの安全性確保のため。
- **観戦者向けリアルタイム更新**: WS経由でゲームサーバーからブロードキャスト（L1コミットとは独立）
- **理由**: L1トランザクションコストの最小化と、TEE上でのゲーム速度最大化を両立しながら、長期ゲームの安全性を担保

```
L1トランザクション（ゲーム全体）:
  初期化フェーズ:
    1. initialize_game (1 TX)
    2. create_game_vault (1 TX)
    3. initialize_betting_pool (1 TX)
    4. create_permission x3 (3 TX)
    5. delegate x3 (3 TX)
  定期チェックポイント（50ハンドごと）:
    6. commit_game + re-delegate (2 TX/チェックポイント)
  終了フェーズ:
    7. commit_game (最終) (1 TX)
    8. resolve_game (1 TX)
  合計: 約11 TX/ゲーム + チェックポイントTX + ベットTX（観戦者数に依存）
```

---

## 11. セキュリティモデル

### 11.1 Intel TDXハードウェア隔離

- **Trust Domain Extensions (TDX)**: Intel CPUに組み込まれたハードウェアベースのセキュリティ技術
- **メモリ暗号化**: TEE内のメモリはハードウェアレベルで暗号化され、ホストOS、ハイパーバイザ、さらにはバリデータオペレータからもアクセス不可
- **リモートAttestation**: `verifyTeeRpcIntegrity()`により、クライアント側からTEE環境の真正性を暗号学的に検証可能
- **PCCS (Provisioning Certificate Caching Service)**: Intel SGX/TDX attestationの証明書チェーンを検証するサービス

### 11.2 ACLによるアクセス制御

- PlayerStateアカウントには個別のACLが設定される
- ACLはPermission Program管理のPDAに格納（アカウント自体には含まない）
- `AUTHORITY_FLAG`: アカウントデータの読み取り権限
- `TX_LOGS_FLAG`: 対象アカウントに関連するトランザクションログへのアクセス権限
- ACL外のpubkey（他プレイヤー、観戦者、ゲームサーバー）はPlayerStateを読めない

### 11.3 カード情報のL1非記録

- TEE上で実行されるinstructionのログはL1チェーンには記録されない
- `shuffle_and_deal`、`deal_community_cards`（配布時点）、`player_action`のログはTEE内に留まる
- `commit_and_undelegate_accounts`実行時、アカウントの最終状態（結果含む）のみがL1に反映される
- ゲーム中のホールカード情報がオンチェーンエクスプローラーやRPCから取得されることはない

### 11.4 資金の安全性

- GameVault（SOL保管）は絶対にTEEに委譲しない
- Vault操作（resolve_game）はL1上のプログラムのみが実行可能
- PDAのsigner seedsによる安全なSOL送金
- checked mathによる整数オーバーフロー防止
- 再入可能性（reentrancy）攻撃への防御

### 11.5 AIエージェントのタイムアウト保護

- 各アクションに30秒のタイムアウトを設定
- タイムアウト超過で自動Fold
- 切断時も同様にタイムアウト処理
- DoS攻撃（意図的な遅延）への防御

---

## まとめ

本技術要件書は、MagicBlock Private Ephemeral Rollupを活用したAIエージェント対戦ポーカーの実装指針を提供する。

### 主要な設計決定

1. **プライバシー**: Intel TDX TEE + Permission Program ACLによる多層アプローチ
2. **アカウント委譲**: `create_permission` + `delegate_pda` CPIパターン（`#[ephemeral]`マクロは不使用）
3. **資金管理**: GameVaultはL1常駐（TEE委譲禁止）、2フェーズコミットで安全な資金決済
4. **コミット戦略**: PerRound（ゲーム終了時にL1コミット、リアルタイム更新はWS経由）
5. **マッチング**: L1上のMatchmakingQueue + オフチェーンゲームサーバーのハイブリッド
6. **ベッティング**: L1上のPari-mutuelプール、ゲーム結果に基づく自動配当
7. **パフォーマンス**: TEE上100ms以下のアクション実行、WS経由200ms以下の通知
8. **カード公正性**: TEE内Fisher-Yatesシャッフル、ハードウェアRNG + 複合seed
