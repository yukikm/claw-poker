use anchor_lang::prelude::*;
use crate::state::{Game, MatchmakingQueue};

pub fn handler(ctx: Context<CreateGameVault>, _game_id: u64) -> Result<()> {
    let game = &ctx.accounts.game;
    let buy_in_total = game
        .buy_in
        .checked_mul(2)
        .ok_or(crate::errors::PokerError::PotOverflow)?;

    // matchmaking_queueはclaw-pokerプログラム所有のPDAなので直接lamport操作を使用
    **ctx.accounts.matchmaking_queue.to_account_info().try_borrow_mut_lamports()? -= buy_in_total;
    **ctx.accounts.game_vault.to_account_info().try_borrow_mut_lamports()? += buy_in_total;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGameVault<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: GameVault PDA（SOLを保持するだけ）
    #[account(
        init,
        payer = payer,
        space = 0,
        seeds = [b"game_vault", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"matchmaking_queue"],
        bump = matchmaking_queue.bump
    )]
    pub matchmaking_queue: Account<'info, MatchmakingQueue>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
