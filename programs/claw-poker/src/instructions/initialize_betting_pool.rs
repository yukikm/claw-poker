use anchor_lang::prelude::*;
use crate::state::{BettingPool, Game};

pub fn handler(ctx: Context<InitializeBettingPool>, game_id: u64) -> Result<()> {
    let pool = &mut ctx.accounts.betting_pool;
    pool.game_id = game_id;
    pool.total_bet_player1 = 0;
    pool.total_bet_player2 = 0;
    pool.is_closed = false;
    pool.winner = None;
    pool.distributed = false;
    pool.bet_count = 0;
    pool.bump = ctx.bumps.betting_pool;
    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct InitializeBettingPool<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + BettingPool::INIT_SPACE,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
