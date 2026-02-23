use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::anchor::DelegationProgram;
use crate::state::Game;

pub fn handler(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
    let game_id_bytes = game_id.to_le_bytes();
    // pda_seeds は bump を含まない（内部で計算される）
    let pda_seeds: &[&[u8]] = &[b"game", game_id_bytes.as_ref()];

    delegate_account(
        DelegateAccounts {
            payer: &ctx.accounts.payer,
            pda: ctx.accounts.game.as_ref(),
            owner_program: &ctx.accounts.owner_program,
            buffer: &ctx.accounts.buffer,
            delegation_record: &ctx.accounts.delegation_record,
            delegation_metadata: &ctx.accounts.delegation_metadata,
            delegation_program: &ctx.accounts.delegation_program,
            system_program: ctx.accounts.system_program.as_ref(),
        },
        pda_seeds,
        DelegateConfig::default(),
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: このプログラムのID
    pub owner_program: AccountInfo<'info>,
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
