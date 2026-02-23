use anchor_lang::prelude::*;
use crate::state::MatchmakingQueue;

pub fn handler(ctx: Context<InitializeMatchmakingQueue>, operator: Pubkey) -> Result<()> {
    let queue = &mut ctx.accounts.matchmaking_queue;
    queue.queue = [None; 10];
    queue.head = 0;
    queue.tail = 0;
    queue.bump = ctx.bumps.matchmaking_queue;
    queue.operator = operator;
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
    /// オペレーターアカウント（アクセス制御用）
    pub operator: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}
