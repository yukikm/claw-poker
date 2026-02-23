use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};
use crate::state::{Game, GamePhase, PlayerState};
use crate::errors::PokerError;

pub fn handler(ctx: Context<CommitGame>, _game_id: u64) -> Result<()> {
    let game = &ctx.accounts.game;

    let account_infos = vec![
        ctx.accounts.game.as_ref(),
        ctx.accounts.player1_state.as_ref(),
        ctx.accounts.player2_state.as_ref(),
    ];

    if game.phase == GamePhase::Finished {
        // ゲーム終了: 最終状態をL1にコミットしてER委譲を解除
        require!(game.winner.is_some(), PokerError::GameNotFound);
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            account_infos,
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
    } else {
        // 中間チェックポイント（50ハンドごと）: L1にコミットしER委譲を継続
        commit_accounts(
            &ctx.accounts.payer,
            account_infos,
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CommitGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub operator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player1.as_ref()],
        bump = player1_state.bump,
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player2.as_ref()],
        bump = player2_state.bump,
    )]
    pub player2_state: Account<'info, PlayerState>,
    /// CHECK: MagicBlock Magic Context
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Program
    pub magic_program: AccountInfo<'info>,
}
