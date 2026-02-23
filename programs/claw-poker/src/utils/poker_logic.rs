/// ブラインド増加スケジュール
///
/// | ハンド数    | SB | BB |
/// | 1 - 50    | 10 | 20 |
/// | 51 - 100  | 20 | 40 |
/// | 101 - 150 | 30 | 60 |
/// | 151 - 200 | 50 | 100|
/// | 201以降   | 50 | 100|
pub fn calculate_blinds(hand_number: u64) -> (u64, u64) {
    match hand_number {
        1..=50 => (10, 20),
        51..=100 => (20, 40),
        101..=150 => (30, 60),
        _ => (50, 100),
    }
}

/// ミニマムレイズ額を計算する
///
/// 最小レイズ額 = 直前のベットまたはレイズの増分と同額以上
/// last_raise_amount: 直前のベット/レイズ額（増分）
/// current_bet: 現在のベット額（コールすべき額）
pub fn minimum_raise_amount(current_bet: u64, last_raise_amount: u64) -> u64 {
    current_bet.saturating_add(last_raise_amount)
}

/// コール額を計算する（現在のコミット額との差分）
pub fn call_amount(max_committed: u64, my_committed: u64) -> u64 {
    max_committed.saturating_sub(my_committed)
}

/// ベッティングラウンドが均等かどうかを確認する
///
/// 両プレイヤーの投入額が等しく、かつアクション機会が与えられた場合に true を返す
pub fn is_round_equal(p1_committed: u64, p2_committed: u64) -> bool {
    p1_committed == p2_committed
}

/// オールインかどうかを確認する
pub fn is_all_in_situation(chip_stack: u64) -> bool {
    chip_stack == 0
}

/// アクションタイムアウト（秒）
pub const ACTION_TIMEOUT_SECONDS: i64 = 30;

/// 連続タイムアウト上限
pub const MAX_CONSECUTIVE_TIMEOUTS: u8 = 3;

/// チェックポイントのハンド間隔
pub const CHECKPOINT_INTERVAL: u64 = 50;

/// 最大ハンド数
pub const MAX_HAND_NUMBER: u64 = 200;

/// MAX_HAND_NUMBER到達後にタイが続く場合の延長ハンド上限
/// この上限を超えてもチップが同数の場合はPlayer1を勝者とする（実際上は発生しない）
pub const MAX_TIE_EXTENSION_HANDS: u64 = 20;

/// 初期チップスタック
pub const INITIAL_CHIP_STACK: u64 = 1000;

/// 総チップ数（2プレイヤー合計）
pub const TOTAL_CHIPS: u64 = 2000;
