use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermission, CreatePermissionInstructionArgs,
};
use ephemeral_rollups_sdk::access_control::structs::MembersArgs;
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use crate::state::Game;

pub fn handler(ctx: Context<CreatePermissionGame>, game_id: u64) -> Result<()> {
    let game = &ctx.accounts.game;

    let ix = CreatePermission {
        permissioned_account: ctx.accounts.game.key(),
        permission: ctx.accounts.permission.key(),
        payer: ctx.accounts.payer.key(),
        system_program: System::id(),
    }
    .instruction(CreatePermissionInstructionArgs {
        args: MembersArgs { members: None }, // パブリック: 観戦者含め全員が読める
    });

    let game_id_bytes = game_id.to_le_bytes();
    let bump = game.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"game", game_id_bytes.as_ref(), &[bump]]];

    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.permission_program.to_account_info(),
            ctx.accounts.game.to_account_info(),
            ctx.accounts.permission.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreatePermissionGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: MagicBlock Permission PDA（自動導出）
    #[account(mut)]
    pub permission: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
