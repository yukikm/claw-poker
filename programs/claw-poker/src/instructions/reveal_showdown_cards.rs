use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase, PlayerState};
use crate::errors::PokerError;

/// ショーダウン時にPlayerStateのホールカードをGame accountに公開コピーする。
///
/// プライバシー設計:
/// - ホールカードはER（Ephemeral Rollup）上でのみ一時公開される。
/// - L1コミット前に commit_game.rs でshowdown_cards_p1/p2は[255; 2]にクリアされるため、
///   L1（ベースレイヤー）にホールカードが永続化されることはない。
pub fn handler(ctx: Context<RevealShowdownCards>, _game_id: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let p1_state = &ctx.accounts.player1_state;
    let p2_state = &ctx.accounts.player2_state;

    // PlayerStateからホールカードをGameに公開コピー（ER上のみ一時公開）
    game.showdown_cards_p1 = p1_state.hole_cards;
    game.showdown_cards_p2 = p2_state.hole_cards;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct RevealShowdownCards<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
        constraint = game.betting_closed @ PokerError::InvalidAction,
        constraint = game.phase != GamePhase::Finished @ PokerError::GameAlreadyCompleted,
        constraint = game.phase != GamePhase::Waiting @ PokerError::InvalidAction,
    )]
    pub game: Account<'info, Game>,
    pub operator: Signer<'info>,
    #[account(
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player1.as_ref()],
        bump = player1_state.bump,
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player2.as_ref()],
        bump = player2_state.bump,
    )]
    pub player2_state: Account<'info, PlayerState>,
}
