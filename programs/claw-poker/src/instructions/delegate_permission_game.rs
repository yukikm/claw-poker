use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::DelegatePermissionCpiBuilder;
use ephemeral_rollups_sdk::anchor::DelegationProgram;
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use crate::state::Game;

pub fn handler(ctx: Context<DelegatePermissionGame>, game_id: u64) -> Result<()> {
    let game = &ctx.accounts.game;
    let game_id_bytes = game_id.to_le_bytes();
    let bump = game.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"game", game_id_bytes.as_ref(), &[bump]]];

    DelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
        .payer(&ctx.accounts.payer.to_account_info())
        .authority(&ctx.accounts.payer.to_account_info(), false)
        .permissioned_account(&ctx.accounts.game.to_account_info(), true)
        .permission(&ctx.accounts.permission)
        .system_program(&ctx.accounts.system_program.to_account_info())
        .owner_program(&ctx.accounts.permission_program)
        .delegation_buffer(&ctx.accounts.delegation_buffer)
        .delegation_record(&ctx.accounts.delegation_record)
        .delegation_metadata(&ctx.accounts.delegation_metadata)
        .delegation_program(&ctx.accounts.delegation_program.to_account_info())
        .validator(Some(&ctx.accounts.validator))
        .invoke_signed(signer_seeds)
        .map_err(Into::into)
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegatePermissionGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: Permission PDA（Game用、permission_programが導出）
    #[account(mut)]
    pub permission: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: TEE Validator（Devnet: FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA）
    pub validator: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲バッファPDA
    #[account(mut)]
    pub delegation_buffer: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲レコードPDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲メタデータPDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}
