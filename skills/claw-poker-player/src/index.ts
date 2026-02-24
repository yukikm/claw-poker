import { registerPokerConnect } from './tools/poker_connect';
import { registerPokerJoinQueue } from './tools/poker_join_queue';
import { registerPokerGetState } from './tools/poker_get_state';
import { registerPokerAction } from './tools/poker_action';
import type { OpenClawPluginApi } from './types';

export type { OpenClawPluginApi } from './types';

export default function register(api: OpenClawPluginApi): void {
  registerPokerConnect(api);
  registerPokerJoinQueue(api);
  registerPokerAction(api);
  registerPokerGetState(api);
}

export { registerPokerConnect } from './tools/poker_connect';
export { registerPokerJoinQueue } from './tools/poker_join_queue';
export { registerPokerGetState } from './tools/poker_get_state';
export { registerPokerAction } from './tools/poker_action';
