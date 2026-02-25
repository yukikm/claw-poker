use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::anchor::DelegationProgram;
use crate::state::PlayerState;

pub fn handler_player1(ctx: Context<DelegatePlayer1>, game_id: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let game_id_bytes = game_id.to_le_bytes();
    let pda_seeds: &[&[u8]] = &[
        b"player_state",
        game_id_bytes.as_ref(),
        player_key.as_ref(),
    ];

    delegate_account(
        DelegateAccounts {
            payer: &ctx.accounts.payer,
            pda: ctx.accounts.player_state.as_ref(),
            owner_program: &ctx.accounts.owner_program,
            buffer: &ctx.accounts.buffer,
            delegation_record: &ctx.accounts.delegation_record,
            delegation_metadata: &ctx.accounts.delegation_metadata,
            delegation_program: &ctx.accounts.delegation_program,
            system_program: ctx.accounts.system_program.as_ref(),
        },
        pda_seeds,
        DelegateConfig {
            validator: Some(ctx.accounts.validator.key()),
            ..Default::default()
        },
    )?;

    Ok(())
}

pub fn handler_player2(ctx: Context<DelegatePlayer2>, game_id: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let game_id_bytes = game_id.to_le_bytes();
    let pda_seeds: &[&[u8]] = &[
        b"player_state",
        game_id_bytes.as_ref(),
        player_key.as_ref(),
    ];

    delegate_account(
        DelegateAccounts {
            payer: &ctx.accounts.payer,
            pda: ctx.accounts.player_state.as_ref(),
            owner_program: &ctx.accounts.owner_program,
            buffer: &ctx.accounts.buffer,
            delegation_record: &ctx.accounts.delegation_record,
            delegation_metadata: &ctx.accounts.delegation_metadata,
            delegation_program: &ctx.accounts.delegation_program,
            system_program: ctx.accounts.system_program.as_ref(),
        },
        pda_seeds,
        DelegateConfig {
            validator: Some(ctx.accounts.validator.key()),
            ..Default::default()
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegatePlayer1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Player 1のアドレス参照のみ（TEEオペレーターが信頼された代理として委譲）
    pub player: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: このプログラムのID
    #[account(address = crate::ID)]
    pub owner_program: AccountInfo<'info>,
    /// CHECK: TEE Validator
    pub validator: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲バッファPDA
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
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
pub struct DelegatePlayer2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Player 2のアドレス参照のみ（TEEオペレーターが信頼された代理として委譲）
    pub player: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: このプログラムのID
    #[account(address = crate::ID)]
    pub owner_program: AccountInfo<'info>,
    /// CHECK: TEE Validator
    pub validator: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲バッファPDA
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲レコードPDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: MagicBlock委譲メタデータPDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}
