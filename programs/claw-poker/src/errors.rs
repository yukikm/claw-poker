use anchor_lang::prelude::*;

#[error_code]
pub enum PokerError {
    #[msg("Game not found")]
    GameNotFound,                    // 6000

    #[msg("Player is not in this game")]
    PlayerNotInGame,                 // 6001

    #[msg("It is not your turn")]
    NotYourTurn,                     // 6002

    #[msg("Invalid action for the current game state")]
    InvalidAction,                   // 6003

    #[msg("Insufficient chips for this action")]
    InsufficientChips,               // 6004

    #[msg("Betting is closed (all-in occurred)")]
    BettingClosed,                   // 6005

    #[msg("Game has already been completed")]
    GameAlreadyCompleted,            // 6006

    #[msg("Raise amount is less than the minimum")]
    InvalidRaise,                    // 6007

    #[msg("Matchmaking queue is full")]
    QueueFull,                       // 6008

    #[msg("Player is already in the queue")]
    AlreadyInQueue,                  // 6009

    #[msg("Entry fee is below the minimum required")]
    EntryFeeInsufficient,            // 6010

    #[msg("Pot calculation overflow")]
    PotOverflow,                     // 6011

    #[msg("Permission denied")]
    PermissionDenied,                // 6012

    #[msg("Game has not yet been completed")]
    GameNotYetCompleted,             // 6013

    #[msg("Action timeout has not been reached yet")]
    TimeoutNotReached,               // 6014
}
