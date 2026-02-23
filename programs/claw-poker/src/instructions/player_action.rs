use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase, PlayerState};
use crate::state::game::PlayerAction;
use crate::errors::PokerError;
use anchor_lang::solana_program::pubkey::Pubkey;

pub fn handler(
    ctx: Context<DoPlayerAction>,
    _game_id: u64,
    action: PlayerAction,
    amount: Option<u64>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_key = ctx.accounts.player.key();

    // 自分のターンであることを確認
    require!(game.current_turn == player_key, PokerError::NotYourTurn);
    require!(!ctx.accounts.player_state.is_folded, PokerError::InvalidAction);

    // アクション時刻を更新
    let clock = Clock::get()?;
    game.last_action_at = clock.unix_timestamp;

    // 現ストリートで既にアクションが発生していたか（Check-Check Showdown遷移判定用）
    let was_action_taken = game.street_action_taken;
    game.street_action_taken = true;

    let is_player1 = player_key == game.player1;
    let (my_committed, opp_committed) = if is_player1 {
        (game.player1_committed, game.player2_committed)
    } else {
        (game.player2_committed, game.player1_committed)
    };
    let opponent_key = if is_player1 { game.player2 } else { game.player1 };

    let player_state = &mut ctx.accounts.player_state;

    match action {
        PlayerAction::Fold => {
            player_state.is_folded = true;
            // ベッティングラウンド終了: ゲームサーバーがsettle_handを呼び出す
            // current_turnをゼロアドレスに設定してベッティング終了を示す
            game.current_turn = Pubkey::default();
        }

        PlayerAction::Check => {
            require!(my_committed == opp_committed, PokerError::InvalidAction);
            // ターンを相手に切り替え
            game.current_turn = opponent_key;
        }

        PlayerAction::Call => {
            let call_amount = if opp_committed > my_committed {
                // スタック不足の場合は自動All-in
                let needed = opp_committed.saturating_sub(my_committed);
                needed.min(player_state.chip_stack)
            } else {
                0
            };

            if call_amount >= player_state.chip_stack && player_state.chip_stack > 0 {
                // 自動All-in
                let all_in = player_state.chip_stack;
                player_state.chips_committed = player_state
                    .chips_committed
                    .checked_add(all_in)
                    .ok_or(PokerError::PotOverflow)?;
                player_state.chips_in_pot_this_hand = player_state
                    .chips_in_pot_this_hand
                    .checked_add(all_in)
                    .ok_or(PokerError::PotOverflow)?;
                player_state.chip_stack = 0;
                player_state.is_all_in = true;
                game.pot = game.pot.checked_add(all_in).ok_or(PokerError::PotOverflow)?;
                game.betting_closed = true;
            } else {
                player_state.chips_committed = player_state
                    .chips_committed
                    .checked_add(call_amount)
                    .ok_or(PokerError::PotOverflow)?;
                player_state.chips_in_pot_this_hand = player_state
                    .chips_in_pot_this_hand
                    .checked_add(call_amount)
                    .ok_or(PokerError::PotOverflow)?;
                player_state.chip_stack = player_state
                    .chip_stack
                    .checked_sub(call_amount)
                    .ok_or(PokerError::InsufficientChips)?;
                game.pot = game.pot.checked_add(call_amount).ok_or(PokerError::PotOverflow)?;
            }

            update_game_committed(game, is_player1, player_state.chips_committed);
            game.current_turn = opponent_key;
        }

        PlayerAction::Bet => {
            let bet_amount = amount.ok_or(PokerError::InvalidAction)?;
            // 現在ベットが0であることを確認
            require!(
                game.player1_committed == 0 && game.player2_committed == 0,
                PokerError::InvalidAction
            );
            require!(bet_amount >= game.current_big_blind, PokerError::InvalidRaise);
            require!(bet_amount <= player_state.chip_stack, PokerError::InsufficientChips);

            player_state.chips_committed = player_state
                .chips_committed
                .checked_add(bet_amount)
                .ok_or(PokerError::PotOverflow)?;
            player_state.chips_in_pot_this_hand = player_state
                .chips_in_pot_this_hand
                .checked_add(bet_amount)
                .ok_or(PokerError::PotOverflow)?;
            player_state.chip_stack = player_state
                .chip_stack
                .checked_sub(bet_amount)
                .ok_or(PokerError::InsufficientChips)?;
            game.pot = game.pot.checked_add(bet_amount).ok_or(PokerError::PotOverflow)?;
            game.last_raise_amount = bet_amount;

            update_game_committed(game, is_player1, player_state.chips_committed);
            game.current_turn = opponent_key;
        }

        PlayerAction::Raise => {
            let raise_to = amount.ok_or(PokerError::InvalidAction)?;
            // 最小レイズ検証: raise_to >= opponent_committed + last_raise_amount
            let min_raise = opp_committed
                .checked_add(game.last_raise_amount)
                .ok_or(PokerError::PotOverflow)?;
            require!(raise_to >= min_raise, PokerError::InvalidRaise);

            let total_to_add = raise_to.saturating_sub(my_committed);
            require!(total_to_add <= player_state.chip_stack, PokerError::InsufficientChips);

            let raise_increment = raise_to.saturating_sub(opp_committed);

            player_state.chips_committed = raise_to;
            player_state.chips_in_pot_this_hand = player_state
                .chips_in_pot_this_hand
                .checked_add(total_to_add)
                .ok_or(PokerError::PotOverflow)?;
            player_state.chip_stack = player_state
                .chip_stack
                .checked_sub(total_to_add)
                .ok_or(PokerError::InsufficientChips)?;
            game.pot = game.pot.checked_add(total_to_add).ok_or(PokerError::PotOverflow)?;
            game.last_raise_amount = raise_increment;

            update_game_committed(game, is_player1, player_state.chips_committed);
            game.current_turn = opponent_key;
        }

        PlayerAction::AllIn => {
            let all_in_amount = player_state.chip_stack;
            player_state.chips_committed = player_state
                .chips_committed
                .checked_add(all_in_amount)
                .ok_or(PokerError::PotOverflow)?;
            player_state.chips_in_pot_this_hand = player_state
                .chips_in_pot_this_hand
                .checked_add(all_in_amount)
                .ok_or(PokerError::PotOverflow)?;
            player_state.chip_stack = 0;
            player_state.is_all_in = true;
            game.pot = game.pot.checked_add(all_in_amount).ok_or(PokerError::PotOverflow)?;
            game.betting_closed = true;

            update_game_committed(game, is_player1, player_state.chips_committed);
            game.current_turn = opponent_key;
        }
    }

    // アクション成功: 連続タイムアウトカウンターをリセット
    if is_player1 {
        game.consecutive_timeouts_p1 = 0;
    } else {
        game.consecutive_timeouts_p2 = 0;
    }

    // RiverのベッティングラウンドをCheckまたはCallで終了した場合、Showdownへ
    // was_action_takenが false の場合は初手Checkによる誤発火を防ぐ
    if game.phase == GamePhase::River
        && was_action_taken
        && game.player1_committed == game.player2_committed
        && game.current_turn != Pubkey::default()
        && !matches!(action, PlayerAction::Fold)
        && !matches!(action, PlayerAction::Bet)
        && !matches!(action, PlayerAction::Raise)
        && !matches!(action, PlayerAction::AllIn)
    {
        game.phase = GamePhase::Showdown;
    }

    Ok(())
}

fn update_game_committed(game: &mut Game, is_player1: bool, committed: u64) {
    if is_player1 {
        game.player1_committed = committed;
    } else {
        game.player2_committed = committed;
    }
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DoPlayerAction<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase != GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = game.phase != GamePhase::Finished @ PokerError::GameAlreadyCompleted,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
        has_one = player @ PokerError::PlayerNotInGame,
    )]
    pub player_state: Account<'info, PlayerState>,
    pub player: Signer<'info>,
}
