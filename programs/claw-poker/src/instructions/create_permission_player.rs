use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermission, CreatePermissionInstructionArgs,
};
use ephemeral_rollups_sdk::access_control::structs::{
    Member, MembersArgs,
    AUTHORITY_FLAG, TX_LOGS_FLAG,
};
use crate::state::{Game, PlayerState};

fn create_permission_for_player<'info>(
    player_state: &Account<'info, PlayerState>,
    permission: &AccountInfo<'info>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
    player_key: Pubkey,
    operator_key: Pubkey,
    game_id: u64,
    player_bump: u8,
) -> Result<()> {
    // プレイヤー: 完全アクセス（自身のホールカード読み取り + TXログ）
    // オペレーター: 読み取りのみ（重複チェック等のための正当なホールカードアクセス）
    let player_flags = AUTHORITY_FLAG | TX_LOGS_FLAG;
    let operator_flags = AUTHORITY_FLAG;
    let members = vec![
        Member { flags: player_flags, pubkey: player_key },
        Member { flags: operator_flags, pubkey: operator_key },
    ];

    let ix = CreatePermission {
        permissioned_account: player_state.key(),
        permission: permission.key(),
        payer: payer.key(),
        system_program: System::id(),
    }
    .instruction(CreatePermissionInstructionArgs {
        args: MembersArgs { members: Some(members) },
    });

    let game_id_bytes = game_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"player_state",
        game_id_bytes.as_ref(),
        player_key.as_ref(),
        &[player_bump],
    ]];

    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            player_state.to_account_info(),
            permission.to_account_info(),
            payer.to_account_info(),
            system_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    Ok(())
}

pub fn handler_player1(ctx: Context<CreatePermissionPlayer1>, game_id: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let operator_key = ctx.accounts.game.operator;
    let bump = ctx.accounts.player_state.bump;
    create_permission_for_player(
        &ctx.accounts.player_state,
        &ctx.accounts.permission,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
        player_key,
        operator_key,
        game_id,
        bump,
    )
}

pub fn handler_player2(ctx: Context<CreatePermissionPlayer2>, game_id: u64) -> Result<()> {
    let player_key = ctx.accounts.player.key();
    let operator_key = ctx.accounts.game.operator;
    let bump = ctx.accounts.player_state.bump;
    create_permission_for_player(
        &ctx.accounts.player_state,
        &ctx.accounts.permission,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
        player_key,
        operator_key,
        game_id,
        bump,
    )
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreatePermissionPlayer1<'info> {
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: Player 1のアカウント（アドレス参照のみ）
    pub player: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission PDA
    #[account(mut)]
    pub permission: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// Gameアカウント: operator pubkeyを読み取りACLに追加するために参照
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreatePermissionPlayer2<'info> {
    #[account(
        mut,
        seeds = [b"player_state", game_id.to_le_bytes().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    /// CHECK: Player 2のアカウント（アドレス参照のみ）
    pub player: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission PDA
    #[account(mut)]
    pub permission: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// Gameアカウント: operator pubkeyを読み取りACLに追加するために参照
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
}
