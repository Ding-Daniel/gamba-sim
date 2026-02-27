"use strict";

/**
 * Card Simulator (static, GitHub Pages friendly)
 * Blackjack:
 * - You choose which seat you control: Player or Dealer
 * - Other seat uses a simple CPU policy
 * - Dealer stands on soft 17 (CPU mode). If you control Dealer, you can hit/stand manually.
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
};

function resetBlackjackState() {
  BJ.shoe = buildShoe(4);
  BJ.phase = "idle";
  BJ.uiBusy = false;
  BJ.player = [];
  BJ.dealer = [];
  BJ.dealerHoleDown = true;

  clearHandsUI();
  setStatus("Pick “New round” to begin.");
  setButtonsEnabled({ newRound: true, hit: false, stand: false });
  updateRolePills();
  updateScoresUI();
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
  } else {
    el.playerRolePill.textContent = "CPU";
    el.dealerRolePill.textContent = "YOU";
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
  // outcome: "playerWin" | "dealerWin" | "push"
  el.playerHand.classList.remove("win", "lose");
  el.dealerHand.classList.remove("win", "lose");

  if (outcome === "playerWin") {
    el.playerHand.classList.add("win");
    el.dealerHand.classList.add("lose");
  } else if (outcome === "dealerWin") {
    el.playerHand.classList.add("lose");
    el.dealerHand.classList.add("win");
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
  // Flip UI + state
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

async function startNewRound() {
  if (BJ.uiBusy) return;
  BJ.uiBusy = true;

  clearHandsUI();
  BJ.player = [];
  BJ.dealer = [];

  BJ.phase = "dealing";
  setButtonsEnabled({ newRound: false, hit: false, stand: false });

  // Hide dealer hole only when controlling player (authentic)
  BJ.dealerHoleDown = BJ.controlled === "player";

  setStatus("Dealing...");
  await sleep(120);

  // Deal sequence: P, D, P, D(hole maybe)
  await dealToPlayer();
  await sleep(80);

  await dealToDealer({ faceDown: false });
  await sleep(80);

  await dealToPlayer();
  await sleep(80);

  await dealToDealer({ faceDown: BJ.dealerHoleDown });

  // Check naturals
  const p = handTotals(BJ.player, { includeFaceDown: true });
  const d = handTotals(BJ.dealer, { includeFaceDown: true });

  if (p.blackjack || d.blackjack) {
    revealDealerHoleIfNeeded();
    await sleep(120);

    if (p.blackjack && d.blackjack) {
      endRound({ outcome: "push", message: "Push — both have Blackjack." });
    } else if (p.blackjack) {
      endRound({ outcome: "playerWin", message: "Player wins — Blackjack." });
    } else {
      endRound({ outcome: "dealerWin", message: "Dealer wins — Blackjack." });
    }

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
      revealDealerHoleIfNeeded(); // dealer isn't hiding anyway here
      endRound({ outcome: "dealerWin", message: "Player busts. Dealer wins." });
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
  // (This is intentionally simple; you can upgrade to basic strategy later.)
  while (true) {
    const ht = handTotals(BJ.player, { includeFaceDown: true });
    if (ht.total > 21) return;

    if (ht.total < 17) {
      await sleep(160);
      await dealToPlayer();
      continue;
    }

    // stands on 17+
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

    // stand on 17+ (including soft 17)
    if (d.total >= 17) return;

    await sleep(180);
    await dealToDealer({ faceDown: false });
  }
}

function endRound({ outcome, message }) {
  BJ.phase = "roundOver";

  updateScoresUI();
  markOutcomeUI(outcome);

  const p = handTotals(BJ.player, { includeFaceDown: true });
  const d = handTotals(BJ.dealer, { includeFaceDown: true });

  setStatus(`${message} (Player ${p.total} vs Dealer ${d.total})`);
  setButtonsEnabled({ newRound: true, hit: false, stand: false });
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
      endRound({ outcome: "dealerWin", message: "Player busts. Dealer wins." });
    }
  } else {
    await dealToDealer({ faceDown: false });
    const d = handTotals(BJ.dealer, { includeFaceDown: true });
    if (d.total > 21) {
      el.dealerHand.classList.add("bust");
      endRound({ outcome: "playerWin", message: "Dealer busts. Player wins." });
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

    const p = handTotals(BJ.player, { includeFaceDown: true });
    const d = handTotals(BJ.dealer, { includeFaceDown: true });

    if (d.total > 21) {
      el.dealerHand.classList.add("bust");
      endRound({ outcome: "playerWin", message: "Dealer busts. Player wins." });
    } else if (d.total > p.total) {
      endRound({ outcome: "dealerWin", message: "Dealer wins." });
    } else if (d.total < p.total) {
      endRound({ outcome: "playerWin", message: "Player wins." });
    } else {
      endRound({ outcome: "push", message: "Push." });
    }

    BJ.uiBusy = false;
    return;
  }

  // seat === "dealer": resolve immediately (player already played CPU)
  setButtonsEnabled({ newRound: false, hit: false, stand: false });

  const p = handTotals(BJ.player, { includeFaceDown: true });
  const d = handTotals(BJ.dealer, { includeFaceDown: true });

  if (d.total > 21) {
    el.dealerHand.classList.add("bust");
    endRound({ outcome: "playerWin", message: "Dealer busts. Player wins." });
  } else if (p.total > 21) {
    el.playerHand.classList.add("bust");
    endRound({ outcome: "dealerWin", message: "Player busts. Dealer wins." });
  } else if (d.total > p.total) {
    endRound({ outcome: "dealerWin", message: "Dealer wins." });
  } else if (d.total < p.total) {
    endRound({ outcome: "playerWin", message: "Player wins." });
  } else {
    endRound({ outcome: "push", message: "Push." });
  }

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
}

/* --------------------------
   Navigation + wiring
-------------------------- */

function hardResetAll() {
  showScreen("home");
  resetBlackjackState();
  closeRoleModal();
}

function enterSelect() {
  showScreen("select");
}

function enterBlackjack() {
  showScreen("blackjack");
  resetBlackjackState();
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
    setStatus("Ready. Click “New round” to deal.");
  });

  el.btnControlDealer.addEventListener("click", () => {
    setControlledSeat("dealer");
    closeRoleModal();
    setStatus("Ready. Click “New round” to deal.");
  });

  // Close modal when clicking scrim
  el.roleModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === "true") {
      closeRoleModal();
      setStatus("Ready. Click “New round” to deal.");
    }
  });

  // Hotkeys
  window.addEventListener("keydown", (e) => {
    if (screens.blackjack.classList.contains("is-active")) {
      if (e.key === "h" || e.key === "H") el.btnHit.click();
      if (e.key === "s" || e.key === "S") el.btnStand.click();
      if (e.key === "n" || e.key === "N") el.btnNewRound.click();
      if (e.key === "Escape") {
        if (!el.roleModal.classList.contains("is-hidden")) closeRoleModal();
      }
    }
  });
}

/* --------------------------
   Init
-------------------------- */

function init() {
  wireEvents();
  showScreen("home");
  resetBlackjackState();
}

init();
