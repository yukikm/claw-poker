use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};
use ephemeral_rollups_sdk::access_control::instructions::CommitAndUndelegatePermissionCpiBuilder;
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
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

        // Player1/Player2のPermission PDAもundelegate
        let p1_state_info = ctx.accounts.player1_state.to_account_info();
        let p1_bump = ctx.accounts.player1_state.bump;
        let p1_key = game.player1;
        let game_id_bytes = game.game_id.to_le_bytes();

        let p1_seeds: &[&[u8]] = &[
            b"player_state",
            game_id_bytes.as_ref(),
            p1_key.as_ref(),
            &[p1_bump],
        ];

        CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .authority(&p1_state_info, true)
            .permissioned_account(&p1_state_info, true)
            .permission(&ctx.accounts.permission_p1)
            .magic_program(&ctx.accounts.magic_program)
            .magic_context(&ctx.accounts.magic_context)
            .invoke_signed(&[p1_seeds])?;

        let p2_state_info = ctx.accounts.player2_state.to_account_info();
        let p2_bump = ctx.accounts.player2_state.bump;
        let p2_key = game.player2;

        let p2_seeds: &[&[u8]] = &[
            b"player_state",
            game_id_bytes.as_ref(),
            p2_key.as_ref(),
            &[p2_bump],
        ];

        CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .authority(&p2_state_info, true)
            .permissioned_account(&p2_state_info, true)
            .permission(&ctx.accounts.permission_p2)
            .magic_program(&ctx.accounts.magic_program)
            .magic_context(&ctx.accounts.magic_context)
            .invoke_signed(&[p2_seeds])?;

        // Game PermissionのPDAもundelegate
        let game_info = ctx.accounts.game.to_account_info();
        let game_seeds: &[&[u8]] = &[
            b"game",
            game_id_bytes.as_ref(),
            &[game.bump],
        ];

        CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .authority(&ctx.accounts.payer.to_account_info(), false)
            .permissioned_account(&game_info, true)
            .permission(&ctx.accounts.permission_game)
            .magic_program(&ctx.accounts.magic_program)
            .magic_context(&ctx.accounts.magic_context)
            .invoke_signed(&[game_seeds])?;
    } else {
        // 中間チェックポイント（50ハンドごと）: ハンドが進行中でないことを確認
        require!(
            game.phase == GamePhase::Waiting,
            PokerError::InvalidAction
        );
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
    /// CHECK: Player1のPermission PDA
    #[account(mut)]
    pub permission_p1: AccountInfo<'info>,
    /// CHECK: Player2のPermission PDA
    #[account(mut)]
    pub permission_p2: AccountInfo<'info>,
    /// CHECK: GameのPermission PDA
    #[account(mut)]
    pub permission_game: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Context
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Program
    pub magic_program: AccountInfo<'info>,
}
