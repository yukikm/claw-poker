use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
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
