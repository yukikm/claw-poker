use anchor_lang::prelude::*;
use crate::state::{MatchmakingQueue, QueueEntry};
use crate::errors::PokerError;

pub const MIN_ENTRY_FEE: u64 = 1_000_000; // 0.001 SOL

/// x402プロトコルによる支払い後にオペレーターが呼び出す。
/// SOL転送はx402が担当するため、このインストラクションはキュー登録のみ行う。
pub fn handler(ctx: Context<EnterMatchmakingQueue>, entry_fee: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();

    // --- 検証フェーズ（immutable borrow） ---
    {
        let queue = &ctx.accounts.matchmaking_queue;
        let count = queue.queue.iter().filter(|e| e.is_some()).count();
        require!(count < 10, PokerError::QueueFull);

        for entry in queue.queue.iter() {
            if let Some(e) = entry {
                require!(e.player != player_key, PokerError::AlreadyInQueue);
            }
        }
    }

    require!(entry_fee >= MIN_ENTRY_FEE, PokerError::EntryFeeInsufficient);

    // SOL転送はx402プロトコルが担当。このインストラクションはキュー登録のみ。

    // --- 空スロットにQueueEntryを追加（mutable borrow） ---
    let clock = Clock::get()?;
    let queue = &mut ctx.accounts.matchmaking_queue;
    let insert_index = queue.queue.iter().position(|e| e.is_none())
        .ok_or(PokerError::QueueFull)?;
    queue.queue[insert_index] = Some(QueueEntry {
        player: player_key,
        entry_fee_paid: entry_fee,
        joined_at: clock.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct EnterMatchmakingQueue<'info> {
    #[account(
        mut,
        seeds = [b"matchmaking_queue"],
        bump = matchmaking_queue.bump,
        constraint = operator.key() == matchmaking_queue.operator @ PokerError::PermissionDenied,
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    /// プレイヤーアカウント（署名不要、operatorが代理で呼び出す）
    /// CHECK: x402支払い済みプレイヤーのウォレットアドレス
    pub player: AccountInfo<'info>,
    /// オペレーター（x402支払い検証後にキュー登録を行う権限者）
    pub operator: Signer<'info>,
}
