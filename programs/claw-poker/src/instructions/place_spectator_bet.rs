use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{BetRecord, BettingPool};
use crate::errors::PokerError;

pub fn handler(
    ctx: Context<PlaceSpectatorBet>,
    game_id: u64,
    player_choice: u8,
    amount: u64,
) -> Result<()> {
    // player_choiceが1または2であることを確認
    require!(player_choice == 1 || player_choice == 2, PokerError::InvalidAction);
    // amount > 0を確認
    require!(amount > 0, PokerError::InvalidAction);

    // SOLをベッターからBettingPool PDAに転送
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.bettor.to_account_info(),
            to: ctx.accounts.betting_pool.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, amount)?;

    // BetRecord PDAを初期化
    let bet_record = &mut ctx.accounts.bet_record;
    bet_record.game_id = game_id;
    bet_record.bettor = ctx.accounts.bettor.key();
    bet_record.player_choice = player_choice;
    bet_record.amount = amount;
    bet_record.claimed = false;
    bet_record.bump = ctx.bumps.bet_record;

    // BettingPoolを更新
    let pool = &mut ctx.accounts.betting_pool;
    if player_choice == 1 {
        pool.total_bet_player1 = pool
            .total_bet_player1
            .checked_add(amount)
            .ok_or(PokerError::PotOverflow)?;
    } else {
        pool.total_bet_player2 = pool
            .total_bet_player2
            .checked_add(amount)
            .ok_or(PokerError::PotOverflow)?;
    }
    pool.bet_count = pool.bet_count.saturating_add(1);

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64, player_choice: u8, amount: u64)]
pub struct PlaceSpectatorBet<'info> {
    #[account(
        mut,
        seeds = [b"betting_pool", game_id.to_le_bytes().as_ref()],
        bump = betting_pool.bump,
        constraint = !betting_pool.is_closed @ PokerError::BettingClosed
    )]
    pub betting_pool: Account<'info, BettingPool>,
    #[account(
        init,
        payer = bettor,
        space = 8 + BetRecord::INIT_SPACE,
        seeds = [b"bet_record", game_id.to_le_bytes().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet_record: Account<'info, BetRecord>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}
