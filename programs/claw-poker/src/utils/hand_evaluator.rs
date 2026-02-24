use crate::utils::card::{card_rank, card_suit};

/// ハンドランキング（高いほど強い）
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone, Copy)]
pub enum HandRank {
    HighCard,
    OnePair,
    TwoPair,
    ThreeOfAKind,
    Straight,
    Flush,
    FullHouse,
    FourOfAKind,
    StraightFlush,
    RoyalFlush,
}

/// ハンド評価結果（比較用）
/// タプルの辞書順比較でハンドの強さを比較できる
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone, Copy)]
pub struct HandValue(pub HandRank, pub [u8; 5]);

/// 7枚のカードから最強の5枚を評価し、HandValueを返す
///
/// hole_cards: プレイヤーのホールカード（2枚）
/// board_cards: コミュニティカード（最大5枚、未公開は255）
pub fn evaluate_best_hand(hole_cards: &[u8; 2], board_cards: &[u8; 5]) -> HandValue {
    let mut available: Vec<u8> = Vec::with_capacity(7);
    available.push(hole_cards[0]);
    available.push(hole_cards[1]);
    for &c in board_cards.iter() {
        if c < 52 {
            available.push(c);
        }
    }

    let n = available.len();
    let mut best: Option<HandValue> = None;

    // 全ての5枚コンビネーションを評価
    for i in 0..n {
        for j in (i + 1)..n {
            for k in (j + 1)..n {
                for l in (k + 1)..n {
                    for m in (l + 1)..n {
                        let hand = [
                            available[i],
                            available[j],
                            available[k],
                            available[l],
                            available[m],
                        ];
                        let val = evaluate_five(&hand);
                        if best.map_or(true, |b| val > b) {
                            best = Some(val);
                        }
                    }
                }
            }
        }
    }

    best.unwrap_or(HandValue(HandRank::HighCard, [0u8; 5]))
}

/// 5枚のカードを評価してHandValueを返す
pub fn evaluate_five(cards: &[u8; 5]) -> HandValue {
    let mut ranks: Vec<u8> = cards.iter().map(|&c| card_rank(c)).collect();
    let suits: Vec<u8> = cards.iter().map(|&c| card_suit(c)).collect();

    let is_flush = suits.iter().all(|&s| s == suits[0]);

    // ランクを降順ソート
    ranks.sort_unstable_by(|a, b| b.cmp(a));

    let is_straight = check_straight(&ranks);

    if is_flush && is_straight {
        // Ace-high ストレートフラッシュ = ロイヤルフラッシュ
        if ranks[0] == 12 && ranks[1] == 11 {
            return HandValue(HandRank::RoyalFlush, ranks_to_array(&ranks));
        }
        // Ace-low ストレートフラッシュ (A-2-3-4-5): Aceは1として扱い 5-highとして評価
        // Straightと同様にトップカードのランクのみで比較する
        if ranks[0] == 12 && ranks[1] == 3 {
            return HandValue(HandRank::StraightFlush, [3, 0, 0, 0, 0]);
        }
        return HandValue(HandRank::StraightFlush, ranks_to_array(&ranks));
    }

    let rank_counts = count_ranks(&ranks);

    // Four of a Kind
    if let Some(v) = find_n_of_a_kind(&rank_counts, 4) {
        let kicker = ranks.iter().find(|&&r| r != v).copied().unwrap_or(0);
        return HandValue(HandRank::FourOfAKind, [v, v, v, v, kicker]);
    }

    // Full House
    if let (Some(trip), Some(pair)) = (
        find_n_of_a_kind(&rank_counts, 3),
        find_n_of_a_kind(&rank_counts, 2),
    ) {
        return HandValue(HandRank::FullHouse, [trip, trip, trip, pair, pair]);
    }

    if is_flush {
        return HandValue(HandRank::Flush, ranks_to_array(&ranks));
    }

    if is_straight {
        // Ace-low ストレート (A-2-3-4-5): Aceは1として扱う
        let top = if ranks[0] == 12 && ranks[1] == 3 {
            3
        } else {
            ranks[0]
        };
        return HandValue(HandRank::Straight, [top, 0, 0, 0, 0]);
    }

    // Three of a Kind
    if let Some(v) = find_n_of_a_kind(&rank_counts, 3) {
        let kickers: Vec<u8> = ranks.iter().filter(|&&r| r != v).copied().collect();
        return HandValue(HandRank::ThreeOfAKind, [v, v, v, kickers[0], kickers[1]]);
    }

    // Two Pair
    let pairs: Vec<u8> = rank_counts
        .iter()
        .filter_map(|&(rank, count)| if count >= 2 { Some(rank) } else { None })
        .collect();

    if pairs.len() >= 2 {
        let high_pair = pairs[0].max(pairs[1]);
        let low_pair = pairs[0].min(pairs[1]);
        let kicker = ranks
            .iter()
            .find(|&&r| r != high_pair && r != low_pair)
            .copied()
            .unwrap_or(0);
        return HandValue(HandRank::TwoPair, [high_pair, high_pair, low_pair, low_pair, kicker]);
    }

    // One Pair
    if pairs.len() == 1 {
        let pair_rank = pairs[0];
        let kickers: Vec<u8> = ranks.iter().filter(|&&r| r != pair_rank).copied().collect();
        return HandValue(
            HandRank::OnePair,
            [
                pair_rank,
                pair_rank,
                *kickers.first().unwrap_or(&0),
                *kickers.get(1).unwrap_or(&0),
                *kickers.get(2).unwrap_or(&0),
            ],
        );
    }

    // High Card
    HandValue(HandRank::HighCard, ranks_to_array(&ranks))
}

fn check_straight(sorted_ranks: &[u8]) -> bool {
    if sorted_ranks.len() < 5 {
        return false;
    }
    // 通常のストレート
    let is_normal = sorted_ranks[0] == sorted_ranks[4].saturating_add(4)
        && sorted_ranks.windows(2).all(|w| w[0] == w[1] + 1);
    // Ace-low ストレート (A-2-3-4-5)
    let is_wheel = sorted_ranks[0] == 12
        && sorted_ranks[1] == 3
        && sorted_ranks[2] == 2
        && sorted_ranks[3] == 1
        && sorted_ranks[4] == 0;
    is_normal || is_wheel
}

fn count_ranks(sorted_ranks: &[u8]) -> Vec<(u8, u8)> {
    let mut counts: Vec<(u8, u8)> = Vec::new();
    for &r in sorted_ranks {
        if let Some(entry) = counts.iter_mut().find(|e| e.0 == r) {
            entry.1 += 1;
        } else {
            counts.push((r, 1));
        }
    }
    // カウント降順、ランク降順でソート
    counts.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));
    counts
}

fn find_n_of_a_kind(rank_counts: &[(u8, u8)], n: u8) -> Option<u8> {
    rank_counts
        .iter()
        .find(|&&(_, count)| count == n)
        .map(|&(rank, _)| rank)
}

fn ranks_to_array(sorted_ranks: &[u8]) -> [u8; 5] {
    let mut arr = [0u8; 5];
    for (i, &r) in sorted_ranks.iter().take(5).enumerate() {
        arr[i] = r;
    }
    arr
}

/// ショーダウン結果
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ShowdownResult {
    Player1Wins,
    Player2Wins,
    Tie,
}

/// 2プレイヤーのショーダウン判定
pub fn determine_showdown_winner(
    p1_hole: &[u8; 2],
    p2_hole: &[u8; 2],
    board: &[u8; 5],
) -> ShowdownResult {
    let p1_hand = evaluate_best_hand(p1_hole, board);
    let p2_hand = evaluate_best_hand(p2_hole, board);

    match p1_hand.cmp(&p2_hand) {
        core::cmp::Ordering::Greater => ShowdownResult::Player1Wins,
        core::cmp::Ordering::Less => ShowdownResult::Player2Wins,
        core::cmp::Ordering::Equal => ShowdownResult::Tie,
    }
}
