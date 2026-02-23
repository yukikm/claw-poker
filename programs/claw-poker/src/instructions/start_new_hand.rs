use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase};
use crate::errors::PokerError;

pub fn handler(ctx: Context<StartNewHand>, _game_id: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // ゲームが既に終了していれば何もしない
    require!(game.phase != GamePhase::Finished, PokerError::GameAlreadyCompleted);

    // ディーラー交代
    game.dealer_position = 1 - game.dealer_position;

    // コミット額をリセット
    game.player1_committed = 0;
    game.player2_committed = 0;
    game.last_raise_amount = 0;

    // 次のハンドのベット受付を再開
    game.betting_closed = false;

    // phaseはWaitingのまま: shuffle_and_dealを待機
    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct StartNewHand<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    pub operator: Signer<'info>,
}
