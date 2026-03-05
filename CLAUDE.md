# Project: Claw Poker

MagicBlock Private Ephemeral Rollup-based P2P Texas Hold'em poker game where OpenClaw AI agents compete against each other. Human spectators can watch matches and bet on outcomes.

## Overview

- **Players**: OpenClaw AI agents (not humans)
- **Entry Method**: AI agents load skill.md files to participate
- **Payment**: x402 protocol for entry fees and winner-take-all distribution
- **Spectator Mode**: Humans can watch AI vs AI matches in real-time
- **Betting**: Spectators can bet on which AI will win and receive payouts

## Code Style

- TypeScript strict mode, no `any` types
- Use named exports, not default exports
- CSS: Tailwind utility classes with Glassmorphism design system
- Rust: Anchor framework conventions, no `unwrap()` in production code
- Solana: Use `#[account]` macros, explicit error handling

## Commands

### Development

- `npm run dev`: Start Next.js development server (port 3000)
- `anchor build`: Build Solana programs
- `anchor test`: Run Anchor program tests
- `surfpool start`: Start local Solana validator

### Testing

- `npm run test`: Run frontend Jest tests
- `npm run test:e2e`: Run Playwright end-to-end tests
- `anchor test`: Run Solana program tests
- `npm run lint`: ESLint check

### Deployment

- `anchor deploy`: Deploy programs to configured cluster
- `npm run build`: Build Next.js production bundle

## Architecture

### Frontend

- `/app/app`: Next.js 14 App Router pages and layouts
- `/app/components/ui`: Reusable UI components (Glassmorphism design)
- `/app/lib`: Utilities, Solana connection managers, WebSocket clients
- `/app/hooks`: React hooks for wallet, game state, MagicBlock PER
- `/app/stores`: Zustand state management stores

**Tech Stack**: Next.js 14, `@solana/wallet-adapter-react` (Phantom/Solflare), `@solana/kit`, Tailwind CSS, shadcn/ui, Zustand, Framer Motion

### Solana Programs

- `/programs`: Anchor programs
- `/programs/poker-game`: Main game logic program
- `/tests`: Anchor TypeScript tests
- `/target`: Build artifacts

### Documentation

- `/docs`: Complete specification documents (see @docs references below)

## Important Notes

- **NEVER commit .env files** or private keys
- **Wallet Security**: Private keys must be handled securely, never logged
- **MagicBlock PER**: Use dual connection pattern (Base Layer + PER)
- **Card Privacy**: Player hole cards are encrypted in TEE, only visible to owner
- **VRF Shuffling**: Card deck uses verifiable random function for provable fairness
- **Timeout Handling**: AI agents have 30 seconds per action, auto-fold on timeout; **3 consecutive timeouts = forfeit loss** (`MAX_CONSECUTIVE_TIMEOUTS = 3`)
- **x402 Integration**: Entry fees and payouts handled via x402 payment protocol
- **WebSocket Protocol**: Real-time game state updates use WSS with authentication tokens

## Documentation References

Use these @docs references to access complete specifications:

- **@docs/business-requirements** → `docs/business-requirements.md`: Product requirements, business model, revenue projections, and go-to-market strategy
- **@docs/solana-anchor** → `docs/solana-anchor-requirements.md`: Solana/Anchor program architecture, account structures, x402 payment integration
- **@docs/technical-requirements** → `docs/TECHNICAL_REQUIREMENTS.md`: MagicBlock PER architecture, privacy model, session lifecycle, performance targets
- **@docs/game-specification** → `docs/GAME_SPECIFICATION.md`: Complete Texas Hold'em rules, betting sequences, VRF shuffling, edge cases
- **@docs/openclaw-integration** → `docs/openclaw-integration-requirements.md`: OpenClaw AI agent integration, SKILL.md template, WebSocket protocol, action interface
- **@docs/frontend-requirements** → `docs/frontend-implementation-requirements.md`: Next.js 14 implementation, Solana wallet adapter, dual connection management, Zustand stores
- **@docs/ui-ux-guidelines** → `docs/ui-ux-design-guidelines.md`: Design system, color palette, animations, accessibility (WCAG 2.1 AA), responsive breakpoints

## Key Technical Decisions

1. **Privacy**: Using MagicBlock Private Ephemeral Rollup approach
2. **Commitment Strategy**: Multi-hand with 50-hand checkpoints (commit_game on chip_stack=0; intermediate L1 checkpoint every 50 hands via `last_checkpoint_hand`)
3. **Performance Target**: <100ms action execution time
4. **State Management**: Hybrid (hot state in PER, settlements on L1)
5. **AI Integration**: WebSocket-based event-driven architecture
6. **Payment Protocol**: x402 for entry fees and automated payouts
7. **Design Language**: Glassmorphism + Cyber aesthetics with dark mode primary

## Development Workflow

1. **Start local validator**: `surfpool start`
2. **Build programs**: `anchor build`
3. **Deploy locally**: `anchor deploy --provider.cluster localnet`
4. **Run tests**: `anchor test`
5. **Start frontend**: `npm run dev`
6. **Connect wallet**: Use Phantom or Solflare on Devnet/Localnet

## Security Checklist

- [ ] No private keys in code or logs
- [ ] All transactions validate signer authority
- [ ] Reentrancy protection on fund transfers
- [ ] Integer overflow protection (use checked math)
- [ ] Access control for sensitive game state
- [ ] VRF proofs validated before use
- [ ] WebSocket connections authenticated with tokens
- [ ] Input validation on all user-provided data
- [ ] Error messages don't leak sensitive information

## Memory

Please record task on memory
