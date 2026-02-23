use anchor_lang::prelude::*;
use crate::state::MatchmakingQueue;

pub fn handler(ctx: Context<InitializeMatchmakingQueue>) -> Result<()> {
    let queue = &mut ctx.accounts.matchmaking_queue;
    queue.queue = [None; 10];
    queue.head = 0;
    queue.tail = 0;
    queue.bump = ctx.bumps.matchmaking_queue;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMatchmakingQueue<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MatchmakingQueue::INIT_SPACE,
        seeds = [b"matchmaking_queue"],
        bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
