# UI/UX Design Guidelines - AI Poker Battle

## Project Overview
MagicBlock Private Ephemeral Rollupを活用したP2P AIエージェント対戦テキサスホールデムポーカーゲーム

**Core Experience**: 観客としてAIエージェント同士のポーカーバトルを観戦し、リアルタイムでベッティングに参加する

---

## 1. Design Concept & Visual Style

### Primary Concept: "Futuristic Casino Theater"
- **コンセプト**: 近未来的なカジノシアターで、AIの知能がぶつかり合う様子を観戦するという体験
- **デザイン言語**: モダン × ゲーミング × ブロックチェーン
- **ビジュアルスタイル**: Glassmorphism + Cyber aesthetics

### Design Principles
1. **Clarity First** - ゲーム状況が一目で理解できる
2. **Immersive Experience** - 没入感のあるアニメーションと演出
3. **Performance Focused** - 高速なロールアップ技術を活かしたリアルタイム性
4. **Progressive Disclosure** - 必要な情報を段階的に表示
5. **Trustworthy** - ブロックチェーンの透明性を視覚化

### Visual Style Components
- **Glassmorphism**: メインUIエレメント(モーダル、カード、パネル)
- **Neon Accents**: アクション強調、ホバー効果
- **Particle Effects**: ベット時、勝利時のフィードバック
- **3D Depth**: カード、チップの立体感
- **Dark Mode Primary**: 目に優しく、カードとチップを際立たせる

---

## 2. Color Palette

### Primary Colors
```css
/* Base Layer */
--background-primary: #0A0E1A;      /* Deep space blue */
--table-felt-primary: #1A5F4D;      /* Modern poker green */

/* Chips & Currency */
--chip-tier-1: #3B82F6;             /* Blue - low value */
--chip-tier-2: #EF4444;             /* Red - medium value */
--chip-tier-3: #10B981;             /* Green - high value */

/* Blockchain & Tech Accents */
--accent-primary: #06B6D4;          /* Cyan - primary actions */
--accent-secondary: #8B5CF6;        /* Purple - AI indicators */
```

---

## 3. Card Display & Animation

### Card Design
- **Dimensions**: Desktop 120px × 168px, Mobile 60px × 84px
- **Border Radius**: 8px
- **Border**: 2px solid rgba(255, 255, 255, 0.2)

### Animation Sequences

#### Card Deal Animation
```typescript
Timing: 300ms ease-out per card
Effects:
  - Slide from deck
  - Rotate 360deg
  - Fade in opacity 0 → 1
Stagger: 150ms between cards
```

#### Card Flip Animation
```typescript
Timing: 400ms ease-in-out
Effects:
  - rotateY(0deg → 180deg)
  - Swap face at 90deg
  - rotateY(180deg → 360deg)
  - Scale 1 → 1.05 → 1
```

---

## 4. Accessibility Considerations

### WCAG 2.1 AA Compliance

#### Color & Contrast
- Text contrast ratio: Minimum 4.5:1
- Interactive elements: Minimum 3:1

#### Keyboard Navigation
- Tab Order: Menu → Betting panel → Agent selection → Place bet
- Shortcuts: Spacebar (Place bet), Escape (Close modal)

#### Screen Reader Support
- ARIA labels for all interactive elements
- Live regions for game updates

---

## 5. Responsive Design

### Breakpoints
```css
--mobile-small: 320px
--tablet: 768px
--desktop-small: 1024px
--desktop-large: 1920px
```

### Mobile Optimizations (< 768px)
- Vertical stack layout
- Bottom sheet for betting panel
- Minimum touch target: 44px × 44px
- Swipe gestures support

---

**Document Version**: 1.0
**Last Updated**: 2026-02-22
