import WebSocket from 'ws';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const HTTP_URL = 'http://43.206.193.46:3001';
const WS_URL = 'ws://43.206.193.46:8080';

function connect(name: string): Promise<{ name: string; kp: Keypair; ws: WebSocket }> {
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
        resolve({ name, kp, ws });
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

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

async function main(): Promise<void> {
  // Flush queue with 6 dummies (sequential to avoid rate limits)
  console.log(`${ts()} Flushing queue with 6 dummies...`);
  const dummies = [];
  for (let i = 0; i < 6; i++) {
    const d = await connect(`D${i}`);
    dummies.push(d);
    await join(d);
    await new Promise((r) => setTimeout(r, 2000)); // avoid rate limit
  }
  console.log(`${ts()} Waiting 10s for all matches...`);
  await new Promise((r) => setTimeout(r, 10000));
  dummies.forEach((d) => d.ws.close());

  // Clean test
  console.log(`${ts()} Starting clean A1 vs A2 test...`);
  const a1 = await connect('A1');
  const a2 = await connect('A2');
  let gameId: string | null = null;
  let over = false;

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
      if (m.message) parts.push(String(m.message).slice(0, 50));
      console.log(`${ts()} [${a.name}] ${parts.join(' ')}`);

      if (m.type === 'game_joined') {
        gameId = m.gameId;
        console.log(`${ts()} [${a.name}] *** MATCHED game=${m.gameId} pos=${m.position} ***`);
      }
      if (m.type === 'your_turn') {
        const acts: string[] = m.validActions ?? [];
        const act = acts.includes('call') ? 'call' : acts.includes('check') ? 'check' : 'fold';
        console.log(`${ts()} [${a.name}] -> ${act} (valid: ${acts.join(',')})`);
        a.ws.send(JSON.stringify({ type: 'action', gameId: m.gameId ?? gameId, action: act }));
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
      if (m.type === 'game_over') over = true;
    });
  }

  console.log(`${ts()} Joining A1...`);
  console.log(`${ts()} A1: ${JSON.stringify(await join(a1))}`);
  await new Promise((r) => setTimeout(r, 2000)); // avoid rate limit
  console.log(`${ts()} Joining A2...`);
  console.log(`${ts()} A2: ${JSON.stringify(await join(a2))}`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (over) break;
  }
  console.log(`${ts()} Done`);
  a1.ws.close();
  a2.ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
