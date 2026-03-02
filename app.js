// app.js
"use strict";

/**
 * Card Simulator (static, GitHub Pages friendly)
 * Blackjack + Betting:
 * - Bankroll starts at 100,000
 * - You bet on the seat you control (Player or Dealer)
 * - Bet is placed via selectable chips, shown as a stacked pile
 * - Bet locks when a round begins
 *
 * Actions:
 * - Hit / Stand (standard)
 * - Double (Player only): doubles the active hand bet, draws exactly one card, then stands
 * - Split (Player only): when the initial 2 cards are the same rank; one split maximum
 *
 * Payouts:
 * - Normal win: +1x profit (bet returned + profit)
 * - Blackjack win (natural 21 with 2 cards, no split): +1.5x profit (3:2)
 * - Push: bet returned
 * - Loss: bet lost
 */

const $ = (sel) => document.querySelector(sel);

const screens = {
  home: $("#screen-home"),
  select: $("#screen-select"),
  blackjack: $("#screen-blackjack"),
};

const el = {
  btnStart: $("#btn-start"),
  btnHome: $("#btn-home"),
  btnReset: $("#btn-reset"),
  tileBlackjack: $("#tile-blackjack"),

  // Blackjack UI
  dealerHand: $("#dealer-hand"),
  playerHand: $("#player-hand"), // wrapper (can contain 1 or 2 .hand elements)
  dealerScore: $("#dealer-score"),
  playerScore: $("#player-score"),
  status: $("#status"),
  deck: $("#deck"),
  animLayer: $("#anim-layer"),

  btnNewRound: $("#btn-new-round"),
  btnHit: $("#btn-hit"),
  btnStand: $("#btn-stand"),
  btnDouble: $("#btn-double"),
  btnSplit: $("#btn-split"),

  // Role
  roleModal: $("#role-modal"),
  btnControlPlayer: $("#btn-control-player"),
  btnControlDealer: $("#btn-control-dealer"),
  dealerRolePill: $("#dealer-role-pill"),
  playerRolePill: $("#player-role-pill"),
  youControl: $("#you-control"),

  // Betting UI
  bankroll: $("#bankroll"),
  betAmount: $("#bet-amount"),
  betSpot: $("#bet-spot"),
  betStack: $("#bet-stack"),
  betHint: $("#bet-hint"),
  chipSet: $("#chip-set"),
  btnUndoChip: $("#btn-undo-chip"),
  btnClearBet: $("#btn-clear-bet"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("is-active"));
  screens[name].classList.add("is-active");
}

function setStatus(msg) {
  el.status.textContent = msg;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatMoney(n) {
  const sign = n < 0 ? "-" : "";
  const x = Math.abs(n);
  return `${sign}$${x.toLocaleString("en-US")}`;
}

/* --------------------------
   RNG + Shoe
-------------------------- */

function randInt(maxExclusive) {
  // Bias-resistant modulo reduction for small max, using rejection sampling
  if (window.crypto?.getRandomValues) {
    const u32 = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
    while (true) {
      window.crypto.getRandomValues(u32);
      const x = u32[0];
      if (x < limit) return x % maxExclusive;
    }
  }
  return Math.floor(Math.random() * maxExclusive);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const SUITS = [
  { sym: "♠", color: "black" },
  { sym: "♥", color: "red" },
  { sym: "♦", color: "red" },
  { sym: "♣", color: "black" },
];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function buildShoe(numDecks = 4) {
  const cards = [];
  for (let d = 0; d < numDecks; d++) {
    for (const s of SUITS) {
      for (const r of RANKS) {
        cards.push({ rank: r, suit: s.sym, color: s.color });
      }
    }
  }
  shuffleInPlace(cards);
  return cards;
}

function cardBaseValue(rank) {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

/* --------------------------
   Betting
-------------------------- */

const CHIP_DENOMS = [
  { value: 25, label: "25", color: "#5ee6b2" }, // mint
  { value: 100, label: "100", color: "#5eb6ff" }, // blue
  { value: 500, label: "500", color: "#ff77ec" }, // pink
  { value: 1000, label: "1K", color: "#ffd36b" }, // gold
  { value: 5000, label: "5K", color: "#a78bfa" }, // purple
  { value: 25000, label: "25K", color: "#ff5454" }, // red
];

function chipColorForValue(v) {
  const found = CHIP_DENOMS.find((c) => c.value === v);
  return found ? found.color : "#ffffff";
}

function chipLabelForValue(v) {
  const found = CHIP_DENOMS.find((c) => c.value === v);
  return found ? found.label : String(v);
}

function buildChipTray() {
  // (Re)build chip buttons so visuals are consistent even if HTML is edited.
  el.chipSet.innerHTML = "";

  for (const c of CHIP_DENOMS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = String(c.value);
    chip.style.background = `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), transparent 55%), ${c.color}`;
    chip.title = `Chip ${formatMoney(c.value)}`;

    const label = document.createElement("div");
    label.className = "chip-label";
    label.textContent = c.label;

    chip.appendChild(label);

    chip.addEventListener("click", () => {
      if (BJ.betLocked) return;
      selectChip(c.value);
    });

    el.chipSet.appendChild(chip);
  }
}

function selectChip(value) {
  BJ.selectedChip = value;
  syncChipTraySelection();
  syncBetHint();
}

function syncChipTraySelection() {
  const nodes = Array.from(el.chipSet.querySelectorAll(".chip"));
  for (const node of nodes) {
    const v = Number(node.dataset.value);
    node.classList.toggle("is-selected", v === BJ.selectedChip);

    const canAfford = BJ.bankroll >= v;
    node.classList.toggle("is-disabled", !canAfford || BJ.betLocked);
    node.disabled = !canAfford || BJ.betLocked;
  }
}

function syncBetHint() {
  if (BJ.betLocked) {
    el.betHint.textContent = "Bet locked for this round.";
    el.betSpot.classList.add("is-locked");
    return;
  }

  el.betSpot.classList.remove("is-locked");

  if (!BJ.selectedChip) {
    el.betHint.textContent = "Select a chip, then click to add.";
    return;
  }

  el.betHint.textContent = `Selected ${formatMoney(BJ.selectedChip)}. Click to add.`;
}

function addChipToBet(value) {
  if (BJ.betLocked) return false;
  if (value <= 0) return false;
  if (BJ.bankroll < value) return false;

  BJ.bankroll -= value;
  BJ.betChips.push(value);
  BJ.currentBet += value;

  renderBetStack();
  syncBankrollUI();
  syncBetUI();
  syncChipTraySelection();
  return true;
}

function undoChip() {
  if (BJ.betLocked) return;
  const last = BJ.betChips.pop();
  if (!last) return;

  BJ.currentBet -= last;
  BJ.bankroll += last;

  renderBetStack();
  syncBankrollUI();
  syncBetUI();
  syncChipTraySelection();
}

function clearBet() {
  if (BJ.betLocked) return;
  if (!BJ.betChips.length) return;

  for (const v of BJ.betChips) BJ.bankroll += v;
  BJ.betChips = [];
  BJ.currentBet = 0;

  renderBetStack();
  syncBankrollUI();
  syncBetUI();
  syncChipTraySelection();
}

function lockBet() {
  BJ.betLocked = true;
  syncChipTraySelection();
  syncBetHint();
  el.btnUndoChip.disabled = true;
  el.btnClearBet.disabled = true;
}

function unlockBet() {
  BJ.betLocked = false;
  syncChipTraySelection();
  syncBetHint();
  el.btnUndoChip.disabled = false;
  el.btnClearBet.disabled = false;
}

function normalizeChipsForDisplay(chips) {
  // Visual only; does not affect accounting.
  if (chips.length <= 28) return chips.slice();

  const counts = new Map();
  for (const v of chips) counts.set(v, (counts.get(v) || 0) + 1);

  const denoms = CHIP_DENOMS.map((d) => d.value).slice().sort((a, b) => a - b);

  const ratioToNext = new Map([
    [25, { next: 100, ratio: 4 }],
    [100, { next: 500, ratio: 5 }],
    [500, { next: 1000, ratio: 2 }],
    [1000, { next: 5000, ratio: 5 }],
    [5000, { next: 25000, ratio: 5 }],
  ]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const d of denoms) {
      const rule = ratioToNext.get(d);
      if (!rule) continue;
      const c = counts.get(d) || 0;
      if (c >= rule.ratio) {
        const k = Math.floor(c / rule.ratio);
        counts.set(d, c - k * rule.ratio);
        counts.set(rule.next, (counts.get(rule.next) || 0) + k);
        changed = true;
      }
    }
  }

  const out = [];
  for (const d of denoms) {
    const c = counts.get(d) || 0;
    for (let i = 0; i < c; i++) out.push(d);
  }
  return out;
}

function renderBetStack() {
  el.betStack.innerHTML = "";

  const chips = normalizeChipsForDisplay(BJ.betChips);

  const maxShown = 24;
  const shown = chips.slice(-maxShown);
  const baseY = 52;
  const step = 4;

  for (let i = 0; i < shown.length; i++) {
    const v = shown[i];
    const chip = document.createElement("div");
    chip.className = "stack-chip";
    chip.style.background = `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), transparent 55%), ${chipColorForValue(v)}`;

    const y = baseY - i * step;
    chip.style.top = `${y}px`;

    const jitter = ((i * 17) % 7) - 3;
    chip.style.left = `calc(50% + ${jitter}px)`;

    if (i === shown.length - 1) {
      const label = document.createElement("div");
      label.className = "stack-chip-label";
      label.textContent = chipLabelForValue(v);
      chip.appendChild(label);
      chip.classList.add("pop");
    }

    el.betStack.appendChild(chip);
  }
}

function syncBankrollUI() {
  el.bankroll.textContent = formatMoney(BJ.bankroll);
}

function syncBetUI() {
  el.betAmount.textContent = formatMoney(BJ.currentBet);
}

/* --------------------------
   Blackjack state
-------------------------- */

const BJ = {
  shoe: [],
  controlled: "player", // "player" | "dealer"
  phase: "idle", // "idle" | "dealing" | "playerTurn" | "dealerTurn" | "roundOver"
  uiBusy: false,

  // Dealer has one hand, player can have 1 or 2 hands (split)
  dealer: [],
  playerHands: [[]],
  activeHandIndex: 0,

  // Per-hand state (player only)
  handDone: [false],
  handBets: [0],
  handDoubled: [false],

  // if true, dealer's 2nd card is face-down (hidden from player)
  dealerHoleDown: true,

  // Betting
  bankroll: 100000,
  currentBet: 0, // total across all hands for this round (including split/double)
  betChips: [],
  selectedChip: null,
  betLocked: false,

  // Betting snapshot for visual replication on split/double
  baseBetAmount: 0,
  baseBetChips: [],
};

function resetBlackjackState({ hard = false } = {}) {
  BJ.shoe = buildShoe(4);
  BJ.phase = "idle";
  BJ.uiBusy = false;

  BJ.dealer = [];
  BJ.playerHands = [[]];
  BJ.activeHandIndex = 0;

  BJ.handDone = [false];
  BJ.handBets = [0];
  BJ.handDoubled = [false];

  BJ.dealerHoleDown = true;

  BJ.currentBet = 0;
  BJ.betChips = [];
  BJ.selectedChip = null;
  BJ.betLocked = false;

  BJ.baseBetAmount = 0;
  BJ.baseBetChips = [];

  if (hard) BJ.bankroll = 100000;

  clearHandsUI();
  ensurePlayerHandContainers(1);
  setStatus("Select chips and place a bet. Then click “New round”.");
  setButtonsEnabled({ newRound: true, hit: false, stand: false, double: false, split: false });

  updateRolePills();
  updateScoresUI();

  buildChipTray();
  renderBetStack();
  syncBankrollUI();
  syncBetUI();
  syncChipTraySelection();
  syncBetHint();
  el.btnUndoChip.disabled = false;
  el.btnClearBet.disabled = false;

  // Ensure special buttons start disabled
  if (el.btnDouble) el.btnDouble.disabled = true;
  if (el.btnSplit) el.btnSplit.disabled = true;
}

function clearHandsUI() {
  // Dealer
  el.dealerHand.classList.remove("bust", "win", "lose");
  el.dealerHand.innerHTML = "";

  // Player wrapper: wipe and rebuild containers later
  el.playerHand.innerHTML = "";
}

function ensurePlayerHandContainers(count) {
  el.playerHand.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const handEl = document.createElement("div");
    handEl.className = "hand split-hand";
    handEl.dataset.hand = String(i);
    el.playerHand.appendChild(handEl);
  }
  syncActiveHandUI();
}

function playerHandEls() {
  return Array.from(el.playerHand.querySelectorAll(".hand"));
}

function getPlayerHandEl(idx) {
  const hands = playerHandEls();
  return hands[idx] || null;
}

function syncActiveHandUI() {
  const hands = playerHandEls();
  for (let i = 0; i < hands.length; i++) {
    hands[i].classList.toggle("is-active", i === BJ.activeHandIndex);
  }
}

function updateRolePills() {
  if (BJ.controlled === "player") {
    el.playerRolePill.textContent = "YOU";
    el.dealerRolePill.textContent = "CPU";
    el.youControl.textContent = "Player";
  } else {
    el.playerRolePill.textContent = "CPU";
    el.dealerRolePill.textContent = "YOU";
    el.youControl.textContent = "Dealer";
  }
}

/* --------------------------
   Hand math
-------------------------- */

function handTotals(cards, { includeFaceDown = true } = {}) {
  // Returns { total, soft, blackjack } where blackjack is "natural blackjack" (2-card 21)
  let total = 0;
  let aces = 0;
  let count = 0;

  for (const c of cards) {
    if (!includeFaceDown && c.faceDown) continue;
    total += cardBaseValue(c.rank);
    if (c.rank === "A") aces++;
    count++;
  }

  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  if (aces === 0) soft = false;

  const blackjack = count === 2 && total === 21;
  return { total, soft, blackjack };
}

function isBust(cards, opts) {
  return handTotals(cards, opts).total > 21;
}

/* --------------------------
   Card rendering
-------------------------- */

function makeCardElement(card, { faceDown = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "card" + (card.color === "red" ? " card-red" : "");
  if (faceDown) wrapper.classList.add("is-face-down");

  const inner = document.createElement("div");
  inner.className = "card-inner";

  const front = document.createElement("div");
  front.className = "card-face card-front";

  const back = document.createElement("div");
  back.className = "card-face card-back";

  const cornerTL = document.createElement("div");
  cornerTL.className = "card-corner tl";
  cornerTL.innerHTML = `${escapeHtml(card.rank)}<span class="suit">${escapeHtml(card.suit)}</span>`;

  const cornerBR = document.createElement("div");
  cornerBR.className = "card-corner br";
  cornerBR.innerHTML = `${escapeHtml(card.rank)}<span class="suit">${escapeHtml(card.suit)}</span>`;

  const pip = document.createElement("div");
  pip.className = "card-pip";
  pip.textContent = card.suit;

  const mid = document.createElement("div");
  mid.className = "card-mid";
  mid.textContent = card.suit;

  front.appendChild(cornerTL);
  front.appendChild(pip);
  front.appendChild(mid);
  front.appendChild(cornerBR);

  inner.appendChild(front);
  inner.appendChild(back);
  wrapper.appendChild(inner);

  return wrapper;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* --------------------------
   Dealing animation (deck -> hand)
-------------------------- */

async function animateDeal(toHandEl, card, { faceDown = false } = {}) {
  const deckRect = el.deck.getBoundingClientRect();

  const slot = document.createElement("div");
  slot.style.width = "var(--card-w)";
  slot.style.height = "var(--card-h)";
  slot.style.flex = "0 0 auto";
  toHandEl.appendChild(slot);

  const targetRect = slot.getBoundingClientRect();

  const floating = makeCardElement(card, { faceDown });
  floating.style.position = "fixed";
  floating.style.left = "0px";
  floating.style.top = "0px";
  floating.style.margin = "0";
  floating.style.zIndex = "9999";

  const startX = deckRect.left + deckRect.width / 2 - targetRect.width / 2;
  const startY = deckRect.top + deckRect.height / 2 - targetRect.height / 2;

  const endX = targetRect.left;
  const endY = targetRect.top;

  floating.style.transform = `translate(${startX}px, ${startY}px) rotate(-10deg) scale(0.96)`;
  el.animLayer.appendChild(floating);

  await new Promise((resolve) => requestAnimationFrame(resolve));

  const anim = floating.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) rotate(-10deg) scale(0.96)` },
      { transform: `translate(${endX}px, ${endY}px) rotate(0deg) scale(1)` },
    ],
    { duration: 520, easing: "cubic-bezier(.2,.9,.2,1)" }
  );

  await anim.finished.catch(() => {});

  el.animLayer.removeChild(floating);
  toHandEl.removeChild(slot);

  const finalCardEl = makeCardElement(card, { faceDown });
  toHandEl.appendChild(finalCardEl);

  return finalCardEl;
}

function flipCard(cardEl, faceDown) {
  if (!cardEl) return;
  if (faceDown) cardEl.classList.add("is-face-down");
  else cardEl.classList.remove("is-face-down");
}

/* --------------------------
   UI controls
-------------------------- */

function setButtonsEnabled({ newRound, hit, stand, double = false, split = false }) {
  el.btnNewRound.disabled = !newRound;
  el.btnHit.disabled = !hit;
  el.btnStand.disabled = !stand;

  if (el.btnDouble) el.btnDouble.disabled = !double;
  if (el.btnSplit) el.btnSplit.disabled = !split;
}

function updateScoresUI() {
  const dealerIncludeHole = !(BJ.controlled === "player" && BJ.dealerHoleDown);

  // Player score: single total or split totals
  if (!BJ.playerHands.length || !BJ.playerHands[0].length) {
    el.playerScore.textContent = "—";
  } else if (BJ.playerHands.length === 1) {
    const p = handTotals(BJ.playerHands[0], { includeFaceDown: true });
    el.playerScore.textContent = String(p.total);
  } else {
    const parts = BJ.playerHands.map((h, idx) => {
      const t = handTotals(h, { includeFaceDown: true }).total;
      const activeMark = idx === BJ.activeHandIndex ? "*" : "";
      return `H${idx + 1}:${t}${activeMark}`;
    });
    el.playerScore.textContent = parts.join(" | ");
  }

  // Dealer score
  if (!BJ.dealer.length) {
    el.dealerScore.textContent = "—";
  } else if (dealerIncludeHole) {
    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    el.dealerScore.textContent = String(d.total);
  } else {
    const visible = handTotals(BJ.dealer, { includeFaceDown: false }).total;
    el.dealerScore.textContent = `${visible} + ?`;
  }
}

function clearOutcomeUI() {
  // Dealer
  el.dealerHand.classList.remove("bust", "win", "lose");

  // Player hands
  for (const h of playerHandEls()) {
    h.classList.remove("bust", "win", "lose");
  }
}

function markOutcomeSingle(outcome) {
  // outcome: "youWin" | "youLose" | "push"
  clearOutcomeUI();

  const you = BJ.controlled;
  const youEl = you === "player" ? getPlayerHandEl(0) : el.dealerHand;
  const oppEl = you === "player" ? el.dealerHand : getPlayerHandEl(0);

  if (outcome === "push") return;

  if (outcome === "youWin") {
    youEl?.classList.add("win");
    oppEl?.classList.add("lose");
  } else {
    youEl?.classList.add("lose");
    oppEl?.classList.add("win");
  }
}

function markOutcomeSplit(outcomes) {
  // outcomes per player hand: "youWin" | "youLose" | "push"
  clearOutcomeUI();

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    const hEl = getPlayerHandEl(i);
    if (!hEl) continue;
    if (o === "youWin") hEl.classList.add("win");
    if (o === "youLose") hEl.classList.add("lose");
  }

  // Dealer highlight only if uniform outcome
  const allLose = outcomes.every((o) => o === "youLose");
  const allWin = outcomes.every((o) => o === "youWin");
  if (allLose) el.dealerHand.classList.add("win");
  if (allWin) el.dealerHand.classList.add("lose");
}

/* --------------------------
   Game flow helpers
-------------------------- */

function drawCard() {
  if (BJ.shoe.length < 15) BJ.shoe = buildShoe(4);
  const c = BJ.shoe.pop();
  return { ...c, faceDown: false };
}

async function dealToPlayer({ handIndex = BJ.activeHandIndex } = {}) {
  const c = drawCard();
  BJ.playerHands[handIndex].push(c);

  const handEl = getPlayerHandEl(handIndex);
  if (!handEl) throw new Error(`Missing player hand element for index ${handIndex}`);
  await animateDeal(handEl, c, { faceDown: false });

  updateScoresUI();
  return c;
}

async function dealToDealer({ faceDown = false } = {}) {
  const c = drawCard();
  c.faceDown = !!faceDown;
  BJ.dealer.push(c);
  await animateDeal(el.dealerHand, c, { faceDown });
  updateScoresUI();
  return c;
}

function revealDealerHoleIfNeeded() {
  let revealed = false;
  for (let i = 0; i < BJ.dealer.length; i++) {
    const c = BJ.dealer[i];
    if (c.faceDown) {
      c.faceDown = false;
      const cardEl = el.dealerHand.children[i];
      flipCard(cardEl, false);
      revealed = true;
    }
  }
  if (revealed) updateScoresUI();
}

function baseBetIsIntegerMultiple() {
  if (!BJ.baseBetAmount) return false;
  const ratio = BJ.currentBet / BJ.baseBetAmount;
  const nearest = Math.round(ratio);
  return Math.abs(ratio - nearest) < 1e-9;
}

function syncBetVisualToTotal() {
  if (!BJ.betLocked) {
    renderBetStack();
    return;
  }
  if (!BJ.baseBetAmount || !BJ.baseBetChips.length) {
    renderBetStack();
    return;
  }

  if (!baseBetIsIntegerMultiple()) {
    renderBetStack();
    return;
  }

  const mult = Math.max(1, Math.round(BJ.currentBet / BJ.baseBetAmount));
  const chips = [];
  for (let i = 0; i < mult; i++) chips.push(...BJ.baseBetChips);

  BJ.betChips = chips;
  renderBetStack();
}

function syncTotalBetFromHandBets() {
  BJ.currentBet = BJ.handBets.reduce((a, b) => a + b, 0);
  syncBetUI();
  syncBetVisualToTotal();
}

function canPlayerActNow() {
  return BJ.controlled === "player" && BJ.phase === "playerTurn";
}

function canDoubleDown(handIndex) {
  if (!canPlayerActNow()) return false;
  const h = BJ.playerHands[handIndex];
  if (!h || h.length !== 2) return false;
  if (BJ.handDone[handIndex]) return false;
  if (BJ.handDoubled[handIndex]) return false;
  return BJ.bankroll >= BJ.handBets[handIndex];
}

function canSplitNow() {
  if (!canPlayerActNow()) return false;
  if (BJ.playerHands.length !== 1) return false;
  const h = BJ.playerHands[0];
  if (!h || h.length !== 2) return false;
  if (h[0].rank !== h[1].rank) return false;
  // Must afford a second bet equal to the initial hand bet.
  return BJ.bankroll >= BJ.handBets[0];
}

function syncActionButtons() {
  const canActDealer = BJ.controlled === "dealer" && BJ.phase === "dealerTurn";

  const hit = canPlayerActNow() || canActDealer;
  const stand = canPlayerActNow() || canActDealer;

  const dbl = canPlayerActNow() && canDoubleDown(BJ.activeHandIndex);
  const spl = canPlayerActNow() && canSplitNow();

  // newRound enabled only when idle/roundOver
  const newRound = BJ.phase === "idle" || BJ.phase === "roundOver";

  setButtonsEnabled({ newRound, hit, stand, double: dbl, split: spl });
}

function computeOutcomeAfterFinalSingle() {
  const youCards = BJ.controlled === "player" ? BJ.playerHands[0] : BJ.dealer;
  const oppCards = BJ.controlled === "player" ? BJ.dealer : BJ.playerHands[0];

  const you = handTotals(youCards, { includeFaceDown: true });
  const opp = handTotals(oppCards, { includeFaceDown: true });

  const youBust = you.total > 21;
  const oppBust = opp.total > 21;

  if (youBust && oppBust) return { outcome: "push", youBlackjack: false };
  if (youBust) return { outcome: "youLose", youBlackjack: false };
  if (oppBust) return { outcome: "youWin", youBlackjack: false };

  if (you.total > opp.total) return { outcome: "youWin", youBlackjack: you.blackjack };
  if (you.total < opp.total) return { outcome: "youLose", youBlackjack: false };
  return { outcome: "push", youBlackjack: false };
}

function computeOutcomesAfterFinalSplit() {
  // Player outcomes per hand vs dealer
  const dealer = handTotals(BJ.dealer, { includeFaceDown: true });
  const dealerBust = dealer.total > 21;

  return BJ.playerHands.map((hand) => {
    const p = handTotals(hand, { includeFaceDown: true });
    if (p.total > 21) return "youLose";
    if (dealerBust) return "youWin";
    if (p.total > dealer.total) return "youWin";
    if (p.total < dealer.total) return "youLose";
    return "push";
  });
}

function settleRound({ outcomes, blackjackFlags }) {
  // outcomes: array per player hand if controlled=player; if controlled=dealer, outcomes length=1
  // blackjackFlags: array<boolean> same length (natural blackjack only; split hands should be false)
  let net = 0;

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const bet = BJ.handBets[i] ?? 0;
    if (bet <= 0) continue;

    if (outcome === "push") {
      BJ.bankroll += bet;
    } else if (outcome === "youLose") {
      net -= bet;
    } else {
      const profit = blackjackFlags?.[i] ? bet * 1.5 : bet * 1.0;
      BJ.bankroll += bet + profit;
      net += profit;
    }
  }

  // reset bet for next round
  BJ.currentBet = 0;
  BJ.betChips = [];
  BJ.selectedChip = null;

  BJ.baseBetAmount = 0;
  BJ.baseBetChips = [];

  BJ.handBets = [0];
  BJ.handDone = [false];
  BJ.handDoubled = [false];

  syncBankrollUI();
  syncBetUI();
  renderBetStack();
  syncChipTraySelection();
  syncBetHint();

  return { net };
}

function endRound({ outcomes, blackjackFlags, reason }) {
  BJ.phase = "roundOver";
  revealDealerHoleIfNeeded();
  updateScoresUI();

  if (BJ.controlled === "player" && BJ.playerHands.length > 1) {
    markOutcomeSplit(outcomes);
  } else {
    markOutcomeSingle(outcomes[0]);
  }

  const { net } = settleRound({ outcomes, blackjackFlags });

  const outcomeText = (() => {
    if (BJ.controlled === "player" && BJ.playerHands.length > 1) {
      const parts = outcomes.map((o, i) => {
        if (o === "push") return `H${i + 1}: Push`;
        if (o === "youWin") return `H${i + 1}: Win`;
        return `H${i + 1}: Lose`;
      });
      return parts.join(" | ");
    }
    const o = outcomes[0];
    return o === "push" ? "Push" : (o === "youWin" ? "You win" : "You lose");
  })();

  setStatus(`${outcomeText}. Net: ${formatMoney(net)}.${reason ? ` — ${reason}` : ""}`);

  unlockBet();
  syncActionButtons();
}

async function cpuPlayPlayerSingle() {
  // CPU player: hit until total >= 17 (stands on soft 17)
  while (true) {
    const ht = handTotals(BJ.playerHands[0], { includeFaceDown: true });
    if (ht.total > 21) return;

    if (ht.total < 17) {
      await sleep(160);
      await dealToPlayer({ handIndex: 0 });
      continue;
    }
    return;
  }
}

async function cpuPlayDealer() {
  // Dealer rules CPU: hit until total >= 17, stands on soft 17
  revealDealerHoleIfNeeded();
  await sleep(160);

  while (true) {
    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    if (d.total > 21) return;
    if (d.total >= 17) return;
    await sleep(180);
    await dealToDealer({ faceDown: false });
  }
}

function advanceToNextHandOrDealer() {
  // Find next not-done player hand
  for (let i = 0; i < BJ.playerHands.length; i++) {
    if (!BJ.handDone[i]) {
      BJ.activeHandIndex = i;
      syncActiveHandUI();
      updateScoresUI();
      setStatus(`Your turn (Player). Hand ${i + 1}.`);
      syncActionButtons();
      return;
    }
  }

  // All hands complete -> dealer plays, then settle
  void (async () => {
    BJ.uiBusy = true;
    BJ.phase = "dealerTurn";
    syncActionButtons();
    setStatus("Dealer turn...");
    await cpuPlayDealer();

    const outcomes = computeOutcomesAfterFinalSplit();
    endRound({ outcomes, blackjackFlags: outcomes.map(() => false), reason: "Round resolved." });
    BJ.uiBusy = false;
  })();
}

async function startNewRound() {
  if (BJ.uiBusy) return;
  if (BJ.betLocked) return;

  if (BJ.currentBet <= 0) {
    setStatus("Place a bet first (add chips), then click “New round”.");
    return;
  }

  BJ.uiBusy = true;

  lockBet();

  // Reset hands + per-round state
  BJ.dealer = [];
  BJ.playerHands = [[]];
  BJ.activeHandIndex = 0;
  BJ.handDone = [false];
  BJ.handDoubled = [false];

  BJ.baseBetAmount = BJ.currentBet;
  BJ.baseBetChips = BJ.betChips.slice();

  BJ.handBets = [BJ.baseBetAmount];
  ensurePlayerHandContainers(1);
  clearOutcomeUI();

  BJ.phase = "dealing";
  syncActionButtons();

  BJ.dealerHoleDown = BJ.controlled === "player";

  setStatus(`Dealing... Bet: ${formatMoney(BJ.currentBet)}`);
  await sleep(120);

  // Deal sequence: Player0, Dealer, Player0, Dealer(hole maybe)
  await dealToPlayer({ handIndex: 0 });
  await sleep(80);

  await dealToDealer({ faceDown: false });
  await sleep(80);

  await dealToPlayer({ handIndex: 0 });
  await sleep(80);

  await dealToDealer({ faceDown: BJ.dealerHoleDown });

  // Naturals (single-hand only)
  const p = handTotals(BJ.playerHands[0], { includeFaceDown: true });
  const d = handTotals(BJ.dealer, { includeFaceDown: true });

  if (p.blackjack || d.blackjack) {
    revealDealerHoleIfNeeded();
    await sleep(120);

    const youCards = BJ.controlled === "player" ? BJ.playerHands[0] : BJ.dealer;
    const oppCards = BJ.controlled === "player" ? BJ.dealer : BJ.playerHands[0];

    const you = handTotals(youCards, { includeFaceDown: true });
    const opp = handTotals(oppCards, { includeFaceDown: true });

    let outcome;
    if (you.blackjack && opp.blackjack) outcome = "push";
    else if (you.blackjack) outcome = "youWin";
    else outcome = "youLose";

    endRound({
      outcomes: [outcome],
      blackjackFlags: [you.blackjack],
      reason: "Blackjack resolution.",
    });

    BJ.uiBusy = false;
    return;
  }

  // If controlling dealer, CPU plays player first
  if (BJ.controlled === "dealer") {
    setStatus("CPU Player turn...");
    BJ.phase = "playerTurn";
    syncActionButtons();
    await sleep(180);
    await cpuPlayPlayerSingle();

    const pb = isBust(BJ.playerHands[0], { includeFaceDown: true });
    if (pb) {
      getPlayerHandEl(0)?.classList.add("bust");
      revealDealerHoleIfNeeded();
      endRound({ outcomes: ["youWin"], blackjackFlags: [false], reason: "Player busts." });
      BJ.uiBusy = false;
      return;
    }

    // Dealer (YOU) now plays
    BJ.phase = "dealerTurn";
    setStatus("Your turn (Dealer). Hit or Stand.");
    syncActionButtons();
    BJ.uiBusy = false;
    return;
  }

  // Player (YOU) turn
  BJ.phase = "playerTurn";
  setStatus("Your turn (Player). Hit, Stand, Double, or Split.");
  syncActionButtons();
  BJ.uiBusy = false;
}

/* --------------------------
   Player actions
-------------------------- */

async function onHit() {
  if (BJ.uiBusy) return;
  if (!(BJ.phase === "playerTurn" || BJ.phase === "dealerTurn")) return;

  const seat = BJ.phase === "playerTurn" ? "player" : "dealer";
  const youControl = BJ.controlled === seat;
  if (!youControl) return;

  BJ.uiBusy = true;

  if (seat === "player") {
    const idx = BJ.activeHandIndex;
    await dealToPlayer({ handIndex: idx });

    const p = handTotals(BJ.playerHands[idx], { includeFaceDown: true });
    if (p.total > 21) {
      const hEl = getPlayerHandEl(idx);
      hEl?.classList.add("bust");
      BJ.handDone[idx] = true;

      if (BJ.playerHands.length > 1) {
        setStatus(`Hand ${idx + 1} busts.`);
        await sleep(220);
        advanceToNextHandOrDealer();
      } else {
        revealDealerHoleIfNeeded();
        endRound({ outcomes: ["youLose"], blackjackFlags: [false], reason: "You busted." });
      }
    } else {
      syncActionButtons();
    }
  } else {
    // seat === dealer (you control dealer). Dealer cannot split/double in this sim.
    await dealToDealer({ faceDown: false });

    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    if (d.total > 21) {
      el.dealerHand.classList.add("bust");
      endRound({ outcomes: ["youLose"], blackjackFlags: [false], reason: "You busted." });
    } else {
      syncActionButtons();
    }
  }

  BJ.uiBusy = false;
}

async function onStand() {
  if (BJ.uiBusy) return;
  if (!(BJ.phase === "playerTurn" || BJ.phase === "dealerTurn")) return;

  const seat = BJ.phase === "playerTurn" ? "player" : "dealer";
  const youControl = BJ.controlled === seat;
  if (!youControl) return;

  BJ.uiBusy = true;

  if (seat === "player") {
    const idx = BJ.activeHandIndex;
    BJ.handDone[idx] = true;

    if (BJ.playerHands.length > 1) {
      advanceToNextHandOrDealer();
      BJ.uiBusy = false;
      return;
    }

    // Single-hand: dealer CPU plays, then settle
    BJ.phase = "dealerTurn";
    syncActionButtons();
    setStatus("Dealer turn...");
    await cpuPlayDealer();

    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    if (d.total > 21) el.dealerHand.classList.add("bust");

    const { outcome, youBlackjack } = computeOutcomeAfterFinalSingle();
    endRound({ outcomes: [outcome], blackjackFlags: [youBlackjack], reason: "Round resolved." });

    BJ.uiBusy = false;
    return;
  }

  // seat === dealer: resolve immediately (player already played CPU)
  const d = handTotals(BJ.dealer, { includeFaceDown: true });
  if (d.total > 21) el.dealerHand.classList.add("bust");

  const { outcome, youBlackjack } = computeOutcomeAfterFinalSingle();
  endRound({ outcomes: [outcome], blackjackFlags: [youBlackjack], reason: "Round resolved." });

  BJ.uiBusy = false;
}

async function onDoubleDown() {
  if (BJ.uiBusy) return;
  if (!canPlayerActNow()) return;

  const idx = BJ.activeHandIndex;
  if (!canDoubleDown(idx)) {
    setStatus("Double is not available right now.");
    return;
  }

  BJ.uiBusy = true;

  const add = BJ.handBets[idx];
  BJ.bankroll -= add;
  BJ.handBets[idx] += add;
  BJ.handDoubled[idx] = true;

  syncBankrollUI();
  syncTotalBetFromHandBets();

  setStatus(`Double down. Hand ${idx + 1}: one card, then stand.`);
  await sleep(100);

  await dealToPlayer({ handIndex: idx });

  const p = handTotals(BJ.playerHands[idx], { includeFaceDown: true });
  if (p.total > 21) {
    getPlayerHandEl(idx)?.classList.add("bust");
  }

  BJ.handDone[idx] = true;

  if (BJ.playerHands.length > 1) {
    await sleep(180);
    advanceToNextHandOrDealer();
  } else {
    // proceed directly to dealer
    BJ.phase = "dealerTurn";
    syncActionButtons();
    setStatus("Dealer turn...");
    await cpuPlayDealer();

    const outcomes = [computeOutcomeAfterFinalSingle().outcome];
    endRound({ outcomes, blackjackFlags: [false], reason: "Round resolved." });
  }

  BJ.uiBusy = false;
}

async function onSplit() {
  if (BJ.uiBusy) return;
  if (!canSplitNow()) {
    setStatus("Split is not available right now.");
    return;
  }

  BJ.uiBusy = true;

  const h = BJ.playerHands[0];
  const first = h[0];
  const second = h[1];

  // Place the second bet (equal to the first hand bet)
  const bet = BJ.handBets[0];
  BJ.bankroll -= bet;

  BJ.playerHands = [[first], [second]];
  BJ.activeHandIndex = 0;
  BJ.handDone = [false, false];
  BJ.handDoubled = [false, false];
  BJ.handBets = [bet, bet];

  syncBankrollUI();
  syncTotalBetFromHandBets();

  // Move existing card elements into two hand containers (preserve deal animation fidelity)
  const oldHandEl = getPlayerHandEl(0);
  const oldCards = oldHandEl ? Array.from(oldHandEl.children) : [];
  ensurePlayerHandContainers(2);

  const h0El = getPlayerHandEl(0);
  const h1El = getPlayerHandEl(1);

  if (h0El && h1El && oldCards.length >= 2) {
    h0El.appendChild(oldCards[0]);
    h1El.appendChild(oldCards[1]);
  }

  syncActiveHandUI();
  updateScoresUI();

  setStatus("Split. Dealing one card to each hand...");
  await sleep(140);

  // Standard flow: each split hand receives one additional card before play
  await dealToPlayer({ handIndex: 0 });
  await sleep(80);
  await dealToPlayer({ handIndex: 1 });

  // House rule: split aces -> one card each, then stand (common)
  if (first.rank === "A") {
    BJ.handDone = [true, true];
    setStatus("Split aces: one card each (house rule).");
    await sleep(240);
    advanceToNextHandOrDealer();
    BJ.uiBusy = false;
    return;
  }

  BJ.activeHandIndex = 0;
  syncActiveHandUI();
  setStatus("Your turn (Player). Hand 1.");
  syncActionButtons();

  BJ.uiBusy = false;
}

/* --------------------------
   Role modal
-------------------------- */

function openRoleModal() {
  el.roleModal.classList.remove("is-hidden");
}

function closeRoleModal() {
  el.roleModal.classList.add("is-hidden");
}

function setControlledSeat(seat) {
  BJ.controlled = seat;
  updateRolePills();

  // reset bet UI (keep bankroll) because "you" changed seats
  BJ.currentBet = 0;
  BJ.betChips = [];
  BJ.selectedChip = null;
  BJ.betLocked = false;

  BJ.baseBetAmount = 0;
  BJ.baseBetChips = [];

  renderBetStack();
  syncBetUI();
  syncChipTraySelection();
  syncBetHint();

  // reset round state
  BJ.phase = "idle";
  BJ.dealer = [];
  BJ.playerHands = [[]];
  BJ.activeHandIndex = 0;
  BJ.handDone = [false];
  BJ.handBets = [0];
  BJ.handDoubled = [false];
  clearHandsUI();
  ensurePlayerHandContainers(1);
  updateScoresUI();

  syncActionButtons();
}

/* --------------------------
   Navigation + wiring
-------------------------- */

function hardResetAll() {
  showScreen("home");
  resetBlackjackState({ hard: true });
  closeRoleModal();
}

function enterSelect() {
  showScreen("select");
}

function enterBlackjack() {
  showScreen("blackjack");
  resetBlackjackState({ hard: true });
  openRoleModal();
}

function wireEvents() {
  el.btnStart.addEventListener("click", () => enterSelect());
  el.btnHome.addEventListener("click", () => showScreen("home"));
  el.btnReset.addEventListener("click", () => hardResetAll());

  el.tileBlackjack.addEventListener("click", () => enterBlackjack());

  el.btnNewRound.addEventListener("click", () => startNewRound());
  el.btnHit.addEventListener("click", () => onHit());
  el.btnStand.addEventListener("click", () => onStand());

  if (el.btnDouble) el.btnDouble.addEventListener("click", () => onDoubleDown());
  if (el.btnSplit) el.btnSplit.addEventListener("click", () => onSplit());

  el.btnControlPlayer.addEventListener("click", () => {
    setControlledSeat("player");
    closeRoleModal();
    setStatus("Place a bet (chips), then click “New round”.");
  });

  el.btnControlDealer.addEventListener("click", () => {
    setControlledSeat("dealer");
    closeRoleModal();
    setStatus("Place a bet (chips), then click “New round”.");
  });

  // Close modal when clicking scrim
  el.roleModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === "true") {
      closeRoleModal();
      setStatus("Place a bet (chips), then click “New round”.");
    }
  });

  // Bet spot click to add selected chip
  el.betSpot.addEventListener("click", () => {
    if (BJ.betLocked) return;
    if (!BJ.selectedChip) {
      setStatus("Select a chip first.");
      return;
    }
    const ok = addChipToBet(BJ.selectedChip);
    if (!ok) setStatus("Cannot add chip (insufficient bankroll or bet locked).");
  });

  el.btnUndoChip.addEventListener("click", () => undoChip());
  el.btnClearBet.addEventListener("click", () => clearBet());

  // Hotkeys
  window.addEventListener("keydown", (e) => {
    if (!screens.blackjack.classList.contains("is-active")) return;

    if (e.key === "h" || e.key === "H") el.btnHit.click();
    if (e.key === "s" || e.key === "S") el.btnStand.click();
    if (e.key === "n" || e.key === "N") el.btnNewRound.click();
    if (e.key === "d" || e.key === "D") el.btnDouble?.click();
    if (e.key === "p" || e.key === "P") el.btnSplit?.click();

    if (!BJ.betLocked) {
      if (e.key === "Backspace") {
        e.preventDefault();
        undoChip();
      }
      if (e.key === "c" || e.key === "C") clearBet();
    }

    if (e.key === "Escape") {
      if (!el.roleModal.classList.contains("is-hidden")) closeRoleModal();
    }
  });
}

/* --------------------------
   Init
-------------------------- */

function init() {
  wireEvents();
  showScreen("home");
  resetBlackjackState({ hard: true });
}

init();
