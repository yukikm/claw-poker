use anchor_lang::prelude::*;
use crate::state::{BettingPool, Game};
use crate::errors::PokerError;

pub fn handler(ctx: Context<CloseBettingPool>, _game_id: u64) -> Result<()> {
    let pool = &mut ctx.accounts.betting_pool;
    pool.is_closed = true;
    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CloseBettingPool<'info> {
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
        constraint = !betting_pool.is_closed @ PokerError::BettingClosed
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    pub operator: Signer<'info>,
}
