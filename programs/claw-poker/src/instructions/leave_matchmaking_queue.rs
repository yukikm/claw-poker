use anchor_lang::prelude::*;
use crate::state::MatchmakingQueue;
use crate::errors::PokerError;

/// キューからプレイヤーを削除し、エントリーを記録から消す。
/// x402フローでは参加費のSOLはx402プロトコル側が管理するため、
/// このインストラクションはキュー登録の取り消しのみを行う。
/// enter_matchmaking_queueと同様にoperatorが代理で呼び出す。
pub fn handler(ctx: Context<LeaveMatchmakingQueue>) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let queue = &mut ctx.accounts.matchmaking_queue;

    // プレイヤーがキューに存在することを確認し、エントリーを取得
    let mut found_index: Option<usize> = None;

    for (i, entry) in queue.queue.iter().enumerate() {
        if let Some(e) = entry {
            if e.player == player_key {
                found_index = Some(i);
                break;
            }
        }
    }

    let index = found_index.ok_or(PokerError::PlayerNotInGame)?;

    // キューからエントリーを削除（Noneに設定）
    queue.queue[index] = None;

    // 注意: 参加費のSOL返金はx402プロトコル側で処理される。
    // このインストラクションはオンチェーンのキューエントリー削除のみを担当する。

    Ok(())
}

#[derive(Accounts)]
pub struct LeaveMatchmakingQueue<'info> {
    #[account(
        mut,
        seeds = [b"matchmaking_queue"],
        bump = matchmaking_queue.bump,
        constraint = operator.key() == matchmaking_queue.operator @ PokerError::PermissionDenied,
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    /// CHECK: キューから削除するプレイヤーのアドレス（operatorが代理で呼び出す）
    pub player: AccountInfo<'info>,
    /// オペレーターが代理でキュー離脱を実行する
    pub operator: Signer<'info>,
}
