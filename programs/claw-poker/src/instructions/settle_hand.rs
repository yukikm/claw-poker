use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase, PlayerState};
use crate::utils::hand_evaluator::{determine_showdown_winner, ShowdownResult};
use crate::utils::poker_logic::{CHECKPOINT_INTERVAL, MAX_HAND_NUMBER, MAX_TIE_EXTENSION_HANDS};
use crate::errors::PokerError;

pub fn handler(ctx: Context<SettleHand>, _game_id: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let p1_state = &mut ctx.accounts.player1_state;
    let p2_state = &mut ctx.accounts.player2_state;

    // Effective Stack調整（All-inの超過チップ返却）
    if p1_state.is_all_in || p2_state.is_all_in {
        let p1_in_pot = p1_state.chips_in_pot_this_hand;
        let p2_in_pot = p2_state.chips_in_pot_this_hand;
        let effective = p1_in_pot.min(p2_in_pot);

        if p1_in_pot > effective {
            let excess = p1_in_pot.saturating_sub(effective);
            p1_state.chip_stack = p1_state
                .chip_stack
                .checked_add(excess)
                .ok_or(PokerError::PotOverflow)?;
            game.pot = game.pot.checked_sub(excess).ok_or(PokerError::PotOverflow)?;
        } else if p2_in_pot > effective {
            let excess = p2_in_pot.saturating_sub(effective);
            p2_state.chip_stack = p2_state
                .chip_stack
                .checked_add(excess)
                .ok_or(PokerError::PotOverflow)?;
            game.pot = game.pot.checked_sub(excess).ok_or(PokerError::PotOverflow)?;
        }
    }

    let pot = game.pot;

    // ハンド勝者を決定
    if p1_state.is_folded {
        // Player1がFold -> Player2が勝者
        p2_state.chip_stack = p2_state
            .chip_stack
            .checked_add(pot)
            .ok_or(PokerError::PotOverflow)?;
        game.player2_chip_stack = p2_state.chip_stack;
        game.player1_chip_stack = p1_state.chip_stack;
    } else if p2_state.is_folded {
        // Player2がFold -> Player1が勝者
        p1_state.chip_stack = p1_state
            .chip_stack
            .checked_add(pot)
            .ok_or(PokerError::PotOverflow)?;
        game.player1_chip_stack = p1_state.chip_stack;
        game.player2_chip_stack = p2_state.chip_stack;
    } else if game.phase == GamePhase::Showdown
        || (game.betting_closed && game.phase == GamePhase::River)
    {
        // ショーダウン: ハンド評価（通常Showdown遷移 or AllInランアウト）
        let result = determine_showdown_winner(
            &p1_state.hole_cards,
            &p2_state.hole_cards,
            &game.board_cards,
        );

        match result {
            ShowdownResult::Player1Wins => {
                p1_state.chip_stack = p1_state
                    .chip_stack
                    .checked_add(pot)
                    .ok_or(PokerError::PotOverflow)?;
            }
            ShowdownResult::Player2Wins => {
                p2_state.chip_stack = p2_state
                    .chip_stack
                    .checked_add(pot)
                    .ok_or(PokerError::PotOverflow)?;
            }
            ShowdownResult::Tie => {
                // ポットを二等分、オッドチップはBBプレイヤー（非ディーラー）に
                let half = pot / 2;
                let odd_chip = pot % 2;
                let bb_is_p1 = game.dealer_position == 1; // dealer_position==1 -> Player2がSB, Player1がBB

                p1_state.chip_stack = p1_state
                    .chip_stack
                    .checked_add(half)
                    .ok_or(PokerError::PotOverflow)?;
                p2_state.chip_stack = p2_state
                    .chip_stack
                    .checked_add(half)
                    .ok_or(PokerError::PotOverflow)?;

                // オッドチップをBBプレイヤーに付与
                if odd_chip > 0 {
                    if bb_is_p1 {
                        p1_state.chip_stack = p1_state
                            .chip_stack
                            .checked_add(odd_chip)
                            .ok_or(PokerError::PotOverflow)?;
                    } else {
                        p2_state.chip_stack = p2_state
                            .chip_stack
                            .checked_add(odd_chip)
                            .ok_or(PokerError::PotOverflow)?;
                    }
                }
            }
        }

        game.player1_chip_stack = p1_state.chip_stack;
        game.player2_chip_stack = p2_state.chip_stack;
    }

    // チップ保全不変条件の確認: p1 + p2 == 2000
    require!(
        p1_state
            .chip_stack
            .checked_add(p2_state.chip_stack)
            .ok_or(PokerError::PotOverflow)?
            == crate::utils::poker_logic::TOTAL_CHIPS,
        PokerError::PotOverflow
    );

    // PlayerStateのリセット
    p1_state.chips_committed = 0;
    p1_state.chips_in_pot_this_hand = 0;
    p1_state.is_folded = false;
    p1_state.is_all_in = false;
    p1_state.hole_cards = [255u8; 2];

    p2_state.chips_committed = 0;
    p2_state.chips_in_pot_this_hand = 0;
    p2_state.is_folded = false;
    p2_state.is_all_in = false;
    p2_state.hole_cards = [255u8; 2];

    // Gameリセット
    game.pot = 0;
    game.board_cards = [255u8; 5];
    game.deck_commitment = [0u8; 32];
    game.player1_committed = 0;
    game.player2_committed = 0;
    game.last_raise_amount = 0;
    game.player1_has_folded = false;
    game.player2_has_folded = false;
    game.player1_is_all_in = false;
    game.player2_is_all_in = false;
    game.showdown_cards_p1 = [255u8; 2];
    game.showdown_cards_p2 = [255u8; 2];
    game.betting_closed = false;
    game.current_turn = Pubkey::default();
    game.phase = GamePhase::Waiting;

    // ゲーム終了判定: チップスタック枯渇
    if p1_state.chip_stack == 0 {
        game.phase = GamePhase::Finished;
        game.winner = Some(game.player2);
    } else if p2_state.chip_stack == 0 {
        game.phase = GamePhase::Finished;
        game.winner = Some(game.player1);
    }

    // ゲーム終了判定: MAX_HAND_NUMBER (200) 到達時のタイブレーク規則
    //
    // 1. チップ差がある場合 → チップリードが多い方が勝者
    // 2. 同チップの場合 → MAX_TIE_EXTENSION_HANDS (20) ハンドまで延長戦を継続
    // 3. 延長戦 (220ハンド) 到達後も同チップの場合 → 決定論的タイブレーク:
    //    Player1（game.player1 = 先にゲームに参加したプレイヤー）を勝者とする。
    //    これはブロックチェーン上で決定論的な結果を保証するためのフォールバックであり、
    //    高ブラインド（SB=50/BB=100）の延長戦では理論上ほぼ発生しないケースである。
    //    See: docs/GAME_SPECIFICATION.md Section 2.3
    if game.phase != GamePhase::Finished && game.hand_number >= MAX_HAND_NUMBER {
        if p1_state.chip_stack != p2_state.chip_stack {
            // チップ差がある場合: チップリードが多い方が勝者
            game.phase = GamePhase::Finished;
            if p1_state.chip_stack > p2_state.chip_stack {
                game.winner = Some(game.player1);
            } else {
                game.winner = Some(game.player2);
            }
        }
        // 同チップの場合: MAX_TIE_EXTENSION_HANDS まで追加ハンドを継続
        // 延長上限 (MAX_HAND_NUMBER + MAX_TIE_EXTENSION_HANDS = 220) に到達した場合、
        // チップリードがある方を勝者とし、それでも同チップならPlayer1を勝者とする
        // （決定論的タイブレーク: ブロックチェーン上で曖昧さのない結果を保証する）
        if game.phase != GamePhase::Finished
            && game.hand_number >= MAX_HAND_NUMBER.saturating_add(MAX_TIE_EXTENSION_HANDS)
        {
            game.phase = GamePhase::Finished;
            game.winner = Some(if p1_state.chip_stack >= p2_state.chip_stack {
                game.player1
            } else {
                game.player2
            });
        }
    }

    // 50ハンドチェックポイント更新
    if game.hand_number >= game.last_checkpoint_hand.saturating_add(CHECKPOINT_INTERVAL) {
        game.last_checkpoint_hand = game.hand_number;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct SettleHand<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
        constraint = (
            game.phase == GamePhase::Showdown
            || player1_state.is_folded
            || player2_state.is_folded
            || (game.betting_closed && game.phase == GamePhase::River)
        ) @ PokerError::InvalidAction,
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
