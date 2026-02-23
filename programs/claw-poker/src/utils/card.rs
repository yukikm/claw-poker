/// カードエンコーディング: 0-51 (未公開は255)
///
/// suit = card_value / 13
/// rank = card_value % 13
///
/// suit: 0=Spades, 1=Hearts, 2=Diamonds, 3=Clubs
/// rank: 0=2, 1=3, 2=4, ..., 8=10, 9=J, 10=Q, 11=K, 12=A

pub const CARD_UNKNOWN: u8 = 255;
pub const DECK_SIZE: usize = 52;

pub fn card_suit(card: u8) -> u8 {
    card / 13
}

pub fn card_rank(card: u8) -> u8 {
    card % 13
}

/// ランクを強さ順の数値に変換（2=0, 3=1, ..., A=12）
pub fn rank_value(rank: u8) -> u8 {
    rank
}

pub fn is_valid_card(card: u8) -> bool {
    card < DECK_SIZE as u8
}

/// デッキを初期化（0-51の順序付き配列）
pub fn new_deck() -> [u8; DECK_SIZE] {
    let mut deck = [0u8; DECK_SIZE];
    for i in 0..DECK_SIZE {
        deck[i] = i as u8;
    }
    deck
}
