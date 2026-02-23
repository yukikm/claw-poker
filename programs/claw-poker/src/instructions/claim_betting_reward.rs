use anchor_lang::prelude::*;
use crate::state::{BetRecord, BettingPool, Game};
use crate::errors::PokerError;

pub fn handler(ctx: Context<ClaimBettingReward>, game_id: u64) -> Result<()> {
    let pool = &ctx.accounts.betting_pool;
    let bet_record = &ctx.accounts.bet_record;
    let bet_amount = bet_record.amount;
    let choice = bet_record.player_choice;

    let game = &ctx.accounts.game;

    // ベッターの予想が的中しているか判定
    let game_winner = pool.winner.ok_or(PokerError::GameNotFound)?;
    let won = (choice == 1 && game_winner == game.player1) || (choice == 2 && game_winner == game.player2);
    require!(won, PokerError::InvalidAction);

    // 正式Pari-mutuel配当計算
    // payout_pool = total_pool * 98 / 100  (2%プラットフォーム手数料をプール全体から先引き)
    // individual_payout = payout_pool * bet_amount / winning_pool
    let total_pool = pool
        .total_bet_player1
        .checked_add(pool.total_bet_player2)
        .ok_or(PokerError::PotOverflow)?;

    let total_winning_bets = if choice == 1 {
        pool.total_bet_player1
    } else {
        pool.total_bet_player2
    };

    // プラットフォーム手数料2%をプール全体から先引き
    let payout_pool = (total_pool as u128)
        .checked_mul(98)
        .ok_or(PokerError::PotOverflow)?
        .checked_div(100)
        .ok_or(PokerError::PotOverflow)? as u64;

    // 個別配当 = payout_pool * bet_amount / winning_pool
    let net_payout = if total_winning_bets > 0 {
        (payout_pool as u128)
            .checked_mul(bet_amount as u128)
            .ok_or(PokerError::PotOverflow)?
            .checked_div(total_winning_bets as u128)
            .ok_or(PokerError::PotOverflow)? as u64
    } else {
        // 勝ち側にベットが0の場合（理論上ここには来ない）: 元本を返却
        bet_amount
    };

    // BettingPool残高を確認し、min(net_payout, pool_balance)を計算（安全上限）
    let pool_balance = ctx.accounts.betting_pool.get_lamports();
    let actual_payout = net_payout.min(pool_balance);

    // Effects before Interactions: 先にclaimedをtrueに設定（再入攻撃防止）
    ctx.accounts.bet_record.claimed = true;

    let pool_bump = ctx.accounts.betting_pool.bump;
    let game_id_bytes = game_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"betting_pool", game_id_bytes.as_ref(), &[pool_bump]];
    let signer_seeds = &[seeds];

    // ベッターにpayoutを転送
    if actual_payout > 0 {
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.betting_pool.key(),
            &ctx.accounts.bettor.key(),
            actual_payout,
        );
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.betting_pool.to_account_info(),
                ctx.accounts.bettor.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct ClaimBettingReward<'info> {
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
        constraint = betting_pool.winner.is_some() @ PokerError::GameNotFound,
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"bet_record", game_id.to_le_bytes().as_ref(), bettor.key().as_ref()],
        bump = bet_record.bump,
        constraint = !bet_record.claimed @ PokerError::GameAlreadyCompleted,
        has_one = bettor @ PokerError::PermissionDenied,
    )]
    pub bet_record: Account<'info, BetRecord>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}
