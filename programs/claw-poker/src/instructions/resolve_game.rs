use anchor_lang::prelude::*;
use crate::state::{BettingPool, Game, GamePhase};
use crate::errors::PokerError;

pub fn handler(ctx: Context<ResolveGame>, _game_id: u64) -> Result<()> {
    let game = &ctx.accounts.game;
    let winner_key = game.winner.ok_or(PokerError::GameNotFound)?;
    let buy_in = game.buy_in;

    // pot（SOL単位）= buy_in * 2
    let pot = buy_in.checked_mul(2).ok_or(PokerError::PotOverflow)?;

    // プラットフォーム手数料: 2%
    let fee = pot
        .checked_mul(2)
        .ok_or(PokerError::PotOverflow)?
        .checked_div(100)
        .ok_or(PokerError::PotOverflow)?;
    let payout = pot.checked_sub(fee).ok_or(PokerError::PotOverflow)?;

    // Vault残高がpayout + feeの合計（≒pot）以上であることを事前確認
    let vault_balance = ctx.accounts.game_vault.get_lamports();
    require!(vault_balance >= pot, PokerError::InsufficientChips);

    // 勝者にpayoutを転送（直接lamport操作）
    **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= payout;
    **ctx.accounts.winner.try_borrow_mut_lamports()? += payout;

    // プラットフォームにfeeを転送（直接lamport操作）
    if fee > 0 {
        **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= fee;
        **ctx.accounts.platform_treasury.try_borrow_mut_lamports()? += fee;
    }

    // vault に残った余剰lamports（rent-exempt minimum分）をオペレーターに返還
    let remaining = ctx.accounts.game_vault.get_lamports();
    if remaining > 0 {
        **ctx.accounts.game_vault.try_borrow_mut_lamports()? -= remaining;
        **ctx.accounts.operator.to_account_info().try_borrow_mut_lamports()? += remaining;
    }

    // BettingPool手数料（2%）の事前計算
    let total_betting = ctx.accounts.betting_pool.total_bet_player1
        .checked_add(ctx.accounts.betting_pool.total_bet_player2)
        .ok_or(PokerError::PotOverflow)?;
    let betting_fee = total_betting
        .checked_mul(2)
        .ok_or(PokerError::PotOverflow)?
        .checked_div(100)
        .ok_or(PokerError::PotOverflow)?;

    // BettingPoolにwinnerを設定し、resolve_game二重実行防止フラグを立てる。
    {
        let pool = &mut ctx.accounts.betting_pool;
        pool.winner = Some(winner_key);
        pool.distributed = true;
    }

    // BettingPool手数料（2%）をplatform_treasuryに転送
    // claim_betting_rewardがpayout_pool = total_pool * 98/100で計算するため、
    // 残り2%分をここでtreasury宛に回収する
    if betting_fee > 0 {
        let pool_lamports = ctx.accounts.betting_pool.get_lamports();
        // BettingPoolアカウントのrent-exempt最低残高（約2500 lamports）を確保する
        // rent-exemptを下回るとアカウントが消滅しclaim_betting_rewardが失敗するため
        let rent = Rent::get()?;
        let pool_rent_exempt = rent.minimum_balance(ctx.accounts.betting_pool.to_account_info().data_len());
        let transferable = pool_lamports.saturating_sub(pool_rent_exempt);
        let safe_fee = betting_fee.min(transferable);
        if safe_fee > 0 {
            **ctx.accounts.betting_pool.to_account_info().try_borrow_mut_lamports()? -= safe_fee;
            **ctx.accounts.platform_treasury.try_borrow_mut_lamports()? += safe_fee;
        }
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct ResolveGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Finished @ PokerError::GameNotYetCompleted,
        constraint = game.winner.is_some() @ PokerError::GameNotFound,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: GameVault PDA。プログラム所有（create_game_vaultでinitされる）であることを
    /// owner制約で明示し、直接lamport操作の正当性を保証する。
    #[account(
        mut,
        seeds = [b"game_vault", game_id.to_le_bytes().as_ref()],
        bump,
        owner = crate::ID,
    )]
    pub game_vault: AccountInfo<'info>,
    /// CHECK: 勝者のウォレット
    #[account(
        mut,
        constraint = game.winner == Some(winner.key()) @ PokerError::PermissionDenied
    )]
    pub winner: AccountInfo<'info>,
    /// CHECK: プラットフォーム手数料受取先（game.platform_treasuryで検証）
    #[account(
        mut,
        constraint = platform_treasury.key() == game.platform_treasury @ PokerError::PermissionDenied
    )]
    pub platform_treasury: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
        constraint = !betting_pool.distributed @ PokerError::GameAlreadyCompleted,
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        mut,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied
    )]
    pub operator: Signer<'info>,
}
