use anchor_lang::prelude::*;
use crate::state::MatchmakingQueue;
use crate::errors::PokerError;

pub fn handler(ctx: Context<LeaveMatchmakingQueue>) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let queue = &mut ctx.accounts.matchmaking_queue;

    // プレイヤーがキューに存在することを確認し、エントリーを取得
    let mut found_index: Option<usize> = None;
    let mut entry_fee_paid: u64 = 0;

    for (i, entry) in queue.queue.iter().enumerate() {
        if let Some(e) = entry {
            if e.player == player_key {
                found_index = Some(i);
                entry_fee_paid = e.entry_fee_paid;
                break;
            }
        }
    }

    let index = found_index.ok_or(PokerError::PlayerNotInGame)?;

    // キューからエントリーを削除（Noneに設定）
    queue.queue[index] = None;

    // MatchmakingQueue PDAからプレイヤーにSOLを返金（直接lamport操作）
    **ctx.accounts.matchmaking_queue.to_account_info().try_borrow_mut_lamports()? -= entry_fee_paid;
    **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += entry_fee_paid;

    Ok(())
}

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
}
