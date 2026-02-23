use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::Game;

pub fn handler(ctx: Context<CreateGameVault>, _game_id: u64) -> Result<()> {
    let game = &ctx.accounts.game;
    let buy_in_total = game
        .buy_in
        .checked_mul(2)
        .ok_or(crate::errors::PokerError::PotOverflow)?;

    // x402でオペレーターウォレットに受け取ったSOLをGameVaultに転送
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.operator.to_account_info(),
            to: ctx.accounts.game_vault.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, buy_in_total)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGameVault<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = operator.key() == game.operator @ crate::errors::PokerError::PermissionDenied,
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
    /// オペレーター: x402で受け取ったSOLを保持し、GameVaultに転送する
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
