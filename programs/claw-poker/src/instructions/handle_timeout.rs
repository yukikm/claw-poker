use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase, PlayerState};
use crate::errors::PokerError;
use crate::utils::poker_logic::{ACTION_TIMEOUT_SECONDS, MAX_CONSECUTIVE_TIMEOUTS};

pub fn handler(ctx: Context<HandleTimeout>, _game_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let game = &mut ctx.accounts.game;

    // タイムアウト時間に達しているか確認
    require!(
        clock.unix_timestamp > game.last_action_at + ACTION_TIMEOUT_SECONDS,
        PokerError::TimeoutNotReached
    );

    let is_player1_turn = game.current_turn == game.player1;

    if is_player1_turn {
        game.consecutive_timeouts_p1 = game.consecutive_timeouts_p1.saturating_add(1);
        if game.consecutive_timeouts_p1 >= MAX_CONSECUTIVE_TIMEOUTS {
            // 3回連続タイムアウト: Player1没収敗北
            game.phase = GamePhase::Finished;
            game.winner = Some(game.player2);
            game.current_turn = Pubkey::default();
            return Ok(());
        }
    } else {
        game.consecutive_timeouts_p2 = game.consecutive_timeouts_p2.saturating_add(1);
        if game.consecutive_timeouts_p2 >= MAX_CONSECUTIVE_TIMEOUTS {
            // 3回連続タイムアウト: Player2没収敗北
            game.phase = GamePhase::Finished;
            game.winner = Some(game.player1);
            game.current_turn = Pubkey::default();
            return Ok(());
        }
    }

    // ベットに直面しているかどうかで自動アクションを分岐
    if game.player1_committed != game.player2_committed {
        // ベットに直面している場合: 自動Fold
        ctx.accounts.timed_out_player_state.is_folded = true;
        if is_player1_turn {
            game.player1_has_folded = true;
        } else {
            game.player2_has_folded = true;
        }
        game.current_turn = Pubkey::default();
    } else {
        // ベットに直面していない場合: 自動Check
        if game.phase == GamePhase::PreFlop {
            // PreFlopでcommitted額が等しい = BBのオプション行使Check → Flop遷移シグナル
            game.current_turn = Pubkey::default();
        } else {
            // PostFlop: ターンを相手に移す
            let opponent = if is_player1_turn { game.player2 } else { game.player1 };
            game.current_turn = opponent;
        }
    }

    // last_action_atをリセット（次ハンドのタイムアウトクロック再スタート）
    game.last_action_at = clock.unix_timestamp;

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct HandleTimeout<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase != GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = game.phase != GamePhase::Finished @ PokerError::GameAlreadyCompleted,
        constraint = game.current_turn != Pubkey::default() @ PokerError::InvalidAction,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.current_turn.as_ref()],
        bump = timed_out_player_state.bump,
        constraint = timed_out_player_state.game_id == game.game_id @ PokerError::InvalidAction,
    )]
    pub timed_out_player_state: Account<'info, PlayerState>,
    pub operator: Signer<'info>,
}
