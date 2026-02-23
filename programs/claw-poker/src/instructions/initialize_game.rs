use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase, PlayerState};

pub fn handler(
    ctx: Context<InitializeGame>,
    game_id: u64,
    player1: Pubkey,
    player2: Pubkey,
    buy_in: u64,
    operator: Pubkey,
    platform_treasury: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;

    // Game PDAを初期化
    let game = &mut ctx.accounts.game;
    game.game_id = game_id;
    game.operator = operator;
    game.platform_treasury = platform_treasury;
    game.player1 = player1;
    game.player2 = player2;
    game.buy_in = buy_in;
    game.pot = 0;
    game.current_turn = player1;
    game.phase = GamePhase::Waiting;
    game.board_cards = [255u8; 5];
    game.deck_commitment = [0u8; 32];
    game.player1_committed = 0;
    game.player2_committed = 0;
    game.hand_number = 0;
    game.dealer_position = 0;
    game.current_small_blind = 10;
    game.current_big_blind = 20;
    game.player1_chip_stack = 1000;
    game.player2_chip_stack = 1000;
    game.consecutive_timeouts_p1 = 0;
    game.consecutive_timeouts_p2 = 0;
    game.last_raise_amount = 0;
    game.last_checkpoint_hand = 0;
    game.winner = None;
    game.betting_closed = false;
    game.street_action_taken = false;
    game.last_action_at = clock.unix_timestamp;
    game.created_at = clock.unix_timestamp;
    game.bump = ctx.bumps.game;

    // Player1 State PDAを初期化
    let p1_state = &mut ctx.accounts.player1_state;
    p1_state.game_id = game_id;
    p1_state.player = player1;
    p1_state.hole_cards = [255u8; 2];
    p1_state.chip_stack = 1000;
    p1_state.chips_committed = 0;
    p1_state.chips_in_pot_this_hand = 0;
    p1_state.is_folded = false;
    p1_state.is_all_in = false;
    p1_state.bump = ctx.bumps.player1_state;

    // Player2 State PDAを初期化
    let p2_state = &mut ctx.accounts.player2_state;
    p2_state.game_id = game_id;
    p2_state.player = player2;
    p2_state.hole_cards = [255u8; 2];
    p2_state.chip_stack = 1000;
    p2_state.chips_committed = 0;
    p2_state.chips_in_pot_this_hand = 0;
    p2_state.is_folded = false;
    p2_state.is_all_in = false;
    p2_state.bump = ctx.bumps.player2_state;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64, player1: Pubkey, player2: Pubkey)]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = payer,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player1.as_ref()],
        bump
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        init,
        payer = payer,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player2.as_ref()],
        bump
    )]
    pub player2_state: Account<'info, PlayerState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
