/**
 * 2体のAIエージェントを接続してゲームをテストするスクリプト。
 * Usage: npx ts-node scripts/test-two-agents.ts
 */
import WebSocket from 'ws';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const HTTP_URL = process.env.HTTP_URL ?? 'http://43.206.193.46:3001';
const WS_URL = process.env.WS_URL ?? 'ws://43.206.193.46:8080';

interface AgentState {
  name: string;
  keypair: Keypair;
  ws: WebSocket | null;
  token: string | null;
  gameId: string | null;
  position: string | null;
  authenticated: boolean;
}

function createAgent(name: string): AgentState {
  return {
    name,
    keypair: Keypair.generate(),
    ws: null,
    token: null,
    gameId: null,
    position: null,
    authenticated: false,
  };
}

function log(agent: AgentState, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${agent.name}] ${msg}`);
}

async function connectAndAuth(agent: AgentState): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    agent.ws = ws;

    const timeout = setTimeout(() => {
      reject(new Error(`${agent.name}: connection timeout`));
      ws.close();
    }, 15000);

    ws.on('open', () => {
      log(agent, `Connected to ${WS_URL}`);
    });

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'auth_challenge': {
          log(agent, `Got auth challenge, nonce: ${msg.nonce.slice(0, 16)}...`);
          const message = `Claw Poker Authentication\nNonce: ${msg.nonce}`;
          const msgBytes = new TextEncoder().encode(message);
          const signature = nacl.sign.detached(msgBytes, agent.keypair.secretKey);
          ws.send(JSON.stringify({
            type: 'authenticate',
            walletAddress: agent.keypair.publicKey.toBase58(),
            signature: bs58.encode(signature),
            nonce: msg.nonce,
          }));
          break;
        }

        case 'auth_success': {
          agent.token = msg.token;
          agent.authenticated = true;
          log(agent, `Authenticated! Wallet: ${agent.keypair.publicKey.toBase58().slice(0, 8)}...`);
          // Start heartbeat ping every 10 seconds
          setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, 10000);
          clearTimeout(timeout);
          resolve();
          break;
        }

        case 'auth_failed': {
          clearTimeout(timeout);
          reject(new Error(`${agent.name}: auth failed - ${msg.reason}`));
          break;
        }

        case 'queue_joined': {
          log(agent, `Queue joined, position: ${msg.position}`);
          break;
        }

        case 'game_joined': {
          agent.gameId = msg.gameId;
          agent.position = msg.position;
          log(agent, `Game joined! ID: ${msg.gameId}, Position: ${msg.position}, Chips: ${msg.startingChips}`);
          break;
        }

        case 'your_turn': {
          log(agent, `My turn! Hand#${msg.handNumber} Phase:${msg.phase} Pot:${msg.pot} Stack:${msg.myStack}`);
          const actions: string[] = msg.validActions ?? [];
          log(agent, `  Valid actions: ${actions.join(', ')}`);

          // Simple strategy: call if possible, otherwise check, otherwise fold
          let action = 'fold';
          let amount: number | undefined;
          if (actions.includes('call')) {
            action = 'call';
          } else if (actions.includes('check')) {
            action = 'check';
          }

          log(agent, `  -> ${action}`);
          ws.send(JSON.stringify({
            type: 'action',
            gameId: agent.gameId,
            action,
            ...(amount !== undefined ? { amount } : {}),
          }));
          break;
        }

        case 'game_state': {
          log(agent, `State: Phase=${msg.phase} Hand#${msg.handNumber} Pot=${msg.pot} MyStack=${msg.myStack} Turn=${msg.isMyTurn}`);
          break;
        }

        case 'opponent_action': {
          log(agent, `Opponent: ${msg.action}${msg.amount ? ` ${msg.amount}` : ''}`);
          break;
        }

        case 'community_cards_revealed': {
          log(agent, `Board: ${(msg.cards ?? []).join(', ')}`);
          break;
        }

        case 'hand_complete': {
          log(agent, `Hand complete! Winner: ${msg.winnerPosition} Pot: ${msg.potAmount}`);
          log(agent, `  My stack: ${msg.myStack}, Opponent: ${msg.opponentStack}`);
          break;
        }

        case 'hole_cards': {
          log(agent, `Hole cards: ${(msg.cards ?? []).join(', ')}`);
          break;
        }

        case 'game_over': {
          log(agent, `GAME OVER! Winner: ${msg.winner} Reason: ${msg.reason}`);
          break;
        }

        case 'tee_auth_challenge': {
          log(agent, `TEE auth challenge received, signing...`);
          const challengeBytes = new TextEncoder().encode(msg.challenge);
          const teeSig = nacl.sign.detached(challengeBytes, agent.keypair.secretKey);
          ws.send(JSON.stringify({
            type: 'tee_auth_response',
            challenge: msg.challenge,
            signature: bs58.encode(teeSig),
          }));
          break;
        }

        case 'error': {
          log(agent, `ERROR: ${msg.message}`);
          break;
        }

        case 'pong':
          break; // ignore heartbeat response

        default: {
          log(agent, `Unknown message: ${msg.type}`);
        }
      }
    });

    ws.on('error', (err) => {
      log(agent, `WS error: ${err.message}`);
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      log(agent, `WS closed: ${code} ${reason.toString()}`);
    });
  });
}

async function joinQueue(agent: AgentState): Promise<void> {
  const wallet = agent.keypair.publicKey.toBase58();
  log(agent, `Joining queue via HTTP POST...`);

  const resp = await fetch(`${HTTP_URL}/api/v1/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: wallet }),
  });

  const body = await resp.json();
  if (resp.ok) {
    log(agent, `Queue join HTTP response: ${JSON.stringify(body)}`);
  } else {
    log(agent, `Queue join FAILED (${resp.status}): ${JSON.stringify(body)}`);
    throw new Error(`Queue join failed: ${resp.status}`);
  }
}

async function main(): Promise<void> {
  console.log('=== Claw Poker 3-Agent Test (Agent0 consumes leftover, Agent1 vs Agent2) ===\n');

  const agent0 = createAgent('Agent0');
  const agent1 = createAgent('Agent1');
  const agent2 = createAgent('Agent2');

  // Step 1: Connect and authenticate all agents
  console.log('--- Step 1: Connect & Authenticate ---');
  await Promise.all([connectAndAuth(agent0), connectAndAuth(agent1), connectAndAuth(agent2)]);
  console.log('All agents authenticated.\n');

  // Step 2: Agent0 joins first to consume any leftover queue player
  console.log('--- Step 2: Agent0 consumes leftover queue ---');
  await joinQueue(agent0);
  // Wait for Agent0 to be matched with leftover (or stay in queue)
  await new Promise(r => setTimeout(r, 3000));

  // Step 3: Now Agent1 and Agent2 join sequentially
  console.log('--- Step 3: Agent1 & Agent2 join queue ---');
  await joinQueue(agent1);
  await joinQueue(agent2);
  console.log('Agent1 and Agent2 in queue.\n');

  // Step 3: Wait for game to play out
  console.log('--- Step 3: Waiting for game... ---');
  console.log('(Will auto-play with call/check strategy for 120 seconds)\n');

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('\n=== Test timeout (120s). Closing connections. ===');
      resolve();
    }, 120000);

    // Check for game_over message
    const checkGameOver = (agent: AgentState) => {
      agent.ws?.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'game_over') {
          clearTimeout(timeout);
          setTimeout(() => resolve(), 2000); // Wait 2s for final messages
        }
      });
    };
    checkGameOver(agent1);
    checkGameOver(agent2);
  });

  // Cleanup
  agent1.ws?.close();
  agent2.ws?.close();
  console.log('\n=== Test complete ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
