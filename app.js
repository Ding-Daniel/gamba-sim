"use strict";

/**
 * Card Simulator (static, GitHub Pages friendly)
 * Blackjack + Betting:
 * - Bankroll starts at 100,000
 * - You bet on the seat you control (Player or Dealer)
 * - Bet is placed via selectable chips, shown as a stacked pile
 * - Bet locks when a round begins
 *
 * Payouts:
 * - Normal win: +1x profit (bet returned + profit)
 * - Blackjack win (natural 21 with 2 cards): +1.5x profit (3:2)
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
  playerHand: $("#player-hand"),
  dealerScore: $("#dealer-score"),
  playerScore: $("#player-score"),
  status: $("#status"),
  deck: $("#deck"),
  animLayer: $("#anim-layer"),

  btnNewRound: $("#btn-new-round"),
  btnHit: $("#btn-hit"),
  btnStand: $("#btn-stand"),

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
        cards.push({
          rank: r,
          suit: s.sym,
          color: s.color,
        });
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
  { value: 25, label: "25", color: "#5ee6b2" },     // mint
  { value: 100, label: "100", color: "#5eb6ff" },   // blue
  { value: 500, label: "500", color: "#ff77ec" },   // pink
  { value: 1000, label: "1K", color: "#ffd36b" },   // gold
  { value: 5000, label: "5K", color: "#a78bfa" },   // purple
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
    // disable chip if can't afford right now
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

  // refund all
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

function renderBetStack() {
  el.betStack.innerHTML = "";

  // compress into groups so the stack doesn't get absurdly tall with small chips
  // Strategy: show up to 24 chips. If more, merge small chips into larger units visually.
  const chips = normalizeChipsForDisplay(BJ.betChips);

  const maxShown = 24;
  const shown = chips.slice(-maxShown); // show top stack
  const baseY = 52; // baseline within stack container
  const step = 4;   // vertical offset per chip

  for (let i = 0; i < shown.length; i++) {
    const v = shown[i];
    const chip = document.createElement("div");
    chip.className = "stack-chip";
    chip.style.background = `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), transparent 55%), ${chipColorForValue(v)}`;

    const y = baseY - i * step;
    chip.style.top = `${y}px`;

    // small random sideways jitter for realism (deterministic-ish)
    const jitter = ((i * 17) % 7) - 3; // [-3..3]
    chip.style.left = `calc(50% + ${jitter}px)`;

    // label only on top chip
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

function normalizeChipsForDisplay(chips) {
  // This is visual only; does not affect actual bet accounting.
  // Combine many small chips into larger denominations for display if stack is too big.
  if (chips.length <= 28) return chips.slice();

  const counts = new Map();
  for (const v of chips) counts.set(v, (counts.get(v) || 0) + 1);

  // greedily combine lower to higher when possible
  const denoms = CHIP_DENOMS.map((d) => d.value).slice().sort((a, b) => a - b);

  // helper to combine n of denom into next denom when exact ratio exists
  // we use ratios based on value (e.g., 4x25=100, 5x100=500, 2x500=1000, 5x1000=5000, 5x5000=25000)
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

  // expand back to list
  const out = [];
  for (const d of denoms) {
    const c = counts.get(d) || 0;
    for (let i = 0; i < c; i++) out.push(d);
  }
  return out;
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

  player: [],
  dealer: [],

  // if true, dealer's 2nd card is face-down (hidden from player)
  dealerHoleDown: true,

  // Betting
  bankroll: 100000,
  currentBet: 0,
  betChips: [],
  selectedChip: null,
  betLocked: false,
};

function resetBlackjackState({ hard = false } = {}) {
  BJ.shoe = buildShoe(4);
  BJ.phase = "idle";
  BJ.uiBusy = false;
  BJ.player = [];
  BJ.dealer = [];
  BJ.dealerHoleDown = true;

  // Betting reset (keep bankroll unless hard)
  BJ.currentBet = 0;
  BJ.betChips = [];
  BJ.selectedChip = null;
  BJ.betLocked = false;

  if (hard) BJ.bankroll = 100000;

  clearHandsUI();
  setStatus("Select chips and place a bet. Then click “New round”.");
  setButtonsEnabled({ newRound: true, hit: false, stand: false });

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
}

function clearHandsUI() {
  el.playerHand.classList.remove("bust", "win", "lose");
  el.dealerHand.classList.remove("bust", "win", "lose");
  el.playerHand.innerHTML = "";
  el.dealerHand.innerHTML = "";
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
  // Returns bestTotal (<=21 if possible), isSoft, isBlackjack (2-card 21)
  let total = 0;
  let aces = 0;
  let count = 0;

  for (const c of cards) {
    if (!includeFaceDown && c.faceDown) continue;
    total += cardBaseValue(c.rank);
    if (c.rank === "A") aces++;
    count++;
  }

  // Reduce Aces from 11 to 1 as needed
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

  // Placeholder to get exact target rect in the hand
  const slot = document.createElement("div");
  slot.style.width = "var(--card-w)";
  slot.style.height = "var(--card-h)";
  slot.style.flex = "0 0 auto";
  toHandEl.appendChild(slot);

  const targetRect = slot.getBoundingClientRect();

  // Floating card in anim layer
  const floating = makeCardElement(card, { faceDown });
  floating.style.position = "fixed";
  floating.style.left = "0px";
  floating.style.top = "0px";
  floating.style.margin = "0";
  floating.style.zIndex = "9999";

  // Start at deck
  const startX = deckRect.left + deckRect.width / 2 - targetRect.width / 2;
  const startY = deckRect.top + deckRect.height / 2 - targetRect.height / 2;

  // End at slot
  const endX = targetRect.left;
  const endY = targetRect.top;

  floating.style.transform = `translate(${startX}px, ${startY}px) rotate(-10deg) scale(0.96)`;
  el.animLayer.appendChild(floating);

  // Next frame: animate to target
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const anim = floating.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) rotate(-10deg) scale(0.96)` },
      { transform: `translate(${endX}px, ${endY}px) rotate(0deg) scale(1)` },
    ],
    {
      duration: 520,
      easing: "cubic-bezier(.2,.9,.2,1)",
    }
  );

  await anim.finished.catch(() => {});

  // Clean up
  el.animLayer.removeChild(floating);
  toHandEl.removeChild(slot);

  // Append as normal in hand
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

function setButtonsEnabled({ newRound, hit, stand }) {
  el.btnNewRound.disabled = !newRound;
  el.btnHit.disabled = !hit;
  el.btnStand.disabled = !stand;
}

function updateScoresUI() {
  // If player controls: dealer hole is hidden until dealer turn/round end
  const dealerIncludeHole = !(BJ.controlled === "player" && BJ.dealerHoleDown);

  const p = handTotals(BJ.player, { includeFaceDown: true });
  const d = handTotals(BJ.dealer, { includeFaceDown: dealerIncludeHole });

  el.playerScore.textContent = BJ.player.length ? String(p.total) : "—";

  if (!BJ.dealer.length) {
    el.dealerScore.textContent = "—";
  } else if (dealerIncludeHole) {
    el.dealerScore.textContent = String(d.total);
  } else {
    // show partial: visible total + " + ?"
    const visible = handTotals(BJ.dealer, { includeFaceDown: false }).total;
    el.dealerScore.textContent = `${visible} + ?`;
  }
}

function markOutcomeUI(outcome) {
  // outcome: "youWin" | "youLose" | "push"
  el.playerHand.classList.remove("win", "lose");
  el.dealerHand.classList.remove("win", "lose");

  const you = BJ.controlled;

  if (outcome === "push") return;

  if (you === "player") {
    if (outcome === "youWin") {
      el.playerHand.classList.add("win");
      el.dealerHand.classList.add("lose");
    } else {
      el.playerHand.classList.add("lose");
      el.dealerHand.classList.add("win");
    }
  } else {
    // you === dealer
    if (outcome === "youWin") {
      el.dealerHand.classList.add("win");
      el.playerHand.classList.add("lose");
    } else {
      el.dealerHand.classList.add("lose");
      el.playerHand.classList.add("win");
    }
  }
}

/* --------------------------
   Game flow
-------------------------- */

function drawCard() {
  if (BJ.shoe.length < 15) {
    // re-shoe (simple)
    BJ.shoe = buildShoe(4);
  }
  const c = BJ.shoe.pop();
  return { ...c, faceDown: false };
}

async function dealToPlayer() {
  const c = drawCard();
  BJ.player.push(c);
  await animateDeal(el.playerHand, c, { faceDown: false });
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

function currentControlledSeat() {
  return BJ.controlled; // "player" | "dealer"
}

function youHand() {
  return BJ.controlled === "player" ? BJ.player : BJ.dealer;
}

function oppHand() {
  return BJ.controlled === "player" ? BJ.dealer : BJ.player;
}

function settleBet({ outcome, youBlackjack }) {
  // outcome: "youWin" | "youLose" | "push"
  // bet was already removed from bankroll when chips were added.
  const bet = BJ.currentBet;

  if (bet <= 0) return { net: 0 };

  let net = 0;

  if (outcome === "push") {
    // return bet
    BJ.bankroll += bet;
    net = 0;
  } else if (outcome === "youLose") {
    // lost bet (already deducted)
    net = -bet;
  } else {
    // win: return bet + profit
    const profit = youBlackjack ? bet * 1.5 : bet * 1.0;
    BJ.bankroll += bet + profit;
    net = profit;
  }

  // reset bet for next round
  BJ.currentBet = 0;
  BJ.betChips = [];
  BJ.selectedChip = null;

  syncBankrollUI();
  syncBetUI();
  renderBetStack();
  syncChipTraySelection();
  syncBetHint();

  return { net };
}

function computeOutcomeAfterFinal() {
  const you = handTotals(youHand(), { includeFaceDown: true });
  const opp = handTotals(oppHand(), { includeFaceDown: true });

  const youBust = you.total > 21;
  const oppBust = opp.total > 21;

  if (youBust && oppBust) return { outcome: "push", youBlackjack: false }; // extremely rare with current flow
  if (youBust) return { outcome: "youLose", youBlackjack: false };
  if (oppBust) return { outcome: "youWin", youBlackjack: false };

  if (you.total > opp.total) return { outcome: "youWin", youBlackjack: you.blackjack };
  if (you.total < opp.total) return { outcome: "youLose", youBlackjack: false };
  return { outcome: "push", youBlackjack: false };
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

  clearHandsUI();
  BJ.player = [];
  BJ.dealer = [];

  BJ.phase = "dealing";
  setButtonsEnabled({ newRound: false, hit: false, stand: false });

  // Hide dealer hole only when controlling player (authentic)
  BJ.dealerHoleDown = BJ.controlled === "player";

  setStatus(`Dealing... Bet: ${formatMoney(BJ.currentBet)}`);
  await sleep(120);

  // Deal sequence: P, D, P, D(hole maybe)
  await dealToPlayer();
  await sleep(80);

  await dealToDealer({ faceDown: false });
  await sleep(80);

  await dealToPlayer();
  await sleep(80);

  await dealToDealer({ faceDown: BJ.dealerHoleDown });

  // Check naturals (both totals computed with hole included)
  const p = handTotals(BJ.player, { includeFaceDown: true });
  const d = handTotals(BJ.dealer, { includeFaceDown: true });

  if (p.blackjack || d.blackjack) {
    revealDealerHoleIfNeeded();
    await sleep(120);

    const you = handTotals(youHand(), { includeFaceDown: true });
    const opp = handTotals(oppHand(), { includeFaceDown: true });

    let outcome;
    if (you.blackjack && opp.blackjack) outcome = "push";
    else if (you.blackjack) outcome = "youWin";
    else outcome = "youLose";

    endRoundWithSettlement(outcome, { youBlackjack: you.blackjack, reason: "Blackjack resolution." });
    BJ.uiBusy = false;
    return;
  }

  // If controlling dealer, CPU plays player first
  if (BJ.controlled === "dealer") {
    setStatus("CPU Player turn...");
    BJ.phase = "playerTurn";
    await sleep(180);
    await cpuPlayPlayer();

    const pb = isBust(BJ.player, { includeFaceDown: true });
    if (pb) {
      el.playerHand.classList.add("bust");
      revealDealerHoleIfNeeded();
      endRoundWithSettlement("youWin", { youBlackjack: false, reason: "Player busts." });
      BJ.uiBusy = false;
      return;
    }

    // Dealer (YOU) now plays
    BJ.phase = "dealerTurn";
    setStatus("Your turn (Dealer). Hit or Stand.");
    setButtonsEnabled({ newRound: false, hit: true, stand: true });
    BJ.uiBusy = false;
    return;
  }

  // Otherwise, player (YOU) turn
  BJ.phase = "playerTurn";
  setStatus("Your turn (Player). Hit or Stand.");
  setButtonsEnabled({ newRound: false, hit: true, stand: true });
  BJ.uiBusy = false;
}

async function cpuPlayPlayer() {
  // Simple CPU: hit until total >= 17 (stands on soft 17)
  while (true) {
    const ht = handTotals(BJ.player, { includeFaceDown: true });
    if (ht.total > 21) return;

    if (ht.total < 17) {
      await sleep(160);
      await dealToPlayer();
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

function endRoundWithSettlement(outcome, { youBlackjack, reason }) {
  BJ.phase = "roundOver";

  updateScoresUI();
  markOutcomeUI(outcome);

  // settlement
  const { net } = settleBet({ outcome, youBlackjack });

  const you = handTotals(youHand(), { includeFaceDown: true });
  const opp = handTotals(oppHand(), { includeFaceDown: true });

  const outcomeText =
    outcome === "push" ? "Push" : (outcome === "youWin" ? "You win" : "You lose");

  const netText =
    outcome === "push" ? "0" : formatMoney(net);

  setStatus(
    `${outcomeText}. Net: ${netText}. (You ${you.total} vs Opp ${opp.total}) ${reason ? `— ${reason}` : ""}`
  );

  setButtonsEnabled({ newRound: true, hit: false, stand: false });
  unlockBet();
}

async function onHit() {
  if (BJ.uiBusy) return;
  if (!(BJ.phase === "playerTurn" || BJ.phase === "dealerTurn")) return;

  BJ.uiBusy = true;

  const seat = (BJ.phase === "playerTurn") ? "player" : "dealer";
  const youControl = currentControlledSeat() === seat;
  if (!youControl) {
    BJ.uiBusy = false;
    return;
  }

  if (seat === "player") {
    await dealToPlayer();
    const p = handTotals(BJ.player, { includeFaceDown: true });
    if (p.total > 21) {
      el.playerHand.classList.add("bust");
      revealDealerHoleIfNeeded();
      endRoundWithSettlement("youLose", { youBlackjack: false, reason: "You busted." });
    }
  } else {
    await dealToDealer({ faceDown: false });
    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    if (d.total > 21) {
      el.dealerHand.classList.add("bust");
      endRoundWithSettlement("youLose", { youBlackjack: false, reason: "You busted." });
    }
  }

  BJ.uiBusy = false;
}

async function onStand() {
  if (BJ.uiBusy) return;
  if (!(BJ.phase === "playerTurn" || BJ.phase === "dealerTurn")) return;

  const seat = (BJ.phase === "playerTurn") ? "player" : "dealer";
  const youControl = currentControlledSeat() === seat;
  if (!youControl) return;

  BJ.uiBusy = true;

  if (seat === "player") {
    // Switch to dealer CPU
    BJ.phase = "dealerTurn";
    setButtonsEnabled({ newRound: false, hit: false, stand: false });
    setStatus("Dealer turn...");
    await cpuPlayDealer();

    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    if (d.total > 21) el.dealerHand.classList.add("bust");

    const { outcome, youBlackjack } = computeOutcomeAfterFinal();
    endRoundWithSettlement(outcome, { youBlackjack, reason: "Round resolved." });

    BJ.uiBusy = false;
    return;
  }

  // seat === "dealer": resolve immediately (player already played CPU)
  setButtonsEnabled({ newRound: false, hit: false, stand: false });

  const d = handTotals(BJ.dealer, { includeFaceDown: true });
  if (d.total > 21) el.dealerHand.classList.add("bust");

  const { outcome, youBlackjack } = computeOutcomeAfterFinal();
  endRoundWithSettlement(outcome, { youBlackjack, reason: "Round resolved." });

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
  BJ.controlled = seat; // "player" | "dealer"
  updateRolePills();

  // reset bet UI (but keep bankroll) because "you" changed seats
  BJ.currentBet = 0;
  BJ.betChips = [];
  BJ.selectedChip = null;
  BJ.betLocked = false;
  renderBetStack();
  syncBetUI();
  syncChipTraySelection();
  syncBetHint();
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
