use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};
use crate::state::{Game, GamePhase, PlayerState};
use crate::utils::{shuffle_deck, calculate_blinds};
use crate::errors::PokerError;

pub fn handler(
    ctx: Context<ShuffleAndDeal>,
    _game_id: u64,
    random_seed: [u8; 32],
) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // hand_numberをインクリメント
    game.hand_number = game.hand_number.checked_add(1).ok_or(PokerError::PotOverflow)?;

    // VRFシードを生成: SHA256(random_seed || game_id || player1 || player2 || hand_number)
    let mut seed_input = Vec::with_capacity(32 + 8 + 32 + 32 + 8);
    seed_input.extend_from_slice(&random_seed);
    seed_input.extend_from_slice(&game.game_id.to_le_bytes());
    seed_input.extend_from_slice(game.player1.as_ref());
    seed_input.extend_from_slice(game.player2.as_ref());
    seed_input.extend_from_slice(&game.hand_number.to_le_bytes());
    let mut hasher = Sha256::new();
    hasher.update(&seed_input);
    let deck_seed: [u8; 32] = hasher.finalize().into();
    // deck_seedからcommitmentを計算（SHA256(deck_seed)）
    let mut commitment_hasher = Sha256::new();
    commitment_hasher.update(&deck_seed);
    let deck_commitment: [u8; 32] = commitment_hasher.finalize().into();
    game.deck_commitment = deck_commitment;
    // deck_seedはon-chainに保存しない（プライバシー保護）

    // Fisher-Yatesシャッフルでデッキをシャッフル
    let deck = shuffle_deck(&deck_seed, game.hand_number);

    // ホールカード配布
    ctx.accounts.player1_state.hole_cards = [deck[0], deck[1]];
    ctx.accounts.player2_state.hole_cards = [deck[2], deck[3]];

    // ブラインドレベルの更新
    let (sb, bb) = calculate_blinds(game.hand_number);
    game.current_small_blind = sb;
    game.current_big_blind = bb;

    // ブラインド投入
    let p1_state = &mut ctx.accounts.player1_state;
    let p2_state = &mut ctx.accounts.player2_state;

    let (sb_player_is_p1, sb_amount, bb_amount) = if game.dealer_position == 0 {
        // Player1がSB/ディーラー
        let actual_sb = sb.min(p1_state.chip_stack);
        let actual_bb = bb.min(p2_state.chip_stack);
        (true, actual_sb, actual_bb)
    } else {
        // Player2がSB/ディーラー
        let actual_sb = sb.min(p2_state.chip_stack);
        let actual_bb = bb.min(p1_state.chip_stack);
        (false, actual_sb, actual_bb)
    };

    if sb_player_is_p1 {
        // Player1がSBを投入
        p1_state.chip_stack = p1_state
            .chip_stack
            .checked_sub(sb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p1_state.chips_committed = sb_amount;
        p1_state.chips_in_pot_this_hand = sb_amount;
        if p1_state.chip_stack == 0 {
            p1_state.is_all_in = true;
        }

        // Player2がBBを投入
        p2_state.chip_stack = p2_state
            .chip_stack
            .checked_sub(bb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p2_state.chips_committed = bb_amount;
        p2_state.chips_in_pot_this_hand = bb_amount;
        if p2_state.chip_stack == 0 {
            p2_state.is_all_in = true;
        }

        game.player1_committed = sb_amount;
        game.player2_committed = bb_amount;
        game.current_turn = game.player1; // SB（Player1）が先手
    } else {
        // Player2がSBを投入
        p2_state.chip_stack = p2_state
            .chip_stack
            .checked_sub(sb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p2_state.chips_committed = sb_amount;
        p2_state.chips_in_pot_this_hand = sb_amount;
        if p2_state.chip_stack == 0 {
            p2_state.is_all_in = true;
        }

        // Player1がBBを投入
        p1_state.chip_stack = p1_state
            .chip_stack
            .checked_sub(bb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p1_state.chips_committed = bb_amount;
        p1_state.chips_in_pot_this_hand = bb_amount;
        if p1_state.chip_stack == 0 {
            p1_state.is_all_in = true;
        }

        game.player2_committed = sb_amount;
        game.player1_committed = bb_amount;
        game.current_turn = game.player2; // SB（Player2）が先手
    }

    game.pot = sb_amount.checked_add(bb_amount).ok_or(PokerError::PotOverflow)?;
    game.last_raise_amount = bb;
    game.street_action_taken = false;
    game.phase = GamePhase::PreFlop;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct ShuffleAndDeal<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    pub operator: Signer<'info>,
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
}
