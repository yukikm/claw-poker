# Solana Anchor要件書: Claw Poker

MagicBlock Private Ephemeral Rollup (PER)を活用したP2P AIエージェント対戦テキサスホールデムポーカーゲーム。OpenClawのAIエージェント同士が対戦し、SOLによる参加費支払い（x402プロトコル）と賞金分配を実装。人間の観戦者は対戦結果にPari-mutuel方式で賭けることが可能。

---

## 1. プログラム構成

### 1.1 メインプログラム: `claw_poker`

**Program ID**: デプロイ時に確定（Anchor.tomlで管理）

**責務**:
- ゲームライフサイクル管理（作成・進行・決済）
- マッチメイキングキュー管理
- ポーカーゲームロジック（TEE内実行）
- 資金管理（GameVault経由のSOL転送）
- 観戦者ベッティング（Pari-mutuel方式）

### 1.2 モジュール構成

```
programs/claw-poker/
├── src/
│   ├── lib.rs                          # プログラムエントリーポイント（全instruction定義）
│   ├── instructions/
│   │   ├── mod.rs                      # instructionモジュール集約
│   │   ├── initialize_matchmaking_queue.rs
│   │   ├── enter_matchmaking_queue.rs
│   │   ├── leave_matchmaking_queue.rs
│   │   ├── initialize_game.rs
│   │   ├── create_game_vault.rs
│   │   ├── create_permission_game.rs
│   │   ├── create_permission_player1.rs
│   │   ├── create_permission_player2.rs
│   │   ├── delegate_game.rs
│   │   ├── delegate_player1.rs
│   │   ├── delegate_player2.rs
│   │   ├── initialize_betting_pool.rs
│   │   ├── place_spectator_bet.rs
│   │   ├── resolve_game.rs
│   │   ├── claim_betting_reward.rs
│   │   ├── shuffle_and_deal.rs         # TEE内実行
│   │   ├── player_action.rs            # TEE内実行
│   │   ├── reveal_community_cards.rs   # TEE内実行
│   │   └── commit_game.rs              # TEE内実行（commit_and_undelegate）
│   ├── state/
│   │   ├── mod.rs
│   │   ├── game.rs                     # Game構造体
│   │   ├── player_state.rs             # PlayerState構造体
│   │   ├── matchmaking_queue.rs        # MatchmakingQueue構造体
│   │   ├── betting_pool.rs             # BettingPool構造体
│   │   └── bet_record.rs               # BetRecord構造体
│   ├── errors.rs                       # カスタムエラーコード
│   └── utils/
│       ├── mod.rs
│       ├── poker_logic.rs              # ベッティングルール検証
│       ├── hand_evaluator.rs           # 7枚→最強5枚の役判定
│       ├── card.rs                     # カードエンコーディング（0-51）
│       └── vrf.rs                      # VRFシャッフルロジック
```

**単一プログラム設計の理由**: x402統合は独立プログラムとしないことで、CPI呼び出しのオーバーヘッドを回避し、参加費のSOL転送をゲームinstructionに統合する。

---

## 2. PDAシード一覧

全PDAのシード定義。`game_id`は`u64`型を使用し、`to_le_bytes()`でバイト列に変換する。

| PDA | シード | 説明 |
|-----|--------|------|
| Game | `["game", game_id.to_le_bytes()]` | ゲーム状態（公開情報） |
| PlayerState (P1) | `["player_state", game_id.to_le_bytes(), player1_pubkey]` | Player1の秘密状態 |
| PlayerState (P2) | `["player_state", game_id.to_le_bytes(), player2_pubkey]` | Player2の秘密状態 |
| GameVault | `["game_vault", game_id.to_le_bytes()]` | 参加費保管用SOL vault |
| MatchmakingQueue | `["matchmaking_queue"]` | マッチメイキングキュー（シングルトン） |
| BettingPool | `["betting_pool", game_id.to_le_bytes()]` | 観戦者ベッティングプール |
| BetRecord | `["bet_record", game_id.to_le_bytes(), bettor_pubkey]` | 個別ベット記録 |

---

## 3. アカウント構造体

### 3.1 Game

ゲームの公開状態。TEEに委譲される。

```rust
#[account]
pub struct Game {
    /// ゲーム識別子（u64）
    pub game_id: u64,
    /// Player 1のウォレットアドレス
    pub player1: Pubkey,
    /// Player 2のウォレットアドレス
    pub player2: Pubkey,
    /// 参加費（lamports単位）
    pub buy_in: u64,
    /// 現在のポット合計（lamports単位）
    pub pot: u64,
    /// 現在のターンを持つプレイヤー
    pub current_turn: Pubkey,
    /// 現在のゲームフェーズ
    pub phase: GamePhase,
    /// コミュニティカード（0-51エンコード、未公開は255）
    pub board_cards: [u8; 5],
    /// VRFシャッフル用シード
    pub deck_seed: [u8; 32],
    /// Player 1の現ラウンドのコミット額
    pub player1_committed: u64,
    /// Player 2の現ラウンドのコミット額
    pub player2_committed: u64,
    /// 勝者（決定前はNone）
    pub winner: Option<Pubkey>,
    /// オールイン発生でtrueになり、観戦者ベットを締め切る
    pub betting_closed: bool,
    /// ゲーム作成時刻（Unix timestamp）
    pub created_at: i64,
    /// PDAバンプ
    pub bump: u8,
}
```

**スペース計算**: 8 (discriminator) + 8 (game_id) + 32 (player1) + 32 (player2) + 8 (buy_in) + 8 (pot) + 32 (current_turn) + 1 (phase) + 5 (board_cards) + 32 (deck_seed) + 8 (player1_committed) + 8 (player2_committed) + 33 (winner: Option<Pubkey>) + 1 (betting_closed) + 8 (created_at) + 1 (bump) = **225 bytes**

### 3.2 PlayerState

各プレイヤーの秘密状態。TEEに委譲され、ACLで本人のみアクセス可能。

```rust
#[account]
pub struct PlayerState {
    /// 関連するゲームID
    pub game_id: u64,
    /// プレイヤーのウォレットアドレス
    pub player: Pubkey,
    /// ホールカード（0-51エンコード）
    pub hole_cards: [u8; 2],
    /// 現ラウンドでコミットしたチップ量
    pub chips_committed: u64,
    /// フォールド済みフラグ
    pub is_folded: bool,
    /// オールインフラグ
    pub is_all_in: bool,
    /// PDAバンプ
    pub bump: u8,
}
```

**スペース計算**: 8 (discriminator) + 8 (game_id) + 32 (player) + 2 (hole_cards) + 8 (chips_committed) + 1 (is_folded) + 1 (is_all_in) + 1 (bump) = **61 bytes**

### 3.3 GameVault

参加費を保管するSOL vault。PDAが所有する。BettingPoolとは独立しており、TEEには委譲しない。

```
シード: ["game_vault", game_id.to_le_bytes()]
```

GameVaultは専用の構造体を持たず、System Programが所有するPDAアカウントとしてSOLを保持する。`resolve_game` instructionでPDAの署名を使ってSOLを転送する。

### 3.4 MatchmakingQueue

マッチメイキング用キュー。固定サイズ配列によるリングバッファ実装。

```rust
#[account]
pub struct MatchmakingQueue {
    /// キューエントリー（固定サイズ、最大10名）
    pub queue: [Option<QueueEntry>; 10],
    /// リングバッファのヘッド位置
    pub head: u8,
    /// リングバッファのテール位置
    pub tail: u8,
    /// PDAバンプ
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct QueueEntry {
    /// プレイヤーのウォレットアドレス
    pub player: Pubkey,
    /// 支払い済み参加費（lamports）
    pub entry_fee_paid: u64,
    /// キュー参加時刻（Unix timestamp）
    pub joined_at: i64,
}
```

**スペース計算**: 8 (discriminator) + 10 * (1 + 32 + 8 + 8) (queue) + 1 (head) + 1 (tail) + 1 (bump) = **501 bytes**

### 3.5 BettingPool

ゲームごとの観戦者ベッティングプール。L1上に存在し、TEEに委譲しない。

```rust
#[account]
pub struct BettingPool {
    /// 関連するゲームID
    pub game_id: u64,
    /// Player 1に賭けられた総額（lamports）
    pub total_bet_player1: u64,
    /// Player 2に賭けられた総額（lamports）
    pub total_bet_player2: u64,
    /// ベット受付終了フラグ（オールイン発生時にtrue）
    pub is_closed: bool,
    /// 勝者（ゲーム終了後に設定）
    pub winner: Option<Pubkey>,
    /// 配当分配完了フラグ
    pub distributed: bool,
    /// 総ベット数
    pub bet_count: u32,
    /// PDAバンプ
    pub bump: u8,
}
```

**スペース計算**: 8 (discriminator) + 8 (game_id) + 8 (total_bet_player1) + 8 (total_bet_player2) + 1 (is_closed) + 33 (winner) + 1 (distributed) + 4 (bet_count) + 1 (bump) = **72 bytes**

### 3.6 BetRecord

個別の観戦者ベット記録。ベッターごとに1ゲームにつき1つ。

```rust
#[account]
pub struct BetRecord {
    /// 関連するゲームID
    pub game_id: u64,
    /// ベッターのウォレットアドレス
    pub bettor: Pubkey,
    /// 賭け先（1=Player1, 2=Player2）
    pub player_choice: u8,
    /// ベット額（lamports）
    pub amount: u64,
    /// 報酬受取済みフラグ
    pub claimed: bool,
    /// PDAバンプ
    pub bump: u8,
}
```

**スペース計算**: 8 (discriminator) + 8 (game_id) + 32 (bettor) + 1 (player_choice) + 8 (amount) + 1 (claimed) + 1 (bump) = **59 bytes**

### 3.7 Enum定義

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GamePhase {
    Waiting,     // プレイヤー待ち
    PreFlop,     // ホールカード配布後
    Flop,        // フロップ公開後
    Turn,        // ターン公開後
    River,       // リバー公開後
    Showdown,    // ショーダウン
    Finished,    // ゲーム終了
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PlayerAction {
    Fold,
    Check,
    Call,
    Bet,
    Raise,
    AllIn,
}
```

### 3.8 カードエンコーディング

カードは`u8`値（0-51）でエンコードする。未公開カードは`255`を使用。

```
suit = card_value / 13
rank = card_value % 13

suit: 0=Spades, 1=Hearts, 2=Diamonds, 3=Clubs
rank: 0=2, 1=3, 2=4, ..., 8=10, 9=J, 10=Q, 11=K, 12=A
```

例: card_value=0 → 2 of Spades, card_value=12 → Ace of Spades, card_value=51 → Ace of Clubs

---

## 4. Instruction一覧

### 4.1 L1 Instructions

L1（Base Layer）で実行されるinstructionの一覧。

#### 4.1.1 `initialize_matchmaking_queue`

マッチメイキングキューのPDAを初期化する。プログラムのデプロイ後に一度だけ実行。

```rust
#[derive(Accounts)]
pub struct InitializeMatchmakingQueue<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<MatchmakingQueue>(),
        seeds = [b"matchmaking_queue"],
        bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. MatchmakingQueue PDAを作成
2. queue配列を全てNoneで初期化
3. head, tailを0に設定

#### 4.1.2 `enter_matchmaking_queue(entry_fee: u64)`

AIエージェントがマッチメイキングキューに参加する。参加費をキューのvaultに一時預託。

```rust
#[derive(Accounts)]
pub struct EnterMatchmakingQueue<'info> {
    #[account(
        mut,
        seeds = [b"matchmaking_queue"],
        bump = matchmaking_queue.bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. キューが満杯でないことを確認（`QueueFull`エラー）
2. プレイヤーが既にキューにいないことを確認（`AlreadyInQueue`エラー）
3. 参加費が最低額以上であることを確認（`EntryFeeInsufficient`エラー）
4. SOLをプレイヤーからMatchmakingQueue PDAに転送（`system_program::transfer`）
5. QueueEntryをtail位置に追加
6. tailをインクリメント
7. キューに2名以上いる場合、マッチング処理を実行（同一参加費のペアを探索）

**マッチング成立時の処理**:
- 2名のペアをキューから取り出す
- `game_id`を生成（Clock::get().unix_timestamp等から導出）
- `initialize_game` instructionの呼び出しをクライアント側で連続実行

#### 4.1.3 `leave_matchmaking_queue`

AIエージェントがマッチメイキングキューから離脱し、参加費の返金を受ける。

```rust
#[derive(Accounts)]
pub struct LeaveMatchmakingQueue<'info> {
    #[account(
        mut,
        seeds = [b"matchmaking_queue"],
        bump = matchmaking_queue.bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. プレイヤーがキューに存在することを確認
2. QueueEntryを取得し、entry_fee_paidを記録
3. キューからエントリーを削除（Noneに設定）
4. MatchmakingQueue PDAからプレイヤーにSOLを返金（PDA署名による転送）

#### 4.1.4 `initialize_game(game_id: u64, player1: Pubkey, player2: Pubkey, buy_in: u64)`

マッチング成立後にGame PDAを作成する。

```rust
#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<Game>(),
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<PlayerState>(),
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player1.as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<PlayerState>(),
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player2.as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. Game PDAを作成
2. PlayerState PDAを両プレイヤー分作成
3. Gameフィールドを初期化:
   - `game_id`, `player1`, `player2`, `buy_in`を設定
   - `pot = buy_in * 2`（両者の参加費合計）
   - `current_turn = player1`（SB=Player1が先手）
   - `phase = GamePhase::Waiting`
   - `board_cards = [255; 5]`（全て未公開）
   - `betting_closed = false`
   - `created_at = Clock::get()?.unix_timestamp`
4. PlayerStateフィールドを初期化:
   - `hole_cards = [255; 2]`（未配布）
   - `chips_committed = 0`
   - `is_folded = false`
   - `is_all_in = false`

#### 4.1.5 `create_game_vault(game_id: u64)`

GameVault PDAを作成し、マッチメイキングキューから参加費を転送する。

```rust
#[derive(Accounts)]
pub struct CreateGameVault<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: GameVault PDA（SOLを保持するだけ）
    #[account(
        init,
        payer = payer,
        space = 0,
        seeds = [b"game_vault", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"matchmaking_queue"],
        bump = matchmaking_queue.bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. GameVault PDAを作成
2. MatchmakingQueue PDAから`buy_in * 2`分のSOLをGameVaultに転送（PDA署名）
3. GameのVault参照を設定

#### 4.1.6 `create_permission_game(game_id: u64)`

Game PDAに対するMagicBlock ACL（Access Control List）を設定する。両プレイヤーをメンバーとして登録。

```rust
#[derive(Accounts)]
pub struct CreatePermissionGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// MagicBlock Permission PDA
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. Game PDAに対してMagicBlock ACLを作成
2. player1とplayer2の両方をメンバーとして設定
3. 両プレイヤーがGameアカウントの読み書きを許可される

#### 4.1.7 `create_permission_player1(game_id: u64)` / `create_permission_player2(game_id: u64)`

各PlayerState PDAに対するMagicBlock ACLを設定する。対応するプレイヤーのみをメンバーとして登録。

```rust
#[derive(Accounts)]
pub struct CreatePermissionPlayer<'info> {
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    pub player: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. PlayerState PDAに対してMagicBlock ACLを作成
2. 対応するプレイヤーのみをメンバーとして設定
3. 他のプレイヤーはこのPlayerStateにアクセスできない（ホールカードのプライバシー保護）

#### 4.1.8 `delegate_game(game_id: u64)`

Game PDAをTEE（Trusted Execution Environment）に委譲する。

```rust
#[derive(Accounts)]
pub struct DelegateGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. MagicBlock Delegation ProgramのCPIを呼び出し
2. Game PDAの所有権をTEEに移譲
3. 以降、Gameアカウントの更新はTEE経由のみ可能

#### 4.1.9 `delegate_player1(game_id: u64)` / `delegate_player2(game_id: u64)`

各PlayerState PDAをTEEに委譲する。

```rust
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    pub player: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. MagicBlock Delegation ProgramのCPIを呼び出し
2. PlayerState PDAの所有権をTEEに移譲
3. ACL設定により、該当プレイヤーのみがTEE内でこのアカウントにアクセス可能

#### 4.1.10 `initialize_betting_pool(game_id: u64)`

ゲームごとの観戦者ベッティングプールを作成する。

```rust
#[derive(Accounts)]
pub struct InitializeBettingPool<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<BettingPool>(),
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. BettingPool PDAを作成
2. 初期値:
   - `game_id`を設定
   - `total_bet_player1 = 0`
   - `total_bet_player2 = 0`
   - `is_closed = false`
   - `winner = None`
   - `distributed = false`
   - `bet_count = 0`

#### 4.1.11 `place_spectator_bet(game_id: u64, player_choice: u8, amount: u64)`

観戦者がゲームの勝者予想にベットする。Pari-mutuel方式。

```rust
#[derive(Accounts)]
pub struct PlaceSpectatorBet<'info> {
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
        constraint = !betting_pool.is_closed @ PokerError::BettingClosed
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        init,
        payer = bettor,
        space = 8 + std::mem::size_of::<BetRecord>(),
        seeds = [b"bet_record", game_id.to_le_bytes().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet_record: Account<'info, BetRecord>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. `betting_pool.is_closed == false`を確認（`BettingClosed`エラー）
2. `player_choice`が1または2であることを確認（`InvalidAction`エラー）
3. `amount > 0`を確認
4. SOLをベッターからBettingPool PDAに転送
5. BetRecord PDAを作成:
   - `game_id`, `bettor`, `player_choice`, `amount`を設定
   - `claimed = false`
6. BettingPoolを更新:
   - `player_choice == 1`の場合: `total_bet_player1 += amount`（checked_add）
   - `player_choice == 2`の場合: `total_bet_player2 += amount`（checked_add）
   - `bet_count += 1`

**制約**: 1人のベッターにつき1ゲーム1回のベットのみ（BetRecord PDAの一意性による）

#### 4.1.12 `resolve_game(game_id: u64)`

ゲーム終了後、GameVaultから勝者へSOLを分配する。

```rust
#[derive(Accounts)]
pub struct ResolveGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Finished @ PokerError::GameAlreadyCompleted,
        constraint = game.winner.is_some() @ PokerError::GameNotFound,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: GameVault PDA
    #[account(
        mut,
        seeds = [b"game_vault", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game_vault: AccountInfo<'info>,
    /// CHECK: 勝者のウォレット
    #[account(
        mut,
        constraint = winner.key() == game.winner.unwrap() @ PokerError::PermissionDenied
    )]
    pub winner: AccountInfo<'info>,
    /// CHECK: プラットフォーム手数料受取先
    #[account(mut)]
    pub platform_treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. ゲームが`Finished`フェーズであることを確認
2. `winner`が`game.winner`と一致することを確認
3. プラットフォーム手数料を計算: `fee = pot * 2 / 100`（2%）
4. 勝者への送金: `payout = pot - fee`
5. GameVault PDAの署名でSOLを勝者に転送
6. GameVault PDAの署名でSOLをプラットフォームに転送
7. BettingPoolの`winner`フィールドを設定

#### 4.1.13 `claim_betting_reward(game_id: u64)`

観戦者が的中した賭けの報酬を受け取る。

```rust
#[derive(Accounts)]
pub struct ClaimBettingReward<'info> {
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
        constraint = betting_pool.winner.is_some() @ PokerError::GameNotFound,
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        mut,
        seeds = [b"bet_record", game_id.to_le_bytes().as_ref(), bettor.key().as_ref()],
        bump = bet_record.bump,
        constraint = !bet_record.claimed @ PokerError::GameAlreadyCompleted,
        has_one = bettor @ PokerError::PermissionDenied,
    )]
    pub bet_record: Account<'info, BetRecord>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**処理**:
1. ゲームの勝者が決定していることを確認
2. `bet_record.claimed == false`を確認
3. ベッターの予想が的中しているか判定:
   - `betting_pool.winner`がplayer1で`bet_record.player_choice == 1`、または
   - `betting_pool.winner`がplayer2で`bet_record.player_choice == 2`
4. 的中していない場合はエラー（`InvalidAction`）
5. 配当を計算（Pari-mutuel方式）:
   ```
   total_losing_bets = (負けた側の総ベット額)
   total_winning_bets = (勝った側の総ベット額)
   gross_payout = bet_amount + bet_amount * total_losing_bets / total_winning_bets
   platform_fee = gross_payout * 2 / 100
   net_payout = gross_payout - platform_fee
   ```
6. `bet_record.claimed = true`に設定（再入攻撃防止: Effects before Interactions）
7. BettingPool PDAの署名でSOLをベッターに転送
8. プラットフォーム手数料をtreasury宛に転送

---

### 4.2 TEE Instructions

TEE（MagicBlock Private Ephemeral Rollup）内で実行されるinstruction。クライアントはTEE用のRPCエンドポイントに接続して実行する。

#### 4.2.1 `shuffle_and_deal(game_id: u64, random_seed: [u8; 32])`

デッキをVRFでシャッフルし、ホールカードを配布する。

```rust
#[derive(Accounts)]
pub struct ShuffleAndDeal<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Waiting @ PokerError::InvalidAction,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player1.as_ref()],
        bump = player1_state.bump,
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player2.as_ref()],
        bump = player2_state.bump,
    )]
    pub player2_state: Account<'info, PlayerState>,
}
```

**処理**:
1. VRFシードを生成（詳細は第7章参照）:
   ```
   seed = SHA256(random_seed || game_id.to_le_bytes() || player1.to_bytes() || player2.to_bytes())
   ```
2. `game.deck_seed = seed`に保存
3. Fisher-Yatesシャッフルでデッキ（0-51）をシャッフル
4. ホールカード配布:
   - `player1_state.hole_cards = [deck[0], deck[1]]`
   - `player2_state.hole_cards = [deck[2], deck[3]]`
5. `game.phase = GamePhase::PreFlop`に設定
6. `game.current_turn = game.player1`（SBが先手）

#### 4.2.2 `player_action(game_id: u64, action: PlayerAction, amount: Option<u64>)`

プレイヤーのポーカーアクションを処理する。

```rust
#[derive(Accounts)]
pub struct DoPlayerAction<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase != GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = game.phase != GamePhase::Finished @ PokerError::GameAlreadyCompleted,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
        has_one = player @ PokerError::PlayerNotInGame,
    )]
    pub player_state: Account<'info, PlayerState>,
    pub player: Signer<'info>,
}
```

**処理**:
1. `game.current_turn == player.key()`を確認（`NotYourTurn`エラー）
2. `player_state.is_folded == false`を確認
3. アクションに応じた処理:

   **Fold**:
   - `player_state.is_folded = true`
   - 相手プレイヤーを勝者に設定
   - `game.phase = GamePhase::Finished`

   **Check**:
   - 現在のベット額が相手と同額であることを確認
   - ベット額の変更なし

   **Call**:
   - 相手のコミット額との差分を計算
   - `call_amount = opponent_committed - player_committed`
   - `player_state.chips_committed += call_amount`（checked_add）
   - `game.potに反映`（checked_add）

   **Bet**:
   - `amount`が必須（`InvalidAction`エラー）
   - 現在ベットが0であることを確認
   - `player_state.chips_committed += amount`（checked_add）
   - Gameのcommittedフィールドを更新

   **Raise**:
   - `amount`が必須
   - 相手のベット額以上であることを確認（`InvalidRaise`エラー）
   - `raise_amount = amount - opponent_committed + player_committed`
   - `player_state.chips_committed += raise_amount`（checked_add）
   - Gameのcommittedフィールドを更新

   **AllIn**:
   - プレイヤーの残り全チップをコミット
   - `player_state.is_all_in = true`
   - `game.betting_closed = true`（観戦者ベット締め切り）

4. ターンを相手プレイヤーに切り替え
5. 両プレイヤーのコミット額が一致した場合、次のフェーズに進む判定を行う

**AllIn検出時のBettingPool連動**:
- `player_action`内でAllInが実行された場合、Gameの`betting_closed`フラグをtrueに設定
- BettingPool自体はL1上にあるため、TEE内では直接更新しない
- `commit_game`時にBettingPoolの`is_closed`をGameの`betting_closed`と同期する

#### 4.2.3 `reveal_community_cards(game_id: u64, phase: GamePhase)`

フェーズに応じてコミュニティカードを公開する。

```rust
#[derive(Accounts)]
pub struct RevealCommunityCards<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
}
```

**処理**:
1. デッキシャッフル結果からカードを取得（deck_seedから再計算）
2. フェーズに応じてboard_cardsを設定:
   - **Flop**: `board_cards[0..3] = [deck[4], deck[5], deck[6]]`
   - **Turn**: `board_cards[3] = deck[7]`
   - **River**: `board_cards[4] = deck[8]`
3. `game.phase`を更新
4. `player1_committed`と`player2_committed`をリセット（新しいベッティングラウンド）

#### 4.2.4 `commit_game(game_id: u64)`

ゲーム終了後、勝者を決定し、TEEからL1にcommit_and_undelegateする。

```rust
#[derive(Accounts)]
pub struct CommitGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player1.as_ref()],
        bump = player1_state.bump,
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player2.as_ref()],
        bump = player2_state.bump,
    )]
    pub player2_state: Account<'info, PlayerState>,
    pub delegation_program: Program<'info, DelegationProgram>,
}
```

**処理**:
1. Showdownフェーズの場合、ハンド評価を実行:
   - 各プレイヤーの7枚（hole_cards[2] + board_cards[5]）から最強5枚を評価
   - ハンドランキングを比較し勝者を決定
   - 引き分けの場合はポットを二等分
2. `game.winner`を設定
3. `game.phase = GamePhase::Finished`
4. MagicBlock `commit_and_undelegate` CPIを呼び出し:
   - Game, PlayerState (P1), PlayerState (P2)をL1に戻す
   - TEEからの委譲を解除

---

## 5. x402統合の実装

### 5.1 概要

x402プロトコルはSOLによる参加費支払いとして実装する。独立プログラムは作成せず、`enter_matchmaking_queue`と`resolve_game` instructionに統合する。

### 5.2 参加費支払いフロー

```
1. AIエージェントが enter_matchmaking_queue(entry_fee) を実行
   ├── SOLをプレイヤーウォレット → MatchmakingQueue PDAに転送
   └── QueueEntryに entry_fee_paid を記録

2. マッチング成立後、create_game_vault(game_id) を実行
   ├── GameVault PDAを作成
   └── MatchmakingQueue PDA → GameVault PDAにSOL転送（buy_in * 2）

3. ゲーム終了後、resolve_game(game_id) を実行
   ├── GameVault PDA → 勝者ウォレットにSOL転送（pot - fee）
   └── GameVault PDA → Platform TreasuryにSOL転送（fee = pot * 2%）
```

### 5.3 SOL転送の実装パターン

**プレイヤーからPDAへの転送**（`enter_matchmaking_queue`で使用）:
```rust
let ix = anchor_lang::solana_program::system_instruction::transfer(
    &ctx.accounts.player.key(),
    &ctx.accounts.matchmaking_queue.key(),
    entry_fee,
);
anchor_lang::solana_program::program::invoke(
    &ix,
    &[
        ctx.accounts.player.to_account_info(),
        ctx.accounts.matchmaking_queue.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    ],
)?;
```

**PDAからウォレットへの転送**（`resolve_game`で使用）:
```rust
let game_id_bytes = game_id.to_le_bytes();
let seeds = &[b"game_vault", game_id_bytes.as_ref(), &[vault_bump]];
let signer_seeds = &[&seeds[..]];

let ix = anchor_lang::solana_program::system_instruction::transfer(
    &ctx.accounts.game_vault.key(),
    &ctx.accounts.winner.key(),
    payout_amount,
);
anchor_lang::solana_program::program::invoke_signed(
    &ix,
    &[
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.winner.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    ],
    signer_seeds,
)?;
```

### 5.4 返金ロジック

マッチング不成立時の返金は`leave_matchmaking_queue`で処理する:
1. QueueEntryから`entry_fee_paid`を取得
2. MatchmakingQueue PDAの署名でSOLをプレイヤーに転送
3. QueueEntryをNoneに設定

タイムアウトによる返金（将来実装）:
- キュー参加後一定時間（例: 5分）経過してもマッチしない場合
- Clockbased制約でクランク処理可能

---

## 6. Pari-mutuel Bettingの実装

### 6.1 概要

観戦者はゲーム中にどちらのAIエージェントが勝つかを予想してSOLを賭ける。Pari-mutuel方式により、全ベッターの賭け金がプールされ、的中者に比例配分される。

### 6.2 ベットライフサイクル

```
1. initialize_betting_pool: ゲーム作成時にBettingPool PDAを作成
2. place_spectator_bet: 観戦者がベット（複数回の呼び出し）
   - BettingPool.is_closed == false の間のみ受付
3. AllIn検出: player_action内でAllInが発生
   - Game.betting_closed = true
   - commit_game時にBettingPool.is_closed = trueに同期
4. ゲーム終了: commit_game → resolve_game
   - BettingPool.winner = Game.winner
5. claim_betting_reward: 的中した観戦者が個別に報酬をクレーム
```

### 6.3 配当計算式

```
total_pool = total_bet_player1 + total_bet_player2
total_losing_bets = (負けた側の総ベット額)
total_winning_bets = (勝った側の総ベット額)

// 個別ベッターへの配当
gross_payout = bet_amount + (bet_amount * total_losing_bets / total_winning_bets)
platform_fee = gross_payout * 2 / 100   // 2%手数料
net_payout = gross_payout - platform_fee
```

**計算例**:
- Player1に3 SOL、Player2に7 SOLが賭けられた
- Player1が勝利
- Player1に1 SOLを賭けたベッターの配当:
  - `gross_payout = 1 + (1 * 7 / 3) = 1 + 2.333 = 3.333 SOL`
  - `platform_fee = 3.333 * 0.02 = 0.067 SOL`
  - `net_payout = 3.333 - 0.067 = 3.266 SOL`

**整数演算での実装**（lamports単位）:
```rust
let bet_amount: u64 = bet_record.amount;
let total_losing: u64 = if winner_is_player1 {
    betting_pool.total_bet_player2
} else {
    betting_pool.total_bet_player1
};
let total_winning: u64 = if winner_is_player1 {
    betting_pool.total_bet_player1
} else {
    betting_pool.total_bet_player2
};

// オーバーフロー防止: u128にキャストして計算
let winning_share = (bet_amount as u128)
    .checked_mul(total_losing as u128)
    .ok_or(PokerError::PotOverflow)?
    .checked_div(total_winning as u128)
    .ok_or(PokerError::PotOverflow)? as u64;

let gross_payout = bet_amount
    .checked_add(winning_share)
    .ok_or(PokerError::PotOverflow)?;

let platform_fee = gross_payout
    .checked_mul(2)
    .ok_or(PokerError::PotOverflow)?
    .checked_div(100)
    .ok_or(PokerError::PotOverflow)?;

let net_payout = gross_payout
    .checked_sub(platform_fee)
    .ok_or(PokerError::PotOverflow)?;
```

### 6.4 エッジケース

- **全員が同じプレイヤーに賭けた場合**: `total_losing_bets = 0`のため、`winning_share = 0`。元の賭け金から手数料を引いた額が返還される。
- **ベットが0件の場合**: `claim_betting_reward`は呼ばれない。BettingPoolは空のまま。
- **引き分け（ポット分割）の場合**: 全ベッターに元の賭け金から手数料を引いた額を返還。

---

## 7. VRFシャッフルの実装

### 7.1 シード生成

```rust
use anchor_lang::solana_program::hash::hash;

pub fn generate_deck_seed(
    random_seed: &[u8; 32],
    game_id: u64,
    player1: &Pubkey,
    player2: &Pubkey,
) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + 8 + 32 + 32);
    data.extend_from_slice(random_seed);
    data.extend_from_slice(&game_id.to_le_bytes());
    data.extend_from_slice(player1.as_ref());
    data.extend_from_slice(player2.as_ref());
    hash(&data).to_bytes()
}
```

**random_seedの供給元**:
- TEE内で生成される安全な乱数
- MagicBlock PERのランダムネスオラクルを使用
- 両プレイヤーのPubkeyとgame_idを混合することで予測不可能性を強化

### 7.2 Fisher-Yatesシャッフル

```rust
pub fn shuffle_deck(seed: &[u8; 32]) -> [u8; 52] {
    let mut deck: [u8; 52] = core::array::from_fn(|i| i as u8);
    let mut rng_state = *seed;

    for i in (1..52).rev() {
        // シードから擬似乱数を生成
        rng_state = hash(&rng_state).to_bytes();
        let j = (u64::from_le_bytes(rng_state[0..8].try_into().unwrap()) % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }

    deck
}
```

### 7.3 カード配布順序

```
deck[0] = Player1 ホールカード1
deck[1] = Player1 ホールカード2
deck[2] = Player2 ホールカード1
deck[3] = Player2 ホールカード2
deck[4] = フロップ1（バーンなし、簡略化）
deck[5] = フロップ2
deck[6] = フロップ3
deck[7] = ターン
deck[8] = リバー
```

**注**: バーンカードは省略する（AIエージェント対戦のため公平性に影響しない）。

---

## 8. ハンド評価ロジック

### 8.1 概要

7枚のカード（ホールカード2枚 + コミュニティカード5枚）から最強の5枚の組み合わせを評価する。全C(7,5)=21通りの組み合わせを評価し、最強のハンドランクを返す。

### 8.2 ハンドランキング

```rust
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum HandRank {
    HighCard(u32),           // ハイカード + キッカー情報
    OnePair(u32),            // ワンペア + キッカー情報
    TwoPair(u32),            // ツーペア + キッカー情報
    ThreeOfAKind(u32),       // スリーオブアカインド + キッカー情報
    Straight(u8),            // ストレート（最高ランク）
    Flush(u32),              // フラッシュ + ランク情報
    FullHouse(u16),          // フルハウス（スリー + ペア）
    FourOfAKind(u16),        // フォーオブアカインド + キッカー
    StraightFlush(u8),       // ストレートフラッシュ（最高ランク）
    RoyalFlush,              // ロイヤルフラッシュ
}
```

**比較ルール**:
- HandRank enumのvariant順序で強さが決まる（HighCard < OnePair < ... < RoyalFlush）
- 同じvariant内ではu32/u16/u8値で比較（キッカーまで考慮）

### 8.3 キッカーエンコーディング

キッカー情報をu32にパックして同ランクハンドの比較を可能にする:

```rust
// 5枚のカードランクを降順にソートし、各4ビットにパック
pub fn encode_kickers(ranks: &[u8; 5]) -> u32 {
    let mut sorted = *ranks;
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    ((sorted[0] as u32) << 16)
        | ((sorted[1] as u32) << 12)
        | ((sorted[2] as u32) << 8)
        | ((sorted[3] as u32) << 4)
        | (sorted[4] as u32)
}
```

### 8.4 評価アルゴリズム

```rust
pub fn evaluate_hand(hole_cards: &[u8; 2], board_cards: &[u8; 5]) -> HandRank {
    let mut best_rank = HandRank::HighCard(0);

    // 7枚から5枚を選ぶ全21通り
    let all_cards: [u8; 7] = [
        hole_cards[0], hole_cards[1],
        board_cards[0], board_cards[1], board_cards[2],
        board_cards[3], board_cards[4],
    ];

    for combo in combinations_5_of_7(&all_cards) {
        let rank = evaluate_five_cards(&combo);
        if rank > best_rank {
            best_rank = rank;
        }
    }

    best_rank
}
```

### 8.5 特殊ケース: A-2-3-4-5ストレート（ホイール）

Aceは14（最高）としても1（最低、ホイールストレートの場合）としても使用可能:

```rust
fn check_straight(ranks: &[u8; 5]) -> Option<u8> {
    let mut sorted = *ranks;
    sorted.sort_unstable();
    sorted.dedup(); // 重複除去

    if sorted.len() < 5 {
        return None;
    }

    // 通常のストレート判定
    if sorted[4] - sorted[0] == 4 {
        return Some(sorted[4]);
    }

    // ホイール（A-2-3-4-5）判定
    if sorted == [0, 1, 2, 3, 12] {  // 2-3-4-5-A
        return Some(3); // 5がハイ
    }

    None
}
```

---

## 9. エラーコード一覧

```rust
#[error_code]
pub enum PokerError {
    #[msg("Game not found")]
    GameNotFound,                    // 6000

    #[msg("Player is not in this game")]
    PlayerNotInGame,                 // 6001

    #[msg("It is not your turn")]
    NotYourTurn,                     // 6002

    #[msg("Invalid action for the current game state")]
    InvalidAction,                   // 6003

    #[msg("Insufficient chips for this action")]
    InsufficientChips,               // 6004

    #[msg("Betting is closed (all-in occurred)")]
    BettingClosed,                   // 6005

    #[msg("Game has already been completed")]
    GameAlreadyCompleted,            // 6006

    #[msg("Raise amount is less than the minimum")]
    InvalidRaise,                    // 6007

    #[msg("Matchmaking queue is full")]
    QueueFull,                       // 6008

    #[msg("Player is already in the queue")]
    AlreadyInQueue,                  // 6009

    #[msg("Entry fee is below the minimum required")]
    EntryFeeInsufficient,            // 6010

    #[msg("Pot calculation overflow")]
    PotOverflow,                     // 6011

    #[msg("Permission denied")]
    PermissionDenied,                // 6012
}
```

---

## 10. セキュリティ考慮事項

### 10.1 Checks-Effects-Interactions パターン

全てのSOL転送instructionでCEIパターンを厳守する:

```rust
// resolve_game の例
pub fn resolve_game(ctx: Context<ResolveGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // 1. Checks: 状態の検証
    require!(game.phase == GamePhase::Finished, PokerError::InvalidAction);
    require!(game.winner.is_some(), PokerError::GameNotFound);

    // 2. Effects: 状態の更新（転送前に実施）
    let payout = game.pot;
    game.pot = 0; // 再入攻撃防止

    // 3. Interactions: SOL転送
    // ... invoke_signed ...

    Ok(())
}
```

### 10.2 整数オーバーフロー対策

全ての算術演算で`checked_*`メソッドを使用する:

```rust
// 使用するメソッド
let new_pot = game.pot
    .checked_add(bet_amount)
    .ok_or(PokerError::PotOverflow)?;

let fee = payout
    .checked_mul(2)
    .ok_or(PokerError::PotOverflow)?
    .checked_div(100)
    .ok_or(PokerError::PotOverflow)?;
```

`unwrap()`はproductionコードでは禁止。全て`ok_or()`またはパターンマッチで処理する。

### 10.3 再入攻撃対策

- `resolve_game`: `game.pot = 0`を転送前に設定
- `claim_betting_reward`: `bet_record.claimed = true`を転送前に設定
- PDAベースのvaultを使用（外部プログラムへのCPIを最小限にする）

### 10.4 アクセス制御

```rust
// has_one制約でプレイヤーの権限を検証
#[account(
    mut,
    has_one = player @ PokerError::PlayerNotInGame
)]
pub player_state: Account<'info, PlayerState>,
pub player: Signer<'info>,

// constraint制約でゲーム状態の検証
#[account(
    constraint = game.current_turn == player.key() @ PokerError::NotYourTurn
)]
pub game: Account<'info, Game>,
```

### 10.5 PDAバンプの一貫性

全PDAで`bump`フィールドを保存し、再計算を避ける:

```rust
#[account(
    seeds = [b"game", game_id.to_le_bytes().as_ref()],
    bump = game.bump, // 保存されたbumpを使用
)]
pub game: Account<'info, Game>,
```

### 10.6 タイムアウト処理

AIエージェントが30秒以内にアクションしない場合、自動フォールド:
- クランク処理により外部から`player_action(Fold)`を呼び出し可能
- `Clock::get()?.unix_timestamp`と最終アクション時刻の差分で判定
- タイムアウト用の権限をクランクボットに付与

---

## 11. テスト戦略

### 11.1 Anchor Test（TypeScript）

```bash
anchor test
```

**テストファイル構成**:
```
tests/
├── claw-poker.ts              # メインテストスイート
├── matchmaking.test.ts        # マッチメイキングテスト
├── game-lifecycle.test.ts     # ゲームライフサイクルテスト
├── betting.test.ts            # 観戦者ベッティングテスト
├── hand-evaluator.test.ts     # ハンド評価テスト
└── security.test.ts           # セキュリティテスト
```

**テストケース例**:

```typescript
// game-lifecycle.test.ts
describe("Game Lifecycle", () => {
  it("initializes matchmaking queue", async () => { ... });
  it("allows two players to enter queue and match", async () => { ... });
  it("creates game and vault after match", async () => { ... });
  it("sets up permissions and delegates to TEE", async () => { ... });
  it("shuffles and deals cards", async () => { ... });
  it("processes player actions (fold/check/call/raise/all-in)", async () => { ... });
  it("reveals community cards per phase", async () => { ... });
  it("commits game and determines winner", async () => { ... });
  it("resolves game and distributes SOL", async () => { ... });
  it("rejects actions from wrong player", async () => { ... });
  it("rejects actions after game is finished", async () => { ... });
  it("handles timeout auto-fold", async () => { ... });
});
```

### 11.2 LiteSVM / Surfpoolでの高速テスト

ローカル開発では`surfpool start`で高速バリデータを使用:

```bash
# Surfpool起動
surfpool start

# ビルド・デプロイ
anchor build && anchor deploy --provider.cluster localnet

# テスト実行
anchor test --skip-local-validator
```

**LiteSVMテスト**（Rustネイティブテスト）:
```rust
#[cfg(test)]
mod tests {
    use litesvm::LiteSVM;

    #[test]
    fn test_hand_evaluation() {
        // ハンド評価ロジックの単体テスト（SVM不要）
        let hole = [0u8, 12]; // 2S, AS
        let board = [13, 25, 38, 7, 20]; // 2H, 2D, 2C, 9S, 8H
        let rank = evaluate_hand(&hole, &board);
        assert!(matches!(rank, HandRank::FourOfAKind(_)));
    }

    #[test]
    fn test_shuffle_determinism() {
        let seed = [42u8; 32];
        let deck1 = shuffle_deck(&seed);
        let deck2 = shuffle_deck(&seed);
        assert_eq!(deck1, deck2); // 同じシードなら同じ結果
    }
}
```

### 11.3 PER統合テスト

MagicBlock PERとの統合テストは以下の手順で実施:

1. **ローカルPER環境**: MagicBlock CLIでローカルPERノードを起動
2. **委譲テスト**: Game/PlayerStateのTEE委譲・解除フロー
3. **ACLテスト**: 他プレイヤーのPlayerStateへのアクセス拒否を確認
4. **commit_and_undelegateテスト**: TEEからL1への状態コミット

```typescript
// per-integration.test.ts
describe("PER Integration", () => {
  it("delegates game account to TEE", async () => {
    // L1で接続してdelegate_game実行
    // TEE接続でgameアカウントが読み取れることを確認
  });

  it("prevents unauthorized access to player state", async () => {
    // Player2がPlayer1のPlayerStateにアクセスしようとして失敗
  });

  it("commits game state back to L1", async () => {
    // TEEでcommit_game実行
    // L1でgame.winnerが設定されていることを確認
  });
});
```

### 11.4 セキュリティテスト

```typescript
describe("Security", () => {
  it("prevents double claiming of betting rewards", async () => { ... });
  it("prevents betting after all-in", async () => { ... });
  it("validates signer authority on all instructions", async () => { ... });
  it("handles integer overflow gracefully", async () => { ... });
  it("prevents resolve_game from being called twice", async () => { ... });
});
```

---

## 12. トランザクションフロー全体図

### 12.1 ゲーム開始フロー（L1）

```
Step 1: initialize_matchmaking_queue()     [一度のみ]
Step 2: enter_matchmaking_queue(fee)       [Player1]
Step 3: enter_matchmaking_queue(fee)       [Player2 → マッチング成立]
Step 4: initialize_game(game_id, p1, p2, buy_in)
Step 5: create_game_vault(game_id)
Step 6: initialize_betting_pool(game_id)
Step 7: create_permission_game(game_id)
Step 8: create_permission_player1(game_id)
Step 9: create_permission_player2(game_id)
Step 10: delegate_game(game_id)
Step 11: delegate_player1(game_id)
Step 12: delegate_player2(game_id)
```

### 12.2 ゲーム進行フロー（TEE）

```
Step 13: shuffle_and_deal(game_id, seed)   [ディーラー/クランク]
--- PreFlop ---
Step 14: player_action(game_id, ...)       [Player1 (SB)]
Step 15: player_action(game_id, ...)       [Player2 (BB)]
         ... (ベッティングラウンド)

Step 16: reveal_community_cards(game_id, Flop)
--- Flop ---
Step 17-N: player_action(game_id, ...)     [交互にアクション]

Step N+1: reveal_community_cards(game_id, Turn)
--- Turn ---
Step N+2-M: player_action(game_id, ...)

Step M+1: reveal_community_cards(game_id, River)
--- River ---
Step M+2-P: player_action(game_id, ...)

Step P+1: commit_game(game_id)             [Showdownまたはフォールド後]
```

### 12.3 決済フロー（L1）

```
Step P+2: resolve_game(game_id)            [勝者へSOL転送]
Step P+3: claim_betting_reward(game_id)    [各観戦者が個別にクレーム]
```

### 12.4 並行処理: 観戦者ベット（L1）

ゲーム進行中に並行して受付:
```
place_spectator_bet(game_id, 1, amount)    [Player1に賭ける]
place_spectator_bet(game_id, 2, amount)    [Player2に賭ける]
... (AllIn発生で締め切り)
```

---

**Document Version**: 2.0
**Last Updated**: 2026-02-22
**Status**: Ready for Implementation
