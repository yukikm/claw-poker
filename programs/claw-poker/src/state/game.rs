use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Game {
    /// ゲーム識別子（u64）
    pub game_id: u64,
    /// オペレーター（TEE/PERオペレーター）のアドレス
    pub operator: Pubkey,
    /// プラットフォーム手数料受取先（initialize_gameで固定）
    pub platform_treasury: Pubkey,
    /// Player 1のウォレットアドレス
    pub player1: Pubkey,
    /// Player 2のウォレットアドレス
    pub player2: Pubkey,
    /// 参加費（lamports単位）
    pub buy_in: u64,
    /// 現在のポット合計（チップ単位）
    pub pot: u64,
    /// 現在のターンを持つプレイヤー
    pub current_turn: Pubkey,
    /// 現在のゲームフェーズ
    pub phase: GamePhase,
    /// コミュニティカード（0-51エンコード、未公開は255）
    pub board_cards: [u8; 5],
    /// VRFシャッフル用コミットメント（SHA256(deck_seed)）
    pub deck_commitment: [u8; 32],
    /// Player 1の現ラウンドのコミット額
    pub player1_committed: u64,
    /// Player 2の現ラウンドのコミット額
    pub player2_committed: u64,
    /// 現在のハンド番号（1始まり、shuffle_and_dealでインクリメント）
    pub hand_number: u64,
    /// ディーラー位置（0=Player1がSB/ディーラー, 1=Player2がSB/ディーラー）
    pub dealer_position: u8,
    /// 現在のスモールブラインド額（チップ単位）
    pub current_small_blind: u64,
    /// 現在のビッグブラインド額（チップ単位）
    pub current_big_blind: u64,
    /// Player1の総チップ数（ゲーム通算、chip_conservation invariant: p1+p2==2000）
    pub player1_chip_stack: u64,
    /// Player2の総チップ数（ゲーム通算）
    pub player2_chip_stack: u64,
    /// Player1の連続タイムアウト回数（3回で没収）
    pub consecutive_timeouts_p1: u8,
    /// Player2の連続タイムアウト回数（3回で没収）
    pub consecutive_timeouts_p2: u8,
    /// 最後のレイズ額（ミニマムレイズ計算用）
    pub last_raise_amount: u64,
    /// 最後にL1チェックポイントしたハンド番号（50ハンドごとにcommit）
    pub last_checkpoint_hand: u64,
    /// 勝者（決定前はNone）
    pub winner: Option<Pubkey>,
    /// オールイン発生でtrueになり、観戦者ベットを締め切る
    pub betting_closed: bool,
    /// 現ストリートで最初のアクションが発生したかを追跡
    /// （River Check-Check誤Showdown遷移防止用）
    pub street_action_taken: bool,
    /// 最後にプレイヤーがアクションを行った時刻（Unix timestamp）
    pub last_action_at: i64,
    /// ゲーム作成時刻（Unix timestamp）
    pub created_at: i64,
    /// All-in showdown時に公開するPlayer1のホールカード（未公開時は[255, 255]）
    pub showdown_cards_p1: [u8; 2],
    /// All-in showdown時に公開するPlayer2のホールカード（未公開時は[255, 255]）
    pub showdown_cards_p2: [u8; 2],
    /// Player1がフォールドしたか（ハンド終了時にリセット）
    pub player1_has_folded: bool,
    /// Player2がフォールドしたか（ハンド終了時にリセット）
    pub player2_has_folded: bool,
    /// Player1がオールインしたか（ハンド終了時にリセット）
    pub player1_is_all_in: bool,
    /// Player2がオールインしたか（ハンド終了時にリセット）
    pub player2_is_all_in: bool,
    /// PDAバンプ
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GamePhase {
    Waiting,
    Shuffling,
    PreFlop,
    Flop,
    Turn,
    River,
    Showdown,
    Finished,
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
