use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct QueueEntry {
    /// プレイヤーのウォレットアドレス
    pub player: Pubkey,
    /// 支払い済み参加費（lamports）
    pub entry_fee_paid: u64,
    /// キュー参加時刻（Unix timestamp）
    pub joined_at: i64,
}
