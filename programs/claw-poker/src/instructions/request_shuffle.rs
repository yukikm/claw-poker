use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;
use crate::state::{Game, GamePhase, PlayerState};
use crate::errors::PokerError;

pub fn handler(ctx: Context<RequestShuffle>, _game_id: u64, client_seed: u8) -> Result<()> {
    // hand_numberをインクリメント（先にmut borrowで更新）
    let next_hand = ctx.accounts.game.hand_number
        .checked_add(1)
        .ok_or(PokerError::PotOverflow)?;
    ctx.accounts.game.hand_number = next_hand;

    // キーを先に取得（immutable borrow）
    let game_key = ctx.accounts.game.key();
    let p1_key = ctx.accounts.player1_state.key();
    let p2_key = ctx.accounts.player2_state.key();
    let operator_key = ctx.accounts.operator.key();
    let oracle_queue_key = ctx.accounts.oracle_queue.key();

    // VRFリクエスト作成
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: operator_key,
        oracle_queue: oracle_queue_key,
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackDeal::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: game_key,
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: p1_key,
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: p2_key,
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });

    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.operator.to_account_info(), &ix)?;

    // Shuffling状態に遷移
    ctx.accounts.game.phase = GamePhase::Shuffling;

    Ok(())
}

#[vrf]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct RequestShuffle<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.phase == GamePhase::Waiting @ PokerError::InvalidAction,
        constraint = operator.key() == game.operator @ PokerError::PermissionDenied,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player1.as_ref()],
        bump = player1_state.bump,
    )]
    pub player1_state: Account<'info, PlayerState>,
    #[account(
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), game.player2.as_ref()],
        bump = player2_state.bump,
    )]
    pub player2_state: Account<'info, PlayerState>,
    /// CHECK: The oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}
