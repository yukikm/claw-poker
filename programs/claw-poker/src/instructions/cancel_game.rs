/// オペレーターがWaitingフェーズのゲームをキャンセルする命令。
/// TEE delegation失敗やサーバークラッシュでWaiting/Hand#0のまま残ったゲームを
/// クリーンアップし、Vault内の資金を両プレイヤーに返金する。
use anchor_lang::prelude::*;
use crate::state::{Game, GamePhase};
use crate::errors::PokerError;

pub fn handler(ctx: Context<CancelGame>, _game_id: u64) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let buy_in = game.buy_in;

    // Vault残高を確認し、各プレイヤーにbuy_in分を返金
    let vault_balance = ctx.accounts.game_vault.get_lamports();

    // 各プレイヤーへの返金額（Vaultに十分な残高がある場合はbuy_in、なければ均等分配）
    let total_refund = buy_in.checked_mul(2).ok_or(PokerError::PotOverflow)?;
    let per_player = if vault_balance >= total_refund {
        buy_in
    } else {
        vault_balance / 2
    };

    if per_player > 0 {
        **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= per_player;
        **ctx.accounts.player1.try_borrow_mut_lamports()? += per_player;

        **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= per_player;
        **ctx.accounts.player2.try_borrow_mut_lamports()? += per_player;
    }

    // Vaultに残った余剰lamports（rent-exempt分）をオペレーターに返還
    let remaining = ctx.accounts.game_vault.get_lamports();
    if remaining > 0 {
        **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= remaining;
        **ctx.accounts.operator.to_account_info().try_borrow_mut_lamports()? += remaining;
    }

    // ゲームをFinishedに設定（winnerなし = キャンセル）
    game.phase = GamePhase::Finished;

    // BettingPoolをクローズ（ベットがあった場合の安全策）
    let pool = &mut ctx.accounts.betting_pool;
    pool.is_closed = true;
    pool.distributed = true;

    emit!(GameCancelled {
        game_id: game.game_id,
        reason: "operator_cancel_stale_game".to_string(),
    });

    Ok(())
}

#[event]
pub struct GameCancelled {
    pub game_id: u64,
    pub reason: String,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: GameVault PDA
    #[account(
        mut,
        seeds = [b"game_vault", game_id.to_le_bytes().as_ref()],
        bump,
        owner = crate::ID,
    )]
    pub game_vault: AccountInfo<'info>,
    /// CHECK: Player 1 wallet (refund target)
    #[account(
        mut,
        constraint = player1.key() == game.player1 @ PokerError::PlayerNotInGame,
    )]
    pub player1: AccountInfo<'info>,
    /// CHECK: Player 2 wallet (refund target)
    #[account(
        mut,
        constraint = player2.key() == game.player2 @ PokerError::PlayerNotInGame,
    )]
    pub player2: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
    )]
    pub betting_pool: Account<'info, crate::state::BettingPool>,
    #[account(
        mut,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub operator: Signer<'info>,
}
