// VRFフォールバック用 shuffle_and_deal 命令。
// VRFコールバック（callback_deal）がPER上で一定時間内に到着しない場合に
// サーバーがオペレーターとして呼び出す。
// セキュリティ: operator制約によりオペレーターのみ呼び出し可能。
use anchor_lang::prelude::*;
use sha2::{Sha256, Digest};
use crate::state::{Game, GamePhase, PlayerState};
use crate::utils::{shuffle_deck, calculate_blinds};
use crate::errors::PokerError;

/// VRFフォールバック用 shuffle_and_deal 命令。
/// VRFオラクルを経由せず、直接ランダムシードを受け取ってデッキをシャッフルする。
/// callback_deal が到着しない場合のフォールバックとして使用する。
pub fn handler(ctx: Context<TestShuffleAndDeal>, _game_id: u64, random_seed: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // フォールバックはShufflingフェーズ（request_shuffleでVRFリクエスト済み、
    // callback_deal未到着）またはWaitingフェーズ（Private ERでVRF CPI不可）で許可。
    // Private ER（TEE）ではVRF oracleが利用不可のためrequest_shuffleが失敗する。
    // Waitingからの直接呼び出し時はhand_numberを自前でインクリメントする。
    // セキュリティ: operator制約によりオペレーターのみ呼び出し可能。
    let next_hand = if game.phase == GamePhase::Waiting {
        let h = game.hand_number
            .checked_add(1)
            .ok_or(PokerError::PotOverflow)?;
        game.hand_number = h;
        h
    } else {
        // Shufflingフェーズ: request_shuffleで既にhand_numberインクリメント済み
        game.hand_number
    };

    // Fisher-Yatesシャッフルでデッキをシャッフル
    let deck = shuffle_deck(&random_seed, next_hand);

    // deck_commitmentにはハッシュのみ保存
    let mut hasher = Sha256::new();
    hasher.update(&random_seed);
    let commitment: [u8; 32] = hasher.finalize().into();
    game.deck_commitment = commitment;

    // ホールカード配布
    ctx.accounts.player1_state.hole_cards = [deck[0], deck[1]];
    ctx.accounts.player2_state.hole_cards = [deck[2], deck[3]];

    // コミュニティカード候補をGameに保存
    game.deal_cards = [deck[4], deck[5], deck[6], deck[7], deck[8], deck[9], deck[10], deck[11]];

    // ブラインドレベルの更新
    let (sb, bb) = calculate_blinds(next_hand);
    game.current_small_blind = sb;
    game.current_big_blind = bb;

    // ブラインド投入
    let p1_state = &mut ctx.accounts.player1_state;
    let p2_state = &mut ctx.accounts.player2_state;

    let (sb_player_is_p1, sb_amount, bb_amount) = if game.dealer_position == 0 {
        let actual_sb = sb.min(p1_state.chip_stack);
        let actual_bb = bb.min(p2_state.chip_stack);
        (true, actual_sb, actual_bb)
    } else {
        let actual_sb = sb.min(p2_state.chip_stack);
        let actual_bb = bb.min(p1_state.chip_stack);
        (false, actual_sb, actual_bb)
    };

    if sb_player_is_p1 {
        p1_state.chip_stack = p1_state
            .chip_stack
            .checked_sub(sb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p1_state.chips_committed = sb_amount;
        p1_state.chips_in_pot_this_hand = sb_amount;
        if p1_state.chip_stack == 0 {
            p1_state.is_all_in = true;
            game.player1_is_all_in = true;
            game.betting_closed = true;
        }

        p2_state.chip_stack = p2_state
            .chip_stack
            .checked_sub(bb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p2_state.chips_committed = bb_amount;
        p2_state.chips_in_pot_this_hand = bb_amount;
        if p2_state.chip_stack == 0 {
            p2_state.is_all_in = true;
            game.player2_is_all_in = true;
            game.betting_closed = true;
        }

        game.player1_committed = sb_amount;
        game.player2_committed = bb_amount;
        game.current_turn = game.player1;
    } else {
        p2_state.chip_stack = p2_state
            .chip_stack
            .checked_sub(sb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p2_state.chips_committed = sb_amount;
        p2_state.chips_in_pot_this_hand = sb_amount;
        if p2_state.chip_stack == 0 {
            p2_state.is_all_in = true;
            game.player2_is_all_in = true;
            game.betting_closed = true;
        }

        p1_state.chip_stack = p1_state
            .chip_stack
            .checked_sub(bb_amount)
            .ok_or(PokerError::InsufficientChips)?;
        p1_state.chips_committed = bb_amount;
        p1_state.chips_in_pot_this_hand = bb_amount;
        if p1_state.chip_stack == 0 {
            p1_state.is_all_in = true;
            game.player1_is_all_in = true;
            game.betting_closed = true;
        }

        game.player2_committed = sb_amount;
        game.player1_committed = bb_amount;
        game.current_turn = game.player2;
    }

    game.pot = sb_amount.checked_add(bb_amount).ok_or(PokerError::PotOverflow)?;
    game.last_raise_amount = bb;
    game.street_action_taken = false;
    game.phase = GamePhase::PreFlop;

    // フォールバック使用を監査ログとして記録
    emit!(VrfFallbackUsed {
        game_id: game.game_id,
        hand_number: next_hand,
    });

    // ブラインド投入でAll-inが発生した場合のcurrent_turn補正
    if game.betting_closed {
        let bb_player = if sb_player_is_p1 { game.player2 } else { game.player1 };
        let sb_is_all_in = if sb_player_is_p1 {
            game.player1_is_all_in
        } else {
            game.player2_is_all_in
        };
        let bb_is_all_in = if sb_player_is_p1 {
            game.player2_is_all_in
        } else {
            game.player1_is_all_in
        };

        if sb_is_all_in && bb_is_all_in {
            game.current_turn = Pubkey::default();
        } else if sb_is_all_in {
            game.current_turn = bb_player;
        }
    }

    Ok(())
}

#[event]
pub struct VrfFallbackUsed {
    pub game_id: u64,
    pub hand_number: u64,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct TestShuffleAndDeal<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = (game.phase == GamePhase::Waiting || game.phase == GamePhase::Shuffling) @ PokerError::InvalidAction,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
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
