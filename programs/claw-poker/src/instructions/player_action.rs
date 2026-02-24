use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase, PlayerState};
use crate::state::game::PlayerAction;
use crate::errors::PokerError;

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

    // betting_closed（AllIn発生済み）の場合はFold/Callのみ許可
    if game.betting_closed {
        require!(
            matches!(action, PlayerAction::Fold | PlayerAction::Call),
            PokerError::BettingClosed
        );
    }

    match action {
        PlayerAction::Fold => {
            player_state.is_folded = true;
            if is_player1 {
                game.player1_has_folded = true;
            } else {
                game.player2_has_folded = true;
            }
            // ベッティングラウンド終了: ゲームサーバーがsettle_handを呼び出す
            // current_turnをゼロアドレスに設定してベッティング終了を示す
            game.current_turn = Pubkey::default();
        }

        PlayerAction::Check => {
            require!(my_committed == opp_committed, PokerError::InvalidAction);
            if game.phase == GamePhase::PreFlop {
                // PreFlopでcommitted額が等しい = BBのオプション行使Check → Flop遷移シグナル
                game.current_turn = Pubkey::default();
            } else if was_action_taken {
                // PostFlop: 2人目のCheckでラウンド終了シグナル
                if game.phase == GamePhase::River {
                    // River Check-Check → Showdownに遷移
                    game.phase = GamePhase::Showdown;
                }
                game.current_turn = Pubkey::default();
            } else {
                // PostFlop: 1人目のCheck → ターンを相手に切り替え
                game.current_turn = opponent_key;
            }
        }

        PlayerAction::Call => {
            // Callは相手のコミット額が自分より大きい場合のみ有効（同額ならCheckを使う）
            require!(opp_committed > my_committed, PokerError::InvalidAction);
            // スタック不足の場合は自動All-in
            let needed = opp_committed.saturating_sub(my_committed);
            let call_amount = needed.min(player_state.chip_stack);

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
                if is_player1 {
                    game.player1_is_all_in = true;
                } else {
                    game.player2_is_all_in = true;
                }
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

            // Postflop Call後: 両者のcommitted額が等しければラウンド終了
            let my_committed_after = player_state.chips_committed;
            if my_committed_after == opp_committed {
                match game.phase {
                    GamePhase::Flop | GamePhase::Turn => {
                        // ラウンド終了シグナル: オペレーターがreveal_community_cardsを呼ぶ
                        game.current_turn = Pubkey::default();
                    }
                    GamePhase::River => {
                        game.phase = GamePhase::Showdown;
                        game.current_turn = Pubkey::default();
                    }
                    _ => {
                        // PreFlop:
                        // was_action_taken=falseはSBの最初のCall（BBに合わせる）→ BBにオプション
                        // was_action_taken=trueはBBがRaise済み → SBのCallでラウンド終了
                        if was_action_taken {
                            // BBが既にRaise等のアクションをした後のCall → ラウンド終了シグナル
                            game.current_turn = Pubkey::default();
                        } else {
                            // SBの最初のCall（ブラインドを揃えた）→ BBにオプションを与える
                            game.current_turn = opponent_key;
                        }
                    }
                }
            } else {
                game.current_turn = opponent_key;
            }
        }

        PlayerAction::Bet => {
            let bet_amount = amount.ok_or(PokerError::InvalidAction)?;
            // Betは両者の現ラウンドcommitted額が等しい（誰もベットしていない）時のみ有効。
            // ポストフロップではsettle_hand / start_new_handでcommitted額がリセットされるため
            // 0 == 0となりBetが有効になる。
            // プリフロップではブラインド投入後にcommittedが非0になるため、SBはRaiseを使う。
            require!(
                my_committed == opp_committed,
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
            if is_player1 {
                game.player1_is_all_in = true;
            } else {
                game.player2_is_all_in = true;
            }
            game.pot = game.pot.checked_add(all_in_amount).ok_or(PokerError::PotOverflow)?;

            // AllInが実質的なRaiseの場合、last_raise_amountを更新する
            // （betting_closedになるため相手はCallまたはFoldのみだが、記録は正確に保つ）
            let new_all_in_committed = player_state.chips_committed;
            if new_all_in_committed > opp_committed {
                let raise_increment = new_all_in_committed.saturating_sub(opp_committed);
                game.last_raise_amount = raise_increment;
            }

            game.betting_closed = true;

            update_game_committed(game, is_player1, player_state.chips_committed);

            // AllIn後のcommitted額で判断:
            // - CallとしてのAllIn (new_committed <= opp_committed): 相手のターン不要
            // - RaiseとしてのAllIn (new_committed > opp_committed): 相手にCall/Foldの機会
            if new_all_in_committed > opp_committed {
                // RaiseとしてのAllIn: 相手はCall/Foldを選択する
                game.current_turn = opponent_key;
            } else {
                // CallとしてのAllIn: ベッティング完了
                game.current_turn = Pubkey::default();
            }
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
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
        has_one = player @ PokerError::PlayerNotInGame,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: Player identity verified by player_state has_one constraint and game.current_turn check.
    /// The TEE operator signs transactions on behalf of players in the Private Ephemeral Rollup.
    pub player: AccountInfo<'info>,
    /// TEE operator signs on behalf of the player (MagicBlock PER pattern).
    /// Authorized by game.operator constraint above.
    pub operator: Signer<'info>,
}
