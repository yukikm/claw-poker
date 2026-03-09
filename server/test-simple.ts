import WebSocket from 'ws';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const HTTP_URL = 'http://43.206.193.46:3001';
const WS_URL = 'ws://43.206.193.46:8080';

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function connect(name: string): Promise<{ name: string; kp: Keypair; ws: WebSocket; token: string }> {
  const kp = Keypair.generate();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const t = setTimeout(() => { reject(new Error(name + ' timeout')); ws.close(); }, 10000);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'auth_challenge') {
        const sig = nacl.sign.detached(
          new TextEncoder().encode('Claw Poker Authentication\nNonce: ' + m.nonce),
          kp.secretKey,
        );
        ws.send(JSON.stringify({
          type: 'authenticate',
          walletAddress: kp.publicKey.toBase58(),
          signature: bs58.encode(sig),
          nonce: m.nonce,
        }));
      } else if (m.type === 'auth_success') {
        clearTimeout(t);
        setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          }
        }, 10000);
        resolve({ name, kp, ws, token: m.token });
      }
    });
    ws.on('error', reject);
  });
}

async function join(a: { kp: Keypair }): Promise<unknown> {
  const resp = await fetch(`${HTTP_URL}/api/v1/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: a.kp.publicKey.toBase58() }),
  });
  return resp.json();
}

async function main(): Promise<void> {
  console.log(`${ts()} Connecting A1 & A2...`);
  const a1 = await connect('A1');
  const a2 = await connect('A2');
  let gameOver = false;

  for (const a of [a1, a2]) {
    a.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'pong') return;

      const parts = [m.type];
      if (m.phase) parts.push(m.phase);
      if (m.handNumber !== undefined) parts.push(`h${m.handNumber}`);
      if (m.holeCards) parts.push(String(m.holeCards));
      if (m.action) parts.push(m.action);
      if (m.pot !== undefined) parts.push(`pot=${m.pot}`);
      if (m.myStack !== undefined) parts.push(`stack=${m.myStack}`);
      if (m.code) parts.push(m.code);
      if (m.message) parts.push(String(m.message).slice(0, 80));
      console.log(`${ts()} [${a.name}] ${parts.join(' ')}`);

      if (m.type === 'game_joined') {
        console.log(`${ts()} [${a.name}] *** MATCHED game=${m.gameId} pos=${m.position} ***`);
      }
      if (m.type === 'your_turn') {
        const acts: string[] = m.validActions ?? [];
        const act = acts.includes('call') ? 'call' : acts.includes('check') ? 'check' : 'fold';
        console.log(`${ts()} [${a.name}] -> ${act} (valid: ${acts.join(',')})`);
        a.ws.send(JSON.stringify({
          type: 'player_action',
          token: a.token,
          gameId: m.gameId,
          action: act,
        }));
      }
      if (m.type === 'tee_auth_challenge') {
        const sig = nacl.sign.detached(new TextEncoder().encode(m.challenge), a.kp.secretKey);
        a.ws.send(JSON.stringify({
          type: 'tee_auth_response',
          challenge: m.challenge,
          signature: bs58.encode(sig),
        }));
        console.log(`${ts()} [${a.name}] TEE auth signed`);
      }
      if (m.type === 'action_accepted') {
        console.log(`${ts()} [${a.name}] ACTION ACCEPTED: ${m.action} newPot=${m.newPot}`);
      }
      if (m.type === 'opponent_action') {
        console.log(`${ts()} [${a.name}] OPPONENT: ${m.action} newPot=${m.newPot}`);
      }
      if (m.type === 'hand_complete') {
        console.log(`${ts()} [${a.name}] HAND COMPLETE: winner=${m.winnerPosition} pot=${m.potAmount} myStack=${m.myStack}`);
      }
      if (m.type === 'game_state') {
        console.log(`${ts()} [${a.name}] GAME_STATE: phase=${m.phase} hand=${m.handNumber} pot=${m.pot} turn=${m.isMyTurn}`);
      }
      if (m.type === 'game_over' || m.type === 'game_complete') gameOver = true;
    });
  }

  console.log(`${ts()} Joining A1...`);
  console.log(`${ts()} A1: ${JSON.stringify(await join(a1))}`);
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`${ts()} Joining A2...`);
  console.log(`${ts()} A2: ${JSON.stringify(await join(a2))}`);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (gameOver) break;
  }
  console.log(`${ts()} Done (gameOver=${gameOver})`);
  a1.ws.close();
  a2.ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
