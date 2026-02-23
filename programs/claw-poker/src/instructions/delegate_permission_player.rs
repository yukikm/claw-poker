use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::DelegatePermissionCpiBuilder;
use ephemeral_rollups_sdk::anchor::DelegationProgram;
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use crate::state::PlayerState;

fn delegate_permission_for_player<'info>(
    player_state: &Account<'info, PlayerState>,
    permission: &AccountInfo<'info>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
    permission_program: &AccountInfo<'info>,
    delegation_buffer: &AccountInfo<'info>,
    delegation_record: &AccountInfo<'info>,
    delegation_metadata: &AccountInfo<'info>,
    delegation_program: &Program<'info, DelegationProgram>,
    validator: &AccountInfo<'info>,
    player_key: Pubkey,
    game_id: u64,
    player_bump: u8,
) -> Result<()> {
    let game_id_bytes = game_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"player_state",
        game_id_bytes.as_ref(),
        player_key.as_ref(),
        &[player_bump],
    ]];

    DelegatePermissionCpiBuilder::new(permission_program)
        .payer(&payer.to_account_info())
        .authority(&payer.to_account_info(), false)
        .permissioned_account(&player_state.to_account_info(), true)
        .permission(permission)
        .system_program(&system_program.to_account_info())
        .owner_program(permission_program)
        .delegation_buffer(delegation_buffer)
        .delegation_record(delegation_record)
        .delegation_metadata(delegation_metadata)
        .delegation_program(&delegation_program.to_account_info())
        .validator(Some(validator))
        .invoke_signed(signer_seeds)
        .map_err(Into::into)
}

pub fn handler_player1(ctx: Context<DelegatePermissionPlayer1>, game_id: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let bump = ctx.accounts.player_state.bump;
    delegate_permission_for_player(
        &ctx.accounts.player_state,
        &ctx.accounts.permission,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
        &ctx.accounts.permission_program,
        &ctx.accounts.delegation_buffer,
        &ctx.accounts.delegation_record,
        &ctx.accounts.delegation_metadata,
        &ctx.accounts.delegation_program,
        &ctx.accounts.validator,
        player_key,
        game_id,
        bump,
    )
}

pub fn handler_player2(ctx: Context<DelegatePermissionPlayer2>, game_id: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let bump = ctx.accounts.player_state.bump;
    delegate_permission_for_player(
        &ctx.accounts.player_state,
        &ctx.accounts.permission,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
        &ctx.accounts.permission_program,
        &ctx.accounts.delegation_buffer,
        &ctx.accounts.delegation_record,
        &ctx.accounts.delegation_metadata,
        &ctx.accounts.delegation_program,
        &ctx.accounts.validator,
        player_key,
        game_id,
        bump,
    )
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegatePermissionPlayer1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Player 1のアカウント（アドレス参照のみ）
    pub player: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: Permission PDA（PlayerState用、permission_programが導出）
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

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegatePermissionPlayer2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Player 2のアカウント（アドレス参照のみ）
    pub player: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: Permission PDA（PlayerState用、permission_programが導出）
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
