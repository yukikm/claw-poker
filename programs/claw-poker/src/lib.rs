use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo");

// #[ephemeral]マクロはMagicBlock Ephemeral Rollups SDKが提供するAnchorマクロ。
// このマクロはプログラムにER対応のCPI機能（DelegatePermissionCpiBuilder等）を
// 有効化するために必要。
//
// 明示的CPIパターン（create_permission_game, delegate_game等のinstruction）と
// 併用するのが正しい設計:
// - #[ephemeral]: SDKのCPI機能とERプログラム識別を有効化
// - 明示的instructions: アプリケーション固有のdelegate/undelegateロジックを実装
//
// 参照: https://docs.magicblock.gg/Ephemeral-Rollups/guides/anchor-integration
#[ephemeral]
#[program]
pub mod claw_poker {
    use super::*;

    // ============================================================
    // L1 Instructions
    // ============================================================

    pub fn initialize_matchmaking_queue(
        ctx: Context<InitializeMatchmakingQueue>,
        operator: Pubkey,
    ) -> Result<()> {
        initialize_matchmaking_queue::handler(ctx, operator)
    }

    pub fn enter_matchmaking_queue(
        ctx: Context<EnterMatchmakingQueue>,
        entry_fee: u64,
    ) -> Result<()> {
        enter_matchmaking_queue::handler(ctx, entry_fee)
    }

    pub fn leave_matchmaking_queue(ctx: Context<LeaveMatchmakingQueue>) -> Result<()> {
        leave_matchmaking_queue::handler(ctx)
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_id: u64,
        player1: Pubkey,
        player2: Pubkey,
        buy_in: u64,
        operator: Pubkey,
        platform_treasury: Pubkey,
    ) -> Result<()> {
        initialize_game::handler(ctx, game_id, player1, player2, buy_in, operator, platform_treasury)
    }

    pub fn create_game_vault(ctx: Context<CreateGameVault>, game_id: u64) -> Result<()> {
        create_game_vault::handler(ctx, game_id)
    }

    pub fn create_permission_game(
        ctx: Context<CreatePermissionGame>,
        game_id: u64,
    ) -> Result<()> {
        create_permission_game::handler(ctx, game_id)
    }

    pub fn create_permission_player1(
        ctx: Context<CreatePermissionPlayer1>,
        game_id: u64,
    ) -> Result<()> {
        create_permission_player::handler_player1(ctx, game_id)
    }

    pub fn create_permission_player2(
        ctx: Context<CreatePermissionPlayer2>,
        game_id: u64,
    ) -> Result<()> {
        create_permission_player::handler_player2(ctx, game_id)
    }

    pub fn delegate_game(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
        delegate_game::handler(ctx, game_id)
    }

    pub fn delegate_player1(ctx: Context<DelegatePlayer1>, game_id: u64) -> Result<()> {
        delegate_player::handler_player1(ctx, game_id)
    }

    pub fn delegate_player2(ctx: Context<DelegatePlayer2>, game_id: u64) -> Result<()> {
        delegate_player::handler_player2(ctx, game_id)
    }

    pub fn delegate_permission_game(
        ctx: Context<DelegatePermissionGame>,
        game_id: u64,
    ) -> Result<()> {
        delegate_permission_game::handler(ctx, game_id)
    }

    pub fn delegate_permission_player1(
        ctx: Context<DelegatePermissionPlayer1>,
        game_id: u64,
    ) -> Result<()> {
        delegate_permission_player::handler_player1(ctx, game_id)
    }

    pub fn delegate_permission_player2(
        ctx: Context<DelegatePermissionPlayer2>,
        game_id: u64,
    ) -> Result<()> {
        delegate_permission_player::handler_player2(ctx, game_id)
    }

    pub fn initialize_betting_pool(
        ctx: Context<InitializeBettingPool>,
        game_id: u64,
    ) -> Result<()> {
        initialize_betting_pool::handler(ctx, game_id)
    }

    pub fn place_spectator_bet(
        ctx: Context<PlaceSpectatorBet>,
        game_id: u64,
        player_choice: u8,
        amount: u64,
    ) -> Result<()> {
        place_spectator_bet::handler(ctx, game_id, player_choice, amount)
    }

    pub fn close_betting_pool(ctx: Context<CloseBettingPool>, game_id: u64) -> Result<()> {
        close_betting_pool::handler(ctx, game_id)
    }

    pub fn resolve_game(ctx: Context<ResolveGame>, game_id: u64) -> Result<()> {
        resolve_game::handler(ctx, game_id)
    }

    pub fn claim_betting_reward(
        ctx: Context<ClaimBettingReward>,
        game_id: u64,
    ) -> Result<()> {
        claim_betting_reward::handler(ctx, game_id)
    }

    // ============================================================
    // TEE Instructions (PER内実行)
    // ============================================================

    pub fn request_shuffle(
        ctx: Context<RequestShuffle>,
        game_id: u64,
        client_seed: u8,
    ) -> Result<()> {
        request_shuffle::handler(ctx, game_id, client_seed)
    }

    pub fn callback_deal(
        ctx: Context<CallbackDeal>,
        randomness: [u8; 32],
    ) -> Result<()> {
        callback_deal::handler(ctx, randomness)
    }

    pub fn player_action(
        ctx: Context<DoPlayerAction>,
        game_id: u64,
        action: crate::state::game::PlayerAction,
        amount: Option<u64>,
    ) -> Result<()> {
        player_action::handler(ctx, game_id, action, amount)
    }

    pub fn reveal_community_cards(
        ctx: Context<RevealCommunityCards>,
        game_id: u64,
        phase: crate::state::GamePhase,
        board_cards: Vec<u8>,
    ) -> Result<()> {
        reveal_community_cards::handler(ctx, game_id, phase, board_cards)
    }

    pub fn reveal_showdown_cards(
        ctx: Context<RevealShowdownCards>,
        game_id: u64,
    ) -> Result<()> {
        reveal_showdown_cards::handler(ctx, game_id)
    }

    pub fn settle_hand(ctx: Context<SettleHand>, game_id: u64) -> Result<()> {
        settle_hand::handler(ctx, game_id)
    }

    pub fn start_new_hand(ctx: Context<StartNewHand>, game_id: u64) -> Result<()> {
        start_new_hand::handler(ctx, game_id)
    }

    pub fn commit_game(ctx: Context<CommitGame>, game_id: u64) -> Result<()> {
        commit_game::handler(ctx, game_id)
    }

    pub fn handle_timeout(ctx: Context<HandleTimeout>, game_id: u64) -> Result<()> {
        handle_timeout::handler(ctx, game_id)
    }

    /// VRFオラクルを経由せずデッキをシャッフルする（フォールバック用）。
    /// VRFコールバック（callback_deal）が一定時間内に到着しない場合、
    /// サーバーがオペレーターとしてこの命令を呼び出す。
    /// セキュリティ:
    /// - operator制約: オペレーターのみ呼び出し可能
    /// - Shufflingフェーズ制約: request_shuffle済み（VRFリクエスト発行済み）の場合のみ許可
    /// - Waitingフェーズからの直接呼び出しはVRFバイパス攻撃となるため拒否
    pub fn test_shuffle_and_deal(
        ctx: Context<TestShuffleAndDeal>,
        game_id: u64,
        random_seed: [u8; 32],
    ) -> Result<()> {
        test_shuffle_and_deal::handler(ctx, game_id, random_seed)
    }
}
