use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};
use ephemeral_rollups_sdk::access_control::instructions::CommitAndUndelegatePermissionCpiBuilder;
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use crate::state::{Game, GamePhase, PlayerState};
use crate::errors::PokerError;

pub fn handler(ctx: Context<CommitGame>, _game_id: u64) -> Result<()> {
    // phaseとwinnerをコピーしてimmutable borrowを終了させる
    let phase = ctx.accounts.game.phase.clone();
    let winner = ctx.accounts.game.winner;

    if phase == GamePhase::Finished {
        require!(winner.is_some(), PokerError::GameNotFound);

        // ホールカードをクリア（プライバシー保護: L1への露出防止）
        ctx.accounts.player1_state.hole_cards = [255u8; 2];
        ctx.accounts.player2_state.hole_cards = [255u8; 2];
        // showdownカードもクリア（L1への露出防止）
        ctx.accounts.game.showdown_cards_p1 = [255u8; 2];
        ctx.accounts.game.showdown_cards_p2 = [255u8; 2];
        // deal_cardsもクリア（L1への露出防止）
        ctx.accounts.game.deal_cards = [255u8; 8];

        // mutable変更後にimmutable借用
        let account_infos = vec![
            ctx.accounts.game.as_ref(),
            ctx.accounts.player1_state.as_ref(),
            ctx.accounts.player2_state.as_ref(),
        ];

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            account_infos,
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        // Permission undelegateに必要な値をコピー
        let p1_state_info = ctx.accounts.player1_state.to_account_info();
        let p2_state_info = ctx.accounts.player2_state.to_account_info();
        let game_info = ctx.accounts.game.to_account_info();
        let game_id_bytes = ctx.accounts.game.game_id.to_le_bytes();
        let p1_key = ctx.accounts.game.player1;
        let p2_key = ctx.accounts.game.player2;
        let game_bump = ctx.accounts.game.bump;
        let p1_bump = ctx.accounts.player1_state.bump;
        let p2_bump = ctx.accounts.player2_state.bump;

        // P1 Permission undelegate
        {
            let p1_bump_arr = [p1_bump];
            let p1_seeds: &[&[u8]] = &[
                b"player_state",
                &game_id_bytes,
                p1_key.as_ref(),
                &p1_bump_arr,
            ];
            CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
                .authority(&p1_state_info, true)
                .permissioned_account(&p1_state_info, true)
                .permission(&ctx.accounts.permission_p1)
                .magic_program(&ctx.accounts.magic_program)
                .magic_context(&ctx.accounts.magic_context)
                .invoke_signed(&[p1_seeds])?;
        }

        // P2 Permission undelegate
        {
            let p2_bump_arr = [p2_bump];
            let p2_seeds: &[&[u8]] = &[
                b"player_state",
                &game_id_bytes,
                p2_key.as_ref(),
                &p2_bump_arr,
            ];
            CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
                .authority(&p2_state_info, true)
                .permissioned_account(&p2_state_info, true)
                .permission(&ctx.accounts.permission_p2)
                .magic_program(&ctx.accounts.magic_program)
                .magic_context(&ctx.accounts.magic_context)
                .invoke_signed(&[p2_seeds])?;
        }

        // Game Permission undelegate
        {
            let game_bump_arr = [game_bump];
            let game_seeds: &[&[u8]] = &[
                b"game",
                &game_id_bytes,
                &game_bump_arr,
            ];
            CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
                .authority(&ctx.accounts.payer.to_account_info(), false)
                .permissioned_account(&game_info, true)
                .permission(&ctx.accounts.permission_game)
                .magic_program(&ctx.accounts.magic_program)
                .magic_context(&ctx.accounts.magic_context)
                .invoke_signed(&[game_seeds])?;
        }
    } else {
        require!(
            phase == GamePhase::Waiting,
            PokerError::InvalidAction
        );
        // 中間チェックポイント前にホールカードを確実にクリア（プライバシー保護）
        // settle_handでクリア済みのはずだが、L1コミット前に念のため確実に消去する
        ctx.accounts.player1_state.hole_cards = [255u8; 2];
        ctx.accounts.player2_state.hole_cards = [255u8; 2];
        // deal_cardsもクリア（settle_handでリセット済みだが念のため）
        ctx.accounts.game.deal_cards = [255u8; 8];
        let account_infos = vec![
            ctx.accounts.game.as_ref(),
            ctx.accounts.player1_state.as_ref(),
            ctx.accounts.player2_state.as_ref(),
        ];
        commit_accounts(
            &ctx.accounts.payer,
            account_infos,
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
    }

    Ok(())
}

#[commit]
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
}
