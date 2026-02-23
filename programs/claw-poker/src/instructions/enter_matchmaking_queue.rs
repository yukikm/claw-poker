use anchor_lang::prelude::*;
use crate::state::{MatchmakingQueue, QueueEntry};
use crate::errors::PokerError;

pub const MIN_ENTRY_FEE: u64 = 1_000_000; // 0.001 SOL

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

    // --- SOL転送（system_instructionを直接使用） ---
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &player_key,
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
        bump = matchmaking_queue.bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}
