use sha2::{Digest, Sha256};
use crate::utils::card::DECK_SIZE;

/// VRFシードからデッキをシャッフルする（Fisher-Yatesアルゴリズム）
///
/// SHA-256でシードを初期化し、XorShift64 PRNGでシャッフルする。
/// ループ内のSHA-256を排除してCU消費を削減している。
pub fn shuffle_deck(seed: &[u8; 32], hand_number: u64) -> [u8; DECK_SIZE] {
    let mut deck = crate::utils::card::new_deck();

    // シードにハンド番号を混ぜて各ハンドで異なるシャッフルを保証
    let mut combined = [0u8; 40];
    combined[..32].copy_from_slice(seed);
    combined[32..40].copy_from_slice(&hand_number.to_le_bytes());

    // SHA-256で64bitシードを1回だけ生成
    let hash = sha256_hash(&combined);
    let mut state = u64::from_le_bytes(hash[..8].try_into().unwrap_or([0u8; 8]));
    if state == 0 { state = 1; } // XorShift64はゼロを初期値にできない

    // Fisher-YatesシャッフルにXorShift64 PRNGを使用（CU効率化）
    for i in (1..DECK_SIZE).rev() {
        state = xorshift64(state);
        let j = (state as usize) % (i + 1);
        deck.swap(i, j);
    }

    deck
}

/// XorShift64 PRNG（SHA-256より大幅にCU消費が少ない）
fn xorshift64(mut x: u64) -> u64 {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

fn sha256_hash(input: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(input);
    hasher.finalize().into()
}

/// 次のデッキシードを生成（ハンドごとにシードを更新）
#[allow(dead_code)]
fn pseudo_random_index(state: &[u8; 32], max: usize) -> usize {
    let value = u64::from_le_bytes(state[..8].try_into().unwrap_or([0u8; 8]));
    (value as usize) % max
}

/// 次のデッキシードを生成（ハンドごとにシードを更新）
pub fn next_deck_seed(current_seed: &[u8; 32], hand_number: u64) -> [u8; 32] {
    let mut combined = [0u8; 40];
    combined[..32].copy_from_slice(current_seed);
    combined[32..40].copy_from_slice(&hand_number.to_le_bytes());
    sha256_hash(&combined)
}

/// VRFシードからディーラー位置を決定（0 or 1）
pub fn initial_dealer_position(seed: &[u8; 32]) -> u8 {
    (seed[0] % 2) as u8
}
