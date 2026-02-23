use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY;
use sha2::{Sha256, Digest};
use crate::state::{Game, GamePhase, PlayerState};
use crate::utils::{shuffle_deck, calculate_blinds};
use crate::errors::PokerError;

pub fn handler(ctx: Context<CallbackDeal>, randomness: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Fisher-Yatesシャッフルでデッキをシャッフル（元のrandomnessを使用）
    let deck = shuffle_deck(&randomness, game.hand_number);

    // deck_commitmentにはハッシュのみ保存（外部から見てもデッキを再構築できない）
    let mut hasher = Sha256::new();
    hasher.update(&randomness);
    let commitment: [u8; 32] = hasher.finalize().into();
    game.deck_commitment = commitment;

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
pub struct CallbackDeal<'info> {
    /// VRF Program Identity — CPI認証: VRFプログラムのPDAがsignerであることを検証
    #[account(address = VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(
        mut,
        // アカウント自身のgame_idでPDA検証（VRFコールバックにgame_idパラメータがないため自己参照）
        seeds = [b"game", game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Shuffling @ PokerError::InvalidAction,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game.game_id.to_le_bytes().as_ref(), game.player1.as_ref()],
        bump = player1_state.bump,
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [b"player_state", game.game_id.to_le_bytes().as_ref(), game.player2.as_ref()],
        bump = player2_state.bump,
    )]
    pub player2_state: Account<'info, PlayerState>,
}
