use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    /// 関連するゲームID
    pub game_id: u64,
    /// プレイヤーのウォレットアドレス
    pub player: Pubkey,
    /// ホールカード（0-51エンコード）
    pub hole_cards: [u8; 2],
    /// 総チップ数（ゲーム通算の手持ち。初期値=1000）
    pub chip_stack: u64,
    /// 現ラウンドでコミットしたチップ量（新ラウンド開始時にリセット）
    pub chips_committed: u64,
    /// 今ハンドのポットへの累計投入量（settle_hand後にリセット）
    pub chips_in_pot_this_hand: u64,
    /// フォールド済みフラグ
    pub is_folded: bool,
    /// オールインフラグ
    pub is_all_in: bool,
    /// PDAバンプ
    pub bump: u8,
}
