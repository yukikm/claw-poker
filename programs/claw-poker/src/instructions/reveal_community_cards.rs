use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase};
use crate::errors::PokerError;

/// 既出カードリストと新しいカードの重複を検証するヘルパー
fn require_no_duplicate(new_card: u8, revealed: &[u8]) -> Result<()> {
    require!(!revealed.contains(&new_card), PokerError::InvalidAction);
    Ok(())
}

pub fn handler(
    ctx: Context<RevealCommunityCards>,
    _game_id: u64,
    phase: GamePhase,
    board_cards: Vec<u8>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // カード値の範囲チェック（0-51）
    for card in board_cards.iter() {
        require!(*card < 52, PokerError::InvalidAction);
    }

    match phase {
        GamePhase::Flop => {
            require!(game.phase == GamePhase::PreFlop, PokerError::InvalidAction);
            require!(board_cards.len() == 3, PokerError::InvalidAction);

            // Flopの3枚はバッチ内で互いに重複してはならない
            require!(board_cards[0] != board_cards[1], PokerError::InvalidAction);
            require!(board_cards[0] != board_cards[2], PokerError::InvalidAction);
            require!(board_cards[1] != board_cards[2], PokerError::InvalidAction);

            game.board_cards[0] = board_cards[0];
            game.board_cards[1] = board_cards[1];
            game.board_cards[2] = board_cards[2];
            game.phase = GamePhase::Flop;
        }
        GamePhase::Turn => {
            require!(game.phase == GamePhase::Flop, PokerError::InvalidAction);
            require!(board_cards.len() == 1, PokerError::InvalidAction);

            // Turnカードは公開済みFlopの3枚と重複してはならない
            let flop = &game.board_cards[0..3];
            require_no_duplicate(board_cards[0], flop)?;

            game.board_cards[3] = board_cards[0];
            game.phase = GamePhase::Turn;
        }
        GamePhase::River => {
            require!(game.phase == GamePhase::Turn, PokerError::InvalidAction);
            require!(board_cards.len() == 1, PokerError::InvalidAction);

            // Riverカードは公開済みFlop + Turnと重複してはならない
            let flop_and_turn = &game.board_cards[0..4];
            require_no_duplicate(board_cards[0], flop_and_turn)?;

            game.board_cards[4] = board_cards[0];
            game.phase = GamePhase::River;
        }
        _ => {
            return Err(PokerError::InvalidAction.into());
        }
    }

    // ベッティングラウンドのリセット
    game.player1_committed = 0;
    game.player2_committed = 0;
    game.last_raise_amount = 0;
    game.street_action_taken = false;

    // Postflopアクション順: BBプレイヤー（非ディーラー）が先手
    game.current_turn = if game.dealer_position == 0 {
        game.player2 // Player2がBB（非ディーラー）
    } else {
        game.player1 // Player1がBB（非ディーラー）
    };

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct RevealCommunityCards<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    pub operator: Signer<'info>,
}
