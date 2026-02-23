use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
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
