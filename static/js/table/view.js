// Il tavolo: schermate di passaggio del telefono, mulligan, campo, mano, combattimento,
// promemoria delle carte, diario, annulla e fine partita.
import { api, DEMO, ONLINE } from "../api.js";
import { RoomSync, mySeatIn } from "./net.js";
import {
  aName, cardName, confirmSheet, cost, esc, frameKey, icon, openSheet, plural, store, toast, typeIt,
} from "../ui.js";
import * as E from "./engine.js";
import { applySimple, condition, describe, effectKind, startChain } from "./effects.js";
import * as H from "./host.js";

export const VIEW = "table";

let S = null;            // stato della partita
let history = [];        // copie per "Annulla"
let host = null;         // contenitore del tavolo
let ui = freshUi();
let sync = null;         // partita a due telefoni: la stanza sul server
let mySeat = 0;          // il mio posto nella stanza
let foeOnline = null;    // l'altro telefono e' collegato? (null = non lo so)

function freshUi() { return { mode: null, sel: [], mulSel: [] }; }
const NET = () => !!(S && S.room);
// due telefoni: l'host e' chi ha creato la stanza; in pausa solo lui tocca il tavolo
const isHost = () => NET() && (S.host ?? 0) === mySeat;
const PAUSED = () => NET() && !!S.paused;
const hostName = () => (S.players[S.host ?? 0] || {}).name || "l'host";
// gli strumenti si usano su un telefono solo, oppure dall'host con la partita in pausa
const toolsNow = () => !NET() || (isHost() && PAUSED());
// la pila: oggetti, chi ha la parola, cosa si sta risolvendo
const STACK = () => (S && S.stack) || [];
const RESOLVING = () => (S && S.resolving ? E.stackItem(S, S.resolving) : null);
// due telefoni: con la pila aperta agisce solo chi ha la parola (o chi sta risolvendo)
function stackWait() {
  if (!NET() || PAUSED()) return "";
  const r = RESOLVING();
  if (r) return r.controller === mySeat ? "" : `Aspetta: ${P(r.controller).name} sta risolvendo ${E.itemName(S, r)}.`;
  if (STACK().length && S.prio && S.prio.p !== mySeat) return `Aspetta: la parola è di ${P(S.prio.p).name}.`;
  return "";
}
// lanciare, attivare, copiare: con la pila aperta solo chi ha la parola (gli altri tocchi restano liberi)
function stackOk() {
  const w = stackWait();
  if (w) toast(w);
  return !w;
}

function hostCtx() {
  return {
    get S() { return S; },
    commit: (fn) => commit(fn),
    get me() { return NET() ? mySeat : S.viewer; },
    get who() { return NET() ? "host" : S.viewer; },
    get net() { return NET(); },
    pick, pickCards, handCard, tokenCopy,
    askEnd: () => askEnd("Chi ha vinto?", null, "concessa"),
    openHand: () => handSheet(),
  };
}

function pauseGame(then = null) {
  const t = document.querySelector(".toast");
  if (t) t.hidden = true;
  commit((s) => {
    if (s.paused) return;
    s.paused = { by: s.host ?? 0, at: Date.now() };
    s.pauseAsk = null;
    E.hostLog(s, "partita in pausa.");
  }, { force: true });
  if (then) then();
}
const SAVED_TXT = ONLINE ? "Partita salvata online." : "Partita salvata nel database del PC.";

// ---- salvataggio nel browser ----------------------------------------------------------------
function save() {
  store.set("game", S);
  store.set("game-undo", history.slice(-15));
}

export function startNew(state, decks) {
  if (sync && sync.code !== state.room) { sync.stop(); sync = null; }
  S = state;
  history = [];
  ui = freshUi();
  store.set("game-decks", decks);
  save();
}

async function restore() {
  const saved = store.get("game");
  if (!saved) return false;
  let decks = store.get("game-decks");
  if (!decks || decks.length !== saved.players.length || decks.some((d, i) => d.slug !== saved.players[i].deck)) {
    decks = await Promise.all(saved.players.map((p) => api.get(`/api/decks/${encodeURIComponent(p.deck)}/table`)));
    store.set("game-decks", decks);
  }
  E.setDecks(decks);
  S = saved;
  history = store.get("game-undo", []) || [];
  return true;
}

// ---- ciclo: azione -> copia per annulla -> effetto -> salva -> ridisegna ---------------------
function commit(fn, { undoable = true, force = false } = {}) {
  if (PAUSED() && !isHost() && !force) { toast(`Partita in pausa: aspetta che ${hostName()} riprenda.`); return; }
  if (NET()) {
    startChain(S);
    fn(S);
    afterAction();
    save();
    draw();
    if (sync) sync.push(fn, undoable ? "move" : "auto");
    return;
  }
  if (undoable) {
    history.push(JSON.stringify(S));
    if (history.length > 60) history.shift();
  }
  startChain(S);
  fn(S);
  afterAction();
  save();
  draw();
}

function afterAction() {
  if (S.over) return;
  if (S.mode === "duo") {
    const dead = S.players.findIndex((p) => p.life <= 0);
    if (dead >= 0 && S.askedDeath !== `${dead}:${S.players[dead].life}`) {
      S.askedDeath = `${dead}:${S.players[dead].life}`;
      setTimeout(() => askDeath(dead), 50);
    }
    const sick = S.players.findIndex((p) => (p.poison || 0) >= 10);
    if (sick >= 0 && S.askedPoison !== `${sick}:${S.players[sick].poison}`) {
      S.askedPoison = `${sick}:${S.players[sick].poison}`;
      setTimeout(() => askDeath(sick, "veleno"), 50);
    }
  }
  if (S.emptyDraw != null) {
    const p = S.emptyDraw;
    S.emptyDraw = null;
    setTimeout(() => askEnd(`${S.players[p].name} non ha più carte da pescare.`, 1 - p, "grimorio"), 50);
  }
}

async function netUndo() {
  if (!sync) return;
  const last = (S.log[S.log.length - 1] || {}).text || "";
  const r = await sync.undo(last);
  if (r && r.ok) {
    ui = freshUi();
    await ensureDecks();
    save();
    draw();
    toast("Ultima mossa annullata.");
  } else if (r && r.error === "nothing") toast("Non c'è niente da annullare.");
  else if (r && r.error === "too_old") toast("Non posso annullare più indietro di così.");
  else toast("Non riesco ad annullare adesso: riprova tra un attimo.");
}

function undo() {
  if (NET()) { netUndo(); return; }
  if (!history.length) { toast("Non c'è niente da annullare."); return; }
  S = JSON.parse(history.pop());
  ui = freshUi();
  save();
  draw();
  toast("Ultima mossa annullata.");
}

// ---- ingresso dalla pagina --------------------------------------------------------------------
export async function render(root) {
  root.innerHTML = `<div class="table-host" id="table-host"></div>`;
  host = root.querySelector("#table-host");
  if (!S) {
    const ok = await restore().catch((e) => { toast(e.message, 5000); return false; });
    if (!ok) { location.hash = "#/tavolo/nuova"; return; }
  }
  if (NET()) {
    const me = mySeatIn(S.room);
    if (!me) { location.hash = `#/stanza/${S.room}`; return; }
    mySeat = me.seat;
    if (!sync || sync.code !== S.room || sync.stopped) {
      host.innerHTML = `<div class="handoff"><p class="muted">Mi collego alla stanza ${esc(S.room)}…</p></div>`;
      await startSync(me);
    }
  }
  keepAwake();
  host.addEventListener("click", onClick);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("contextmenu", (e) => { if (e.target.closest("[data-card],[data-group]")) e.preventDefault(); });
  draw();
}

export function leave() {
  if (S) save();
  if (sync) { sync.stop(); sync = null; }
  netStatus("ok");
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

// ---- partita a due telefoni -------------------------------------------------------------------
const tableDecks = new Map();
async function tableDeck(slug) {
  if (!tableDecks.has(slug)) tableDecks.set(slug, api.get(`/api/decks/${encodeURIComponent(slug)}/table`).catch((e) => { tableDecks.delete(slug); throw e; }));
  return tableDecks.get(slug);
}

// i mazzi del motore devono essere quelli della partita (anche dopo una sideboard)
async function ensureDecks() {
  const want = S.players.map((p) => p.deck);
  const cur = E.getDecks();
  const same = cur.length === want.length && cur.every((d, i) => d.slug === want[i]);
  if (same && !S.deckLists) return;
  let decks = await Promise.all(want.map(tableDeck));
  if (S.deckLists) decks = decks.map((d, i) => (S.deckLists[i] ? { ...d, main: S.deckLists[i].main, side: S.deckLists[i].side } : d));
  E.setDecks(decks);
  store.set("game-decks", decks);
}

async function startSync(me) {
  if (sync) sync.stop();
  sync = new RoomSync({
    code: S.room, seat: me.seat, name: me.name,
    getState: () => S,
    setState: (st) => { if (st) S = st; },
    replay: (fn) => { startChain(S); fn(S); },
    onRemote: (info) => remoteChanged(info),
    onStatus: netStatus,
    onPresence: (seats) => {
      const on = seats.includes(1 - mySeat);
      if (on !== foeOnline) { foeOnline = on; if (host && host.isConnected && !sb) draw(); }
    },
  });
  try { await sync.start(); } catch (e) { toast(e.message, 6000); }
  await ensureDecks().catch((e) => toast(e.message, 5000));
  save();
}

let seenPause = null;
let seenAsk = null;
async function remoteChanged(info = {}) {
  await ensureDecks().catch(() => {});
  save();
  const pauseKey = S.paused ? S.paused.at : null;
  const askKey = S.pauseAsk ? S.pauseAsk.at : null;
  if (info.undo) toast(`Annullata: ${info.undo}`, 3500);
  else if (info.dropped) toast("Una tua mossa non valeva più dopo quella dell'altro: rifalla.", 4500);
  else if (pauseKey !== seenPause && !isHost()) toast(pauseKey ? `${hostName()} ha messo in pausa la partita.` : "Si riprende a giocare.", 3500);
  else if (askKey && askKey !== seenAsk && isHost()) toast(`${P(S.pauseAsk.by).name} chiede una pausa: tocca il tasto pausa in alto.`, 4500);
  seenPause = pauseKey;
  seenAsk = askKey;
  if (PAUSED() && !isHost()) closeSheets();
  if (ui.mode && S.active !== mySeat) ui = freshUi();
  if (host && host.isConnected && !sb) draw();
}

// chiude i fogli aperti (l'host ha messo in pausa: qui non si tocca niente)
function closeSheets() {
  document.querySelectorAll(".sheet-back").forEach((b) => { const x = b.querySelector("[data-sheet-close]"); if (x) x.click(); });
}

function netStatus(st) {
  let el = document.getElementById("net-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "net-status";
    el.className = "net-status";
    el.setAttribute("role", "status");
    el.hidden = true;
    document.body.appendChild(el);
  }
  el.hidden = st === "ok";
  el.textContent = st === "offline" ? "Senza rete: la mossa parte appena torna" : st === "error" ? "La stanza non risponde più" : "";
}

// schermo sempre acceso durante la partita (dove il browser lo permette)
let wakeLock = null;
async function keepAwake() {
  try {
    if (!wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch { /* non permesso: pazienza */ }
}
document.addEventListener("visibilitychange", () => { if (host && host.isConnected) keepAwake(); });

function drawWait(text, sub = "") {
  const other = P(1 - mySeat);
  host.innerHTML = `<div class="handoff">
    <div class="handoff-card sl-${esc(other.sleeve)}" aria-hidden="true"><span></span></div>
    <h1>${esc(text)}</h1>
    <p class="muted">${esc(sub || `Stanza ${S.room}. Questa schermata cambia da sola appena tocca a te.`)}</p>
    <a class="btn btn-quiet" href="#/">Esci (la partita resta)</a>
  </div>`;
}

const mulSeat = () => (NET() ? mySeat : S.mulliganTurn);

// ---- disegno --------------------------------------------------------------------------------
function draw() {
  if (!host) return;
  document.documentElement.classList.add("in-table");
  if (sb) return drawSideboard();
  if (NET()) {
    S.viewer = mySeat;
    S.locked = false;
    if (S.over && S.sbNext) {
      if (mySeat === 0 && S.sbNext.ready.every(Boolean)) { netRematch(); return undefined; }
      if (!S.sbNext.ready[mySeat]) { startSideboard(); return undefined; }
      return drawWait(`Aspetta la sideboard di ${P(1 - mySeat).name}`, "Sceglie le carte da cambiare senza farle vedere.");
    }
  }
  if (S.over) return drawEnd();
  if (S.phase === "mulligan") {
    if (NET()) return P(mySeat).kept ? drawWait(`Aspetta che ${P(1 - mySeat).name} tenga la mano`) : drawMulligan();
    if (S.locked) return drawHandoff("mull");
    return drawMulligan();
  }
  if (S.locked) return drawHandoff(S.respond != null ? "respond" : "turn");
  if (S.step === "start" && !PAUSED() && (!NET() || S.active === mySeat)) {   // primo sguardo del turno: stappa, mantenimento, pescata
    commit((s) => { if (s.step === "start") E.beginTurn(s); }, { undoable: false });
    return undefined;
  }
  drawMat();
}

const P = (i) => S.players[i];

function drawHandoff(kind) {
  let who;
  let title;
  let sub;
  let btn;
  if (kind === "mull") {
    who = S.mulliganTurn;
    title = `Mano iniziale di ${P(who).name}`;
    sub = `Passa il telefono ${aName(P(who).name)}. Gli altri non guardano.`;
    btn = `Sono ${P(who).name}: vedo la mano`;
  } else if (kind === "respond") {
    who = S.respond;
    title = `${P(who).name} vuole rispondere`;
    sub = `Passa il telefono ${aName(P(who).name)}: potrà giocare un istantaneo o un'abilità, poi lo ridà.`;
    btn = `Sono ${P(who).name}`;
  } else if (S.backTo != null) {
    who = S.backTo;
    title = `Torna ${aName(P(who).name)}`;
    sub = `Ridai il telefono ${aName(P(who).name)} per continuare il suo turno.`;
    btn = `Sono ${P(who).name}`;
  } else {
    who = S.active;
    title = `Tocca ${aName(P(who).name)}`;
    sub = `Passa il telefono ${aName(P(who).name)}. Turno ${S.turn}.`;
    btn = `Sono ${P(who).name}: inizia il turno`;
  }
  host.innerHTML = `<div class="handoff">
    <div class="handoff-card sl-${esc(P(who).sleeve)}" aria-hidden="true"><span></span></div>
    <h1>${esc(title)}</h1>
    <p class="muted">${esc(sub)}</p>
    ${kind !== "mull" ? `<p class="handoff-lives">${S.players.map((p) => `<span>${esc(p.name)} <strong class="num">${p.life}</strong></span>`).join("")}</p>` : ""}
    <button class="btn btn-object btn-big" data-act="unlock">${esc(btn)}</button>
    <a class="btn btn-quiet" href="#/">Esci e salva la partita</a>
  </div>`;
}

// ---- mulligan --------------------------------------------------------------------------------
function drawMulligan() {
  const p = mulSeat();
  const pl = P(p);
  const toBottom = pl.mulligans;
  const lands = pl.hand.filter((id) => E.info(S, id)?.is_land).length;
  const choosing = ui.mode === "bottom";
  host.innerHTML = `<div class="mull">
    <p class="micro">Mano iniziale di ${esc(pl.name)}${pl.mulligans ? `, dopo ${pl.mulligans} mulligan` : ""}</p>
    <h1>${choosing ? `Scegli ${plural(toBottom, "carta", "carte")} da mettere in fondo` : `${plural(lands, "terra", "terre")} su 7`}</h1>
    <p class="muted small">${choosing ? `Ne hai scelte ${ui.mulSel.length}.` : mulAdvice(lands, pl.mulligans)}</p>
    <div class="mull-hand">${pl.hand.map((id) => handCard(id, { selectable: choosing, selected: ui.mulSel.includes(id), act: choosing ? "mulpick" : "peek" })).join("")}</div>
    <div class="mull-actions">
      ${choosing
        ? `<button class="btn btn-object btn-big" data-act="mulkeep" ${ui.mulSel.length === toBottom ? "" : "disabled"}>Tengo queste ${7 - toBottom}</button>
           <button class="btn btn-big" data-act="mulback">Indietro</button>`
        : `<button class="btn btn-object btn-big" data-act="keep">${pl.mulligans ? `Tengo (poi ne metto ${toBottom} in fondo)` : "Tengo"}</button>
           <button class="btn btn-big" data-act="mull" ${pl.mulligans >= 6 ? "disabled" : ""}>Mulligan</button>`}
    </div>
  </div>`;
}

function mulAdvice(lands, m) {
  const size = 7 - m;
  const bad = size === 7 ? [0, 1, 6, 7] : size === 6 ? [0, 1, 5, 6] : size === 5 ? [0, 1, 5] : [];
  const kept = size === 7 ? lands : lands;
  if (bad.includes(kept)) return `La regola di Karsten dice mulligan con ${kept} terre${size < 7 ? ` quando tieni ${size} carte` : ""}. Decidi tu.`;
  return "La regola di Karsten (solo sulle terre) dice di tenerla.";
}

// ---- il tappetino --------------------------------------------------------------------------
function drawMat() {
  const me = S.viewer;
  const foe = S.mode === "solo" ? null : 1 - me;
  const mine = me === S.active;
  host.innerHTML = `<div class="table ${S.mode === "solo" ? "solo" : ""} ${ui.mode ? `mode-${ui.mode}` : ""} ${S.pending.length ? "has-pile" : ""} ${PAUSED() ? (isHost() ? "paused host-on" : "paused") : ""}">
    ${foe == null ? dummySide() : side(foe, "top")}
    ${midline(mine)}
    ${stackZone()}
    ${pile()}
    ${side(me, "bottom")}
    ${actions(mine)}
    ${handRail(me)}
  </div>`;
  const pileEl = host.querySelector(".pile");
  if (pileEl) pileEl.scrollTop = 0;
  fitRows();
}

// Carte piu' piccole quando in una fila ce ne sono tante: tutto il campo resta visibile.
// Le tappate occupano 1,4 volte la larghezza. Sotto la misura minima si va a capo.
function fitRows() {
  if (!host) return;
  for (const row of host.querySelectorAll(".row")) {
    const slots = [...row.querySelectorAll(":scope > .slot")];
    row.classList.remove("small");
    if (!slots.length) { row.style.removeProperty("--fit"); continue; }
    const cs = getComputedStyle(row);
    const gap = parseFloat(cs.columnGap) || 6;
    const avail = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
    const isLand = row.classList.contains("lands");
    const top = !!row.closest(".side.top");
    const base = parseFloat(getComputedStyle(host.querySelector(".table")).getPropertyValue(isLand ? "--lw" : top ? "--cw-top" : "--cw")) || 60;
    const unit = (el) => (el.classList.contains("tapped") ? 1.397 : 1) + (el.classList.contains("stacked") ? 0.12 : 0);
    const widthFor = (perRow) => {
      // la fila piu' "larga" con perRow carte: prendi le carte nell'ordine e misura a gruppi
      let worst = 0;
      for (let i = 0; i < slots.length; i += perRow) {
        const grp = slots.slice(i, i + perRow);
        const u = grp.reduce((t, el) => t + unit(el), 0);
        worst = Math.max(worst, u + (gap * (grp.length - 1)) / 100);
      }
      return worst;
    };
    const readable = isLand ? 40 : top ? 48 : 58;
    let w = base;
    for (let rows = 1; rows <= 3; rows++) {
      const per = Math.ceil(slots.length / rows);
      const grp = slots.slice(0, per);
      const u = grp.reduce((t, el) => t + unit(el), 0);
      const fit = Math.floor((avail - gap * (per - 1)) / Math.max(u, widthFor(per) - (gap * (per - 1)) / 100));
      w = Math.min(base, fit);
      if (w >= readable || rows === 3) break;
    }
    w = Math.max(isLand ? 30 : 38, w);
    row.style.setProperty("--fit", `${w}px`);
    row.dataset.base = String(base);
    row.dataset.min = String(isLand ? 30 : 38);
    row.classList.toggle("small", w < base * 0.8);
  }
  // se un lato non ci sta in altezza, rimpicciolisci la fila con le carte piu' grandi
  for (const side of host.querySelectorAll(".side")) {
    for (let guard = 0; guard < 40 && side.scrollHeight > side.clientHeight + 1; guard++) {
      const rows = [...side.querySelectorAll(".row")].filter((r) => r.style.getPropertyValue("--fit"));
      const big = rows.map((r) => ({ r, w: parseFloat(r.style.getPropertyValue("--fit")) }))
        .filter((x) => x.w > parseFloat(x.r.dataset.min)).sort((a, b) => b.w - a.w)[0];
      if (!big) break;
      const w = Math.max(parseFloat(big.r.dataset.min), big.w - 4);
      big.r.style.setProperty("--fit", `${w}px`);
      big.r.classList.toggle("small", w < parseFloat(big.r.dataset.base) * 0.8);
    }
  }
}
window.addEventListener("resize", () => { if (host && host.isConnected) fitRows(); });

function lifeTurn(p) {
  const pl = P(p);
  const parts = [];
  if (pl.gained) parts.push(`+${pl.gained}`);
  if (pl.lost) parts.push(`−${pl.lost}`);
  return parts.length ? `<span class="life-turn" title="in questo turno">${parts.join(" ")}<span class="lt-word"> nel turno</span></span>` : "";
}

function strip(p, where) {
  const pl = P(p);
  const isViewer = p === S.viewer;
  const respond = !NET() && !isViewer && S.mode === "duo" && S.viewer === S.active && !STACK().length
    ? `<button class="btn small-btn respond-btn" data-act="respond" data-p="${p}" aria-label="Passa il telefono ${esc(aName(pl.name))} per rispondere">${icon("hand")}Risponde</button>` : "";
  const off = NET() && !isViewer && foeOnline === false ? '<span class="foe-off">non collegato</span>' : "";
  return `<div class="strip ${where}">
    <button class="life" data-act="life" data-p="${p}" aria-label="Vite di ${esc(pl.name)}: ${pl.life}. Tocca per cambiarle">
      <span class="life-name">${esc(pl.name)}${p === S.active ? '<span class="turn-dot" title="turno"></span>' : ""}${off}</span>
      <span class="life-n num">${pl.life}</span>${lifeTurn(p)}
      ${H.playerChips(S, p).map((t) => `<span class="pchip">${esc(t)}</span>`).join("")}
    </button>
    <div class="zones">
      ${!isViewer ? `<span class="zc" aria-label="Mano: ${pl.hand.length} carte">${icon("hand")}<b class="num">${pl.hand.length}</b></span>` : ""}
      <button class="zc" data-act="zone" data-p="${p}" data-z="library" aria-label="Grimorio: ${pl.library.length} carte">${icon("library")}<b class="num">${pl.library.length}</b></button>
      <button class="zc" data-act="zone" data-p="${p}" data-z="graveyard" aria-label="Cimitero: ${pl.graveyard.length} carte">${icon("graveyard")}<b class="num">${pl.graveyard.length}</b></button>
      <button class="zc ${E.exilePlayable(S, p).length && isViewer ? "has-playable" : ""}" data-act="zone" data-p="${p}" data-z="exile" aria-label="Esilio: ${pl.exile.length} carte${E.exilePlayable(S, p).length && isViewer ? `, ${E.exilePlayable(S, p).length} che puoi giocare` : ""}">${icon("exile")}<b class="num">${pl.exile.length}</b></button>
      ${respond}
    </div>
  </div>`;
}

function side(p, where) {
  const pl = P(p);
  const lands = [];
  const others = [];
  for (const id of pl.battlefield) (E.info(S, id)?.is_land ? lands : others).push(id);
  const othersRow = `<div class="row field" aria-label="Creature e altri permanenti di ${esc(pl.name)}">${others.length ? others.map((id) => slot(id)).join("") : `<span class="row-empty">${where === "bottom" ? "Le tue creature" : "Creature"}</span>`}</div>`;
  const landsRow = `<div class="row lands" aria-label="Terre di ${esc(pl.name)}">${lands.length ? landGroups(lands).map(groupSlot).join("") : `<span class="row-empty">Terre</span>`}</div>`;
  const field = `<section class="side ${where} sl-${esc(pl.sleeve)}" aria-label="Campo di ${esc(pl.name)}">
    ${where === "top" ? landsRow + othersRow : othersRow + landsRow}
  </section>`;
  return where === "top" ? strip(p, where) + field : field + strip(p, where);
}

function dummySide() {
  return `<div class="strip top dummy">
      <div class="life static"><span class="life-name">Avversario finto</span><span class="life-n num">${S.dummy.life}</span></div>
      <p class="micro dummy-note">Non gioca e non blocca: conta in quanti turni lo porti a 0.</p>
    </div>`;
}

function slot(id) {
  const c = S.cards[id];
  const i = E.info(S, id);
  const pw = E.power(S, id);
  const k = E.keywords(S, id);
  const cnt = Object.entries(c.counters).filter(([kk]) => kk !== "P1P1" && kk !== "M1M1" && kk !== "LOYALTY");
  const plus = (c.counters.P1P1 || 0) - (c.counters.M1M1 || 0);
  const selected = ui.sel.includes(id);
  const sickNow = E.sick(S, id);
  void k;
  const flags = H.keywordFlags(S, id);
  const tags = H.cardTags(S, id, S.viewer);
  const printedPt = (i && i.pt) || "";
  const changed = pw && (plus || `${pw.p}/${pw.t}` !== printedPt);
  const aria = [E.displayName(S, id), pw ? `${pw.p}/${pw.t}` : "", c.tapped ? "tappata" : "", c.attacking ? "in attacco" : "",
    c.blocked ? "bloccata" : "", selected ? "scelta per attaccare" : "", ...flags, ...tags].filter(Boolean).join(", ");
  return `<div class="slot ${c.tapped ? "tapped" : ""}">
    <button class="tcard ${c.attacking ? "attacking" : ""} ${c.blocked ? "blocked" : ""} ${selected ? "selected" : ""} ${c.token ? "token" : ""} ${c.faceDown ? "facedown" : ""}" data-card="${id}" aria-label="${esc(aria)}">
      <span class="face f-${c.faceDown ? "C" : frameKey(i)}">
        <span class="tc-name" lang="it">${esc(E.shortName(S, id))}</span>
        ${flags.length ? `<span class="tc-flags">${esc(flags.join(" "))}</span>` : ""}
        ${tags.length ? `<span class="tc-tags">${esc(tags.join(" · "))}</span>` : ""}
        ${c.counters.LOYALTY != null ? `<span class="tc-loyal num">${c.counters.LOYALTY}</span>` : ""}
        ${plus ? `<span class="tc-plus num">${plus > 0 ? "+" : ""}${plus}</span>` : ""}
        ${cnt.length ? `<span class="tc-cnt">${cnt.map(([kk, v]) => `${v} ${esc((E.COUNTER_IT[kk] || kk).replace("segnalino ", ""))}`).join(", ")}</span>` : ""}
        ${c.solved ? `<span class="tc-solved">risolto</span>` : ""}
        ${pw ? `<span class="tc-pt num ${changed ? "mod" : ""}">${pw.p}/${pw.t}</span>` : ""}
      </span>
      ${sickNow && ui.mode === "attack" && c.controller === S.active ? `<span class="tc-sick">appena entrata</span>` : ""}
    </button>
  </div>`;
}

function landGroups(ids) {
  const groups = new Map();
  for (const id of ids) {
    const c = S.cards[id];
    const key = `${c.name}|${c.tapped ? 1 : 0}|${c.chosen || ""}|${Object.keys(c.counters).length ? id : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  return [...groups.values()];
}

function groupSlot(ids) {
  const id = ids[0];
  const c = S.cards[id];
  const i = E.info(S, id);
  const prod = (i && i.produces) || "";
  const n = ids.length;
  return `<div class="slot land ${c.tapped ? "tapped" : ""} ${n > 1 ? "stacked" : ""}">
    <button class="tcard" data-group="${ids.join(",")}" aria-label="${esc(`${E.displayName(S, id)}${n > 1 ? `, ${n} carte` : ""}${c.tapped ? ", tappate" : ""}. Tocca per ${c.tapped ? "stapparne" : "tapparne"} una`)}">
      ${n > 1 ? '<span class="under u2"></span>' : ""}${n > 2 ? '<span class="under u3"></span>' : ""}
      <span class="face f-L">
        <span class="tc-name" lang="it">${esc(E.shortName(S, id))}</span>
        <span class="tc-prod">${[...prod.replace("C", "")].slice(0, 5).map((x) => `<i class="pip ${x}"></i>`).join("")}${c.chosen ? `<em>${esc(c.chosen)}</em>` : ""}</span>
      </span>
      ${n > 1 ? `<span class="tc-count num">×${n}</span>` : ""}
    </button>
  </div>`;
}

// La riga di stato al centro: dice cosa succede e cosa tocca fare (come il riquadro dei messaggi
// di Magic Online). "me" = tocca a chi guarda questo telefono; "wait" = si aspetta qualcun altro.
function prompt(mine) {
  const who = P(S.active).name;
  const solo = S.mode === "solo";
  if (PAUSED()) return isHost() ? { text: "Pausa: tocca quello che vuoi cambiare", me: true } : { text: `Pausa: ${hostName()} sistema il tavolo`, me: false };
  if (ui.mode === "attack") return { text: "Scegli chi attacca", me: true };
  if (ui.mode === "blocks") return { text: "Tocca gli attaccanti bloccati", me: true };
  if (STACK().length) {
    const r = RESOLVING();
    if (r) return !NET() || r.controller === mySeat ? { text: `Si risolve ${E.itemName(S, r)}: fai l'effetto`, me: true } : { text: `${P(r.controller).name} risolve ${E.itemName(S, r)}`, me: false };
    if (NET() && S.prio) return S.prio.p === mySeat ? { text: "Rispondi o lascia risolvere", me: true } : { text: `${P(S.prio.p).name} può rispondere`, me: false };
    if (!NET()) return { text: "Pila: rispondete o risolvete", me: true };
  }
  if (NET() && S.pauseAsk && isHost()) return { text: `${P(S.pauseAsk.by).name} chiede una pausa`, me: true };
  if (NET() && S.combat) {
    const foe = P(1 - S.active).name;
    if (S.combat.stage === "blocks") return mine ? { text: `Aspetta: ${foe} sceglie i blocchi`, me: false } : { text: `${who} attacca: tocca chi blocchi`, me: true };
    if (S.combat.stage === "damage") return mine ? { text: "Blocchi fatti: calcola i danni", me: true } : { text: `Aspetta i danni di ${who}`, me: false };
  }
  if (solo) return { text: `Turno ${P(0).turnsTaken}${S.step === "end" ? ": fine del turno" : ""}`, me: true };
  if (NET() && !mine) return { text: `Turno ${S.turn} di ${who}: puoi rispondere`, me: false };
  if (S.step === "end") return { text: "Fine del turno: passa quando vuoi", me: true };
  return { text: NET() ? `Turno ${S.turn}: tocca a te` : `Turno ${S.turn}: tocca a ${who}`, me: true };
}

function midline(mine) {
  const pr = prompt(mine);
  const asked = NET() && !S.paused && S.pauseAsk && isHost();
  const pauseBtn = isHost() && !S.paused && !S.over
    ? `<button class="btn ${asked ? "btn-object" : "btn-quiet"} btn-round" data-act="pause" aria-label="Metti in pausa la partita">${icon("pause")}</button>` : "";
  return `<div class="midline ${PAUSED() ? "paused" : pr.me ? "me" : "wait"}">
    <span class="mid-text" role="status">${esc(pr.text)}</span>
    <span class="mid-tools">${pauseBtn}
      <button class="btn btn-quiet btn-round" data-act="undo" aria-label="Annulla l'ultima mossa" ${history.length || NET() ? "" : "disabled"}>${icon("undo")}</button>
      <button class="btn btn-quiet btn-round" data-act="diary" aria-label="Diario della partita">${icon("diary")}</button>
    </span>
  </div>`;
}

// la pila: la cima in alto, piena; sotto le altre, in breve
function stackZone() {
  const st = STACK();
  if (!st.length) return "";
  const items = st.slice().reverse().map((it, k) => {
    const res = S.resolving === it.sid;
    const ctl = P(it.controller);
    // le righe del testo diventano frasi ("Lampo. Questa magia costa…")
    const txt = E.itemText(S, it).split(/\n+/).map((l) => l.trim()).filter(Boolean)
      .map((l) => (/[.!?:)»"]$/.test(l) ? l : `${l}.`)).join(" ");
    return `<li class="sitem sl-${esc(ctl.sleeve)} ${k === 0 ? "top" : ""} ${res ? "resolving" : ""}">
      <button class="sitem-body" data-act="stackitem" data-sid="${esc(it.sid)}" aria-label="${esc(`${E.itemName(S, it)}, di ${ctl.name}${res ? ", si sta risolvendo" : k === 0 ? ", in cima" : ""}`)}">
        <span class="si-name" lang="it">${esc(E.itemName(S, it))}</span>
        <span class="si-who">${esc(ctl.name)}${res ? ", si risolve" : k === 0 ? ", in cima" : ""}</span>
        ${txt ? `<span class="si-text">${esc(txt.length > 160 ? `${txt.slice(0, 157)}…` : txt)}</span>` : ""}
      </button></li>`;
  }).join("");
  const prio = !S.resolving && S.prio && NET() ? `la parola a ${S.prio.p === mySeat ? "te" : P(S.prio.p).name}` : "";
  return `<section class="stack-zone" aria-label="La pila">
    <div class="stack-head"><span>La pila <b class="num">${st.length}</b></span>${prio ? `<span class="stack-prio">${esc(prio)}</span>` : ""}</div>
    <ol class="stack-list">${items}</ol>
  </section>`;
}

function pile() {
  if (!S.pending.length) return "";
  const items = S.pending.map((q) => {
    const d = describe(S, q);
    const auto = isAuto(q);
    const theirs = NET() && q.controller !== mySeat;
    return `<li class="slip sl-${esc(P(q.controller).sleeve)}">
      <div class="slip-body" ${d.manual ? `data-act="slipinfo" data-pid="${q.pid}"` : ""}><span class="slip-src">${esc(d.who)}</span><span class="slip-text">${esc(d.text)}</span></div>
      ${theirs ? `<div class="slip-acts"><span class="micro">la risolve ${esc(P(q.controller).name)}</span></div>` : `<div class="slip-acts">
        <button class="btn btn-object small-btn" data-act="pend" data-pid="${q.pid}">${auto ? "Applica" : verbFor(q)}</button>
        <button class="btn btn-quiet small-btn" data-act="pendskip" data-pid="${q.pid}">Salta</button>
      </div>`}</li>`;
  }).join("");
  const autoN = S.pending.filter((q) => isAuto(q) && (!NET() || q.controller === mySeat)).length;
  return `<section class="pile" aria-label="Abilità da risolvere">
    <div class="pile-head"><span>Da risolvere <b class="num">${S.pending.length}</b></span>
      ${autoN > 1 ? `<button class="btn btn-quiet small-btn" data-act="pendall">Applica le automatiche (${autoN})</button>` : ""}</div>
    <ul>${items}</ul>
  </section>`;
}

function verbFor(q) {
  const kinds = (q.trig.do || []).map(effectKind);
  if (kinds.includes("explore")) return "Esplora";
  if (kinds.includes("surveil") || kinds.includes("scry")) return "Guarda";
  if (kinds.some((k) => ["return", "discard", "damage_target", "counter_target"].includes(k))) return "Scegli";
  if (kinds.every((k) => k === "note")) return "Fatto";
  return "Avanti";
}

function isAuto(q) {
  return !!q.trig.auto && (q.trig.do || []).every((e) => effectKind(e) === "simple");
}

// Barra delle azioni: a sinistra fino a tre tasti secondari (Altro sempre per primo), a destra
// il tasto principale, sempre nello stesso posto, che dice cosa succede dopo (come il tasto
// grande di MTG Arena). Quando non tocca a te, al suo posto c'e' una scritta di attesa.
const B = (act, ic, label, extra = {}) => ({ act, icon: ic, label, ...extra });
const MORE = B("more", "more", "Altro");

function bar(side, main) {
  const sideHtml = side.map((b) => `<button class="btn act2" data-act="${b.act}" ${b.p != null ? `data-p="${b.p}"` : ""} ${b.disabled ? "disabled" : ""}
    ${b.aria ? `aria-label="${esc(b.aria)}"` : ""}>${icon(b.icon)}<span>${esc(b.label)}</span></button>`).join("");
  const mainHtml = main.wait != null
    ? `<p class="act1 act-wait" role="status">${esc(main.wait)}</p>`
    : `<button class="btn btn-object act1" data-act="${main.act}" ${main.disabled ? "disabled" : ""}>${main.icon ? icon(main.icon) : ""}<span>${esc(main.label)}</span></button>`;
  return `<div class="actions ${side.length ? "" : "solo-main"}">${side.length ? `<div class="act-side n${side.length}">${sideHtml}</div>` : ""}${mainHtml}</div>`;
}

function actions(mine) {
  const DRAW = B("draw", "draw", "Pesca");
  if (PAUSED()) {
    if (!isHost()) return bar([], { wait: `In pausa: aspetta che ${hostName()} riprenda` });
    return bar([B("tools", "tools", "Strumenti"), B("token", "token", "Pedina"), B("turnsheet", "pass", "Turno")], B("resume", "resume", "Riprendi"));
  }
  if (STACK().length) {
    const r = RESOLVING();
    if (r) {
      if (NET() && r.controller !== mySeat) return bar([MORE], { wait: `${P(r.controller).name} risolve ${E.itemName(S, r)}` });
      const side = [MORE];
      if (STACK().length > 1) side.push(B("rescounter", "close", "Contrasta"));
      if (r.kind === "spell") side.push(B("resexile", "exile", "In esilio", { aria: "Fatto: la magia va in esilio" }));
      const ab = r.kind === "ability" && r.abil && (r.abil.do || []).length;
      if (ab) return bar(side, B("resrun", "check", "Risolvi l'abilità"));
      return bar(side, resolvingSpell(r) ? B("resrun", "check", "Risolvi la magia") : B("resdone", "check", "Fatto"));
    }
    if (NET()) {
      if (S.prio && S.prio.p === mySeat) return bar([MORE], B("passprio", "check", "Lascia risolvere"));
      return bar([MORE], { wait: `${P(S.prio ? S.prio.p : 1 - mySeat).name} può rispondere` });
    }
    if (S.mode !== "solo" && S.respond == null) {
      const other = 1 - S.viewer;
      return bar([MORE, B("respond", "hand", "Risponde", { p: other, aria: `Passa il telefono ${aName(P(other).name)} per rispondere` })], B("resolvetop", "check", "Risolvi la cima"));
    }
  }
  if (NET()) {
    const cb = S.combat;
    if (!mine) {
      if (cb && cb.stage === "blocks") return bar([MORE], B("blocksdone", "check", "Blocchi fatti"));
      return bar([MORE, DRAW], { wait: `Turno di ${P(S.active).name}` });
    }
    if (cb && !ui.mode) {
      if (cb.stage === "damage") return bar([MORE], B("damage", "attack", "Calcola i danni"));
      return bar([MORE, B("damage", "attack", "Danni subito", { aria: "Calcola i danni senza aspettare i blocchi" })], { wait: `Aspetta i blocchi di ${P(1 - S.active).name}` });
    }
  }
  if (!mine) return bar([MORE, DRAW], B("giveback", "pass", `Ridai ${aName(P(S.active).name)}`));
  if (ui.mode === "attack") {
    const pw = ui.sel.reduce((t, id) => t + Math.max(0, (E.power(S, id) || { p: 0 }).p), 0);
    return bar([B("attackcancel", "close", "Annulla")], ui.sel.length
      ? B("attackgo", "attack", `Attacca con ${ui.sel.length} (forza ${pw})`) : { act: "attackgo", label: "Tocca chi attacca", disabled: true });
  }
  if (ui.mode === "blocks") return bar([], B("damage", "attack", "Blocchi fatti: calcola i danni"));
  return bar([MORE, DRAW, B("attack", "attack", "Attacca")], B("endturn", "pass", S.step === "end" ? "Passa il turno" : "Fine turno"));
}

function handRail(p) {
  const pl = P(p);
  const n = pl.hand.length;
  const show = pl.hand.slice(0, 9);
  return `<button class="hand-rail sl-${esc(pl.sleeve)}" data-act="hand" aria-label="La tua mano: ${plural(n, "carta", "carte")}. Tocca per aprirla">
    <span class="rail-fan">${show.map((id, k) => {
      const i = E.info(S, id);
      const mid = (show.length - 1) / 2;
      return `<span class="rail-card" style="--k:${k - mid}"><span class="face f-${frameKey(i)}"><span>${esc(E.shortName(S, id))}</span></span></span>`;
    }).join("")}</span>
    <span class="rail-label">Mano <b class="num">${n}</b></span>
  </button>`;
}

function handCard(id, { selectable = false, selected = false, act = "handcard" } = {}) {
  const i = E.info(S, id);
  const pw = i && i.pt ? i.pt : i && i.loyalty ? `fed. ${i.loyalty}` : "";
  return `<button class="hcard ${selected ? "selected" : ""}" data-act="${act}" data-id="${id}" ${selectable ? `aria-pressed="${selected}"` : ""}>
    <span class="face f-${frameKey(i)}">
      <span class="hc-name" lang="it">${esc(E.displayName(S, id))}</span>
      <span class="hc-cost">${cost(i?.cost)}</span>
      <span class="hc-foot"><span class="hc-type" lang="it">${esc(typeIt(i))}</span>${pw ? `<span class="hc-pt num">${esc(pw)}</span>` : ""}</span>
    </span>
  </button>`;
}

// ---- tocchi ---------------------------------------------------------------------------------
let pressTimer = null;
let longPressed = false;
function onPointerDown(e) {
  const t = e.target.closest("[data-group],[data-card]");
  longPressed = false;
  if (!t || (PAUSED() && !isHost())) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPressed = true;
    if (PAUSED() && isHost()) H.hostCardSheet(hostCtx(), t.dataset.card || t.dataset.group.split(",")[0]);
    else if (t.dataset.group) groupSheet(t.dataset.group.split(","));
    else cardSheet(t.dataset.card);
  }, 520);
  const cancel = () => { clearTimeout(pressTimer); window.removeEventListener("pointerup", cancel); window.removeEventListener("pointercancel", cancel); };
  window.addEventListener("pointerup", cancel);
  window.addEventListener("pointercancel", cancel);
}

async function damageClicked() {
  if (NET() && S.combat && S.combat.stage === "blocks") {
    const ok = await confirmSheet("Blocchi non ancora confermati", `${P(1 - S.active).name} non ha ancora toccato «Blocchi fatti». Calcolo lo stesso?`, "Sì, calcola");
    if (!ok) return;
  }
  damageSheet();
}

function onClick(e) {
  if (longPressed) { longPressed = false; e.preventDefault(); return; }
  if (!wakeLock) keepAwake();
  if (PAUSED()) {
    const a0 = e.target.closest("[data-act]");
    const c0 = e.target.closest("[data-card],[data-group]");
    if (!isHost()) {
      if (a0 && a0.dataset.act === "diary") return diarySheet();
      if (a0 || c0) toast(`Partita in pausa: aspetta che ${hostName()} riprenda.`);
      return undefined;
    }
    if (c0) return H.hostCardSheet(hostCtx(), c0.dataset.card || c0.dataset.group.split(",")[0]);
    if (a0 && a0.dataset.act === "life") return H.hostPlayerSheet(hostCtx(), Number(a0.dataset.p));
    if (a0 && a0.dataset.act === "zone") return H.hostZoneSheet(hostCtx(), Number(a0.dataset.p), a0.dataset.z);
    if (a0 && a0.dataset.act === "hand") return handSheet();
    if (a0 && a0.dataset.act === "stackitem") return H.hostStackSheet(hostCtx(), a0.dataset.sid);
  }
  const g = e.target.closest("[data-group]");
  if (g) return tapGroup(g.dataset.group.split(","));
  const c = e.target.closest("[data-card]");
  if (c) return tapCard(c.dataset.card);
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const act = a.dataset.act;
  const p = a.dataset.p != null ? Number(a.dataset.p) : null;
  switch (act) {
    case "unlock": return unlock();
    case "keep": return keepClicked();
    case "mull": { const ms = mulSeat(); return commit((s) => E.mulligan(s, ms)); }
    case "mulpick": return mulPick(a.dataset.id);
    case "mulkeep": { const sel = ui.mulSel.slice(); const ms = mulSeat(); ui = freshUi(); return commit((s) => E.keepHand(s, ms, sel)); }
    case "mulback": ui = freshUi(); return draw();
    case "peek": return handCardSheet(a.dataset.id, { readOnly: true });
    case "life": return lifeSheet(p);
    case "zone": return zoneSheet(p, a.dataset.z);
    case "respond": return commit((s) => { s.respond = p; s.backTo = s.active; s.locked = true; s.viewer = p; });
    case "giveback": return commit((s) => { s.respond = null; s.locked = true; s.viewer = s.backTo; });
    case "undo": return undo();
    case "diary": return diarySheet();
    case "pend": return runPending(a.dataset.pid);
    case "pendskip": return commit((s) => {
      const q = s.pending.find((x) => x.pid === a.dataset.pid);
      s.pending = s.pending.filter((x) => x.pid !== a.dataset.pid);
      if (q) E.logPublic(s, q.controller, `${E.displayName(s, q.source)}: abilità saltata.`, "trigger");
    });
    case "pendall": return runAllAuto();
    case "slipinfo": {
      const q = S.pending.find((x) => x.pid === a.dataset.pid);
      if (q) openSheet(`<h2>${esc(E.displayName(S, q.source))}</h2><div class="cs-text" style="margin-top:10px">${esc(describe(S, q).full).replace(/\n/g, "<br>")}</div>`, { label: "Abilità" });
      return undefined;
    }
    case "draw": { const me = NET() ? mySeat : S.viewer; return commit((s) => E.drawN(s, me, 1)); }
    case "attack": if (STACK().length) { toast("Prima risolvete la pila."); return undefined; } ui = { ...freshUi(), mode: "attack" }; return draw();
    case "attackcancel": ui = freshUi(); return draw();
    case "attackgo": { const ids = ui.sel.slice(); ui = NET() ? freshUi() : { ...freshUi(), mode: "blocks" }; return commit((s) => E.declareAttackers(s, ids)); }
    case "damage": return damageClicked();
    case "blocksdone": return commit((s) => {
      if (!s.combat) return;
      s.combat.stage = "damage";
      const b = s.combat.attackers.filter((id) => s.cards[id] && s.cards[id].blocked).map((id) => E.displayName(s, id));
      const me = s.players[1 - s.active].name;
      E.logPublic(s, 1 - s.active, b.length ? `${me} blocca ${b.join(", ")}.` : `${me} non blocca.`, "combat");
    });
    case "more": return moreSheet();
    case "stackitem": return stackItemSheet(a.dataset.sid);
    case "passprio": return commit((s) => E.passPriority(s, mySeat));
    case "resolvetop": return commit((s) => { if (!s.resolving) E.resolveTop(s); });
    case "resdone": { const sid = S.resolving; return commit((s) => E.finishResolve(s, sid)); }
    case "resexile": { const sid = S.resolving; return commit((s) => E.finishResolve(s, sid, { to: "exile" })); }
    case "rescounter": return counterFromResolution();
    case "resrun": return runResolvingAbility();
    case "pause": return pauseGame();
    case "resume": return commit((s) => { s.paused = null; s.pauseAsk = null; E.hostLog(s, "si riprende a giocare."); });
    case "tools": return H.hostTools(hostCtx());
    case "token": return H.tokenSheet(hostCtx());
    case "turnsheet": return H.turnSheet(hostCtx());
    case "endturn": return endTurnClicked();
    case "hand": return handSheet();
    case "handcard": return handCardSheet(a.dataset.id);
    default: return undefined;
  }
}

function unlock() {
  commit((s) => {
    s.locked = false;
    if (s.phase === "mulligan") { s.viewer = s.mulliganTurn; return; }
    if (s.respond != null) { s.viewer = s.respond; return; }
    if (s.backTo != null) { s.viewer = s.backTo; s.backTo = null; return; }
    s.viewer = s.active;
  });
}

function keepClicked() {
  const ms = mulSeat();
  const pl = P(ms);
  if (!pl.mulligans) return commit((s) => E.keepHand(s, ms, []));
  ui = { ...freshUi(), mode: "bottom" };
  draw();
}

function mulPick(id) {
  const need = P(mulSeat()).mulligans;
  if (ui.mulSel.includes(id)) ui.mulSel = ui.mulSel.filter((x) => x !== id);
  else if (ui.mulSel.length < need) ui.mulSel.push(id);
  draw();
}

function tapGroup(ids) {
  if (ui.mode) return;
  const c = S.cards[ids[0]];
  if (!c || c.controller !== S.viewer) { groupSheet(ids); return; }
  commit((s) => E.setTapped(s, ids[0], !c.tapped));
}

function tapCard(id) {
  const c = S.cards[id];
  if (!c) return;
  if (ui.mode === "attack") {
    if (c.controller !== S.active || !E.hasType(S, id, "Creature")) return;
    if (ui.sel.includes(id)) ui.sel = ui.sel.filter((x) => x !== id);
    else if (E.canAttack(S, id)) {
      ui.sel.push(id);
      if (E.sick(S, id)) toast("È entrata in questo turno: può attaccare solo se ha rapidità.");
    } else toast(c.tapped ? "È tappata: non può attaccare." : "Non può attaccare.");
    return draw();
  }
  if (ui.mode === "blocks") {
    if (!c.attacking) return;
    return commit((s) => { s.cards[id].blocked = !s.cards[id].blocked; });
  }
  if (NET() && S.combat && S.combat.stage === "blocks" && S.active !== mySeat && c.attacking) {
    return commit((s) => { if (s.cards[id]) s.cards[id].blocked = !s.cards[id].blocked; });
  }
  cardSheet(id);
}

// ---- fogli: carta in campo ---------------------------------------------------------------------
function cardText(i) {
  if (!i) return "";
  const txt = i.text_it || i.text || "";
  return `<div class="cs-text">${esc(txt).replace(/\n/g, "<br>") || "<em>Nessun testo</em>"}</div>
    ${i.text_it || !txt ? "" : `<p class="micro">In inglese: la traduzione di questa carta non c'è ancora.</p>`}`;
}

function cardSheet(id) {
  const c = S.cards[id];
  if (!c) return;
  const i = E.info(S, id);
  const sc = E.script(S, id);
  const pw = E.power(S, id);
  const mineCtl = c.controller === S.viewer;
  const abil = ((sc && sc.abilities) || []).filter((a) => a.face !== "back");
  const isPw = c.counters.LOYALTY != null || (i && (i.types || []).includes("Planeswalker"));
  const tags = H.cardTags(S, id, S.viewer);
  const flags = H.keywordFlags(S, id);
  const myCard = c.controller === S.viewer;
  const real = E.infoReal(S, id) || {};
  const attachable = !c.faceDown && ((real.subtypes || []).includes("Aura") || (real.subtypes || []).includes("Equipment"));
  const holdsExile = !c.faceDown && /until .{0,60}leaves the battlefield/i.test(real.text || "");
  const toolsBtn = toolsNow() ? `<button class="btn btn-quiet tools-link" data-x="tools">${icon("tools")}Altre modifiche: forza, abilità, segnalini, forma…</button>`
    : isHost() ? `<button class="btn btn-quiet tools-link" data-x="pausetools">${icon("pause")}Pausa e modifica…</button>` : "";
  const other = S.players.length > 1 ? P(1 - c.controller).name : "";
  const s = openSheet(`<div class="card-sheet">
    <div class="cs-head"><h2>${esc(E.displayName(S, id))}</h2>${cost(i?.cost)}</div>
    <p class="cs-type">${esc(typeIt(i))}${c.token ? " (pedina)" : ""}${pw ? `, <b>${pw.p}/${pw.t}</b>${pw.p + "/" + pw.t !== pw.base ? ` (stampata ${esc(pw.base)})` : ""}` : ""}${S.players.length > 1 ? `, di ${esc(P(c.controller).name)}` : ""}</p>
    ${flags.length || tags.length ? `<p class="micro">${esc([...flags, ...tags].join(", "))}</p>` : ""}
    ${cardText(i)}
    <div class="sheet-grid cs-main">
      <button class="btn btn-object" data-x="tap">${c.tapped ? "Stappa" : "Tappa"}</button>
      ${myCard && E.hasBack(S, id) && !c.faceDown ? `<button class="btn" data-x="transform">Trasforma</button>` : ""}
      ${myCard && c.faceDown ? `<button class="btn" data-x="faceup">Gira a faccia in su: è ${esc(E.realName(S, id))}</button>` : ""}
      ${myCard && c.prepared ? `<button class="btn" data-x="castprep">Lancia la copia della magia preparata</button>` : ""}
      ${myCard && attachable ? (c.attachedTo && S.cards[c.attachedTo] ? `<button class="btn" data-x="detach">Sgancia da ${esc(E.shortName(S, c.attachedTo))}</button>` : `<button class="btn" data-x="attach">Aggancia a una creatura…</button>`) : ""}
      ${myCard && holdsExile ? `<button class="btn" data-x="linkexile">Esilia una carta finché questa resta in campo…</button>` : ""}
    </div>
    ${E.hasType(S, id, "Creature") || isPw ? `<div class="cs-counters">
      ${E.hasType(S, id, "Creature") ? `<div class="stepper hstep"><button class="btn" data-x="p1-" aria-label="Togli un segnalino +1/+1">−1</button><span>Segnalini +1/+1 <b class="num" id="cnt-p1">${c.counters.P1P1 || 0}</b></span><button class="btn" data-x="p1+" aria-label="Aggiungi un segnalino +1/+1">+1</button></div>` : ""}
      ${isPw ? `<div class="stepper hstep"><button class="btn" data-x="loy-" aria-label="Fedeltà meno uno">−1</button><span>Fedeltà <b class="num" id="cnt-loy">${c.counters.LOYALTY || 0}</b></span><button class="btn" data-x="loy+" aria-label="Fedeltà più uno">+1</button></div>` : ""}
    </div>` : ""}
    ${abil.length ? `<h3 class="sheet-h">Abilità</h3><div class="abil-list">${abil.map((a, k) => `<button class="btn abil" data-x="ab" data-k="${k}">
      <span class="abil-cost">${esc(abilityCost(a))}</span><span class="abil-text">${esc(a.text_it || a.text || "")}</span></button>`).join("")}</div>` : ""}
    <h3 class="sheet-h">Sposta</h3>
    <div class="move-grid">
      <button class="btn" data-x="grave">${c.token ? "Rimuovi" : "Al cimitero"}</button>
      <button class="btn" data-x="sac">Sacrifica</button>
      <button class="btn" data-x="exile">In esilio</button>
      ${c.token ? "" : `<button class="btn" data-x="hand">In mano</button><button class="btn" data-x="top">Sul grimorio</button>`}
      ${S.mode === "duo" ? `<button class="btn" data-x="steal" aria-label="Dai il controllo ${esc(aName(other))}">Dai ${esc(aName(other))}</button>` : ""}
      <button class="btn" data-x="copy">Copia</button>
    </div>
    ${toolsBtn}
  </div>`, { label: E.displayName(S, id) });
  s.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    const x = b.dataset.x;
    // i segnalini si contano con il foglio aperto
    const live = { "p1+": ["P1P1", 1, "cnt-p1"], "p1-": ["P1P1", -1, "cnt-p1"], "loy+": ["LOYALTY", 1, "cnt-loy"], "loy-": ["LOYALTY", -1, "cnt-loy"] }[x];
    if (live) {
      commit((st) => E.addCounter(st, id, live[0], live[1]));
      const n = s.el.querySelector(`#${live[2]}`);
      if (n && S.cards[id]) n.textContent = S.cards[id].counters[live[0]] || 0;
      return;
    }
    s.close();
    if (x === "tap") commit((st) => E.setTapped(st, id, !st.cards[id].tapped));
    if (x === "grave") commit((st) => E.moveCard(st, id, "graveyard"));
    if (x === "sac") commit((st) => { const ctl = st.cards[id].controller; E.moveCard(st, id, "graveyard", { sacrificed: true, reason: `${st.players[ctl].name} sacrifica ${E.displayName(st, id)}` }); });
    if (x === "exile") commit((st) => E.moveCard(st, id, "exile"));
    if (x === "hand") commit((st) => E.moveCard(st, id, "hand"));
    if (x === "top") commit((st) => E.moveCard(st, id, "library", { pos: "top" }));
    if (x === "steal") commit((st) => E.giveControl(st, id, 1 - st.cards[id].controller, st.viewer));
    if (x === "ab") useAbility(id, abil[Number(b.dataset.k)]);
    if (x === "copy") tokenCopy(id);
    if (x === "transform") commit((st) => E.transform(st, id, st.cards[id].controller));
    if (x === "faceup") commit((st) => E.setFaceDown(st, id, false, st.cards[id].controller));
    if (x === "castprep" && stackOk()) commit((st) => E.castPrepared(st, id));
    if (x === "tools") H.hostCardSheet(hostCtx(), id);
    if (x === "detach") commit((st) => E.attach(st, id, null, st.cards[id].controller));
    if (x === "attach" || x === "linkexile") {
      const ids = S.players.flatMap((pl) => pl.battlefield).filter((y) => y !== id && (x === "linkexile" || E.hasType(S, y, "Creature")));
      pickCards(x === "attach" ? `Aggancia ${E.displayName(S, id)} a…` : `Esilia finché ${E.displayName(S, id)} resta in campo`, ids,
        { max: 1, min: 1, okLabel: x === "attach" ? "Aggancia" : "Esilia" }).then((got) => {
        if (!got || !got.length) return;
        if (x === "attach") commit((st) => E.attach(st, id, got[0], st.cards[id].controller));
        else commit((st) => E.linkExile(st, got[0], id, st.cards[id].controller));
      });
    }
    if (x === "pausetools") pauseGame(() => H.hostCardSheet(hostCtx(), id));
  });
}

// pedina copia di un permanente (es. Prole/Offspring: copia 1/1 con le stesse abilita')
async function tokenCopy(id) {
  const i = E.info(S, id);
  const sc = E.script(S, id) || {};
  const ans = await pick(`Copia di ${E.displayName(S, id)}`, [
    { value: "same", label: "Copia identica" },
    ...(i && i.pt ? [{ value: "one", label: "Copia 1/1 (per esempio con Prole)" }] : [])]);
  if (!ans) return;
  const def = {
    name: S.cards[id].name, name_it: E.displayName(S, id),
    pt: ans === "one" ? "1/1" : (i && i.pt) || null,
    types: [...((i && i.types) || ["Creature"]), ...((i && i.subtypes) || [])].join(" "),
    colors: (i && i.colors) || "", keywords: sc.keywords || [], triggers: sc.triggers || null,
    abilities: sc.abilities && sc.abilities.length ? sc.abilities : null, text: (i && (i.text_it || i.text)) || "",
  };
  const ctl = S.cards[id].controller;
  commit((st) => E.createTokens(st, ctl, def, 1));
}

function abilityCost(a) {
  const c = a.cost || {};
  const parts = [];
  if (c.loyalty != null) parts.push(c.loyalty > 0 ? `+${c.loyalty}` : `${c.loyalty}`);
  if (c.mana) parts.push(c.mana.split(" ").map((m) => `{${m}}`).join(""));
  if (c.tap) parts.push("{T}");
  if (c.life) parts.push(`paga ${c.life} vite`);
  if (c.sacrifice_self) parts.push("sacrificala");
  if (c.discard) parts.push(`scarta ${c.discard}`);
  return parts.join(", ") || "abilità";
}

async function useAbility(id, a) {
  if (!a) return;
  if (E.usesStack(S) && !a.mana && !stackOk()) return;
  const c = a.cost || {};
  const ctl = S.cards[id].controller;
  let discards = [];
  if (c.discard) {
    const hand = P(ctl).hand.slice();
    if (hand.length < c.discard) { toast("Non hai abbastanza carte in mano da scartare."); return; }
    const got = await pickCards(`Per attivarla scarta ${plural(c.discard, "carta", "carte")}`, hand, { max: c.discard, min: c.discard, okLabel: "Scarta e attiva" });
    if (!got) return;
    discards = got;
  }
  const onStack = E.usesStack(S) && !a.mana;
  commit((s) => {
    discards.forEach((d) => E.moveCard(s, d, "graveyard", { reason: `${s.players[ctl].name} scarta ${E.displayName(s, d)}` }));
    const name = E.displayName(s, id);
    E.logPublic(s, ctl, `${s.players[ctl].name} attiva ${name}: ${abilityCost(a)}${onStack ? ", l'effetto va sulla pila" : ""}.`, "ability");
    if (c.tap) E.setTapped(s, id, true);
    if (c.loyalty != null) E.addCounter(s, id, "LOYALTY", c.loyalty);
    if (c.life) E.changeLife(s, ctl, -c.life, { why: `per ${name}` });
    if (onStack) E.abilityToStack(s, id, a, ctl);
    if (c.sacrifice_self) E.moveCard(s, id, "graveyard", { sacrificed: true, reason: `${s.players[ctl].name} sacrifica ${name}` });
  });
  if (!onStack) await runEffects(id, a.do || [], ctl, a.text_it || a.text || "");
}

function groupSheet(ids) {
  const id = ids[0];
  const c = S.cards[id];
  const i = E.info(S, id);
  const nT = ids.filter((x) => S.cards[x].tapped).length;
  const s = openSheet(`<div class="card-sheet">
    <div class="cs-head"><h2>${esc(E.displayName(S, id))}${ids.length > 1 ? ` ×${ids.length}` : ""}</h2></div>
    <p class="cs-type">${esc(typeIt(i))}</p>
    ${cardText(i)}
    <div class="sheet-grid">
      <button class="btn btn-object" data-x="tap">${c.tapped ? "Stappane una" : "Tappane una"}</button>
      ${ids.length > 1 ? `<button class="btn" data-x="tapall">${c.tapped ? "Stappale tutte" : "Tappale tutte"}</button>` : ""}
      <button class="btn" data-x="grave">Una al cimitero</button>
      <button class="btn" data-x="hand">Una in mano</button>
      <button class="btn" data-x="exile">Una in esilio</button>
    </div></div>`, { label: E.displayName(S, id) });
  s.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    s.close();
    const x = b.dataset.x;
    if (x === "tap") commit((st) => E.setTapped(st, id, !c.tapped));
    if (x === "tapall") commit((st) => ids.forEach((k) => E.setTapped(st, k, !c.tapped)));
    if (x === "grave") commit((st) => E.moveCard(st, id, "graveyard"));
    if (x === "hand") commit((st) => E.moveCard(st, id, "hand"));
    if (x === "exile") commit((st) => E.moveCard(st, id, "exile"));
  });
  return nT;
}

// ---- mano ----------------------------------------------------------------------------------
function handSheet() {
  const p = NET() ? mySeat : S.viewer;
  const pl = P(p);
  const fromExile = E.exilePlayable(S, p);
  const s = openSheet(`<h2>La tua mano <span class="muted num">${pl.hand.length}</span></h2>
    <p class="micro">Tocca una carta per giocarla. ${pl.landsThisTurn ? `Terre giocate in questo turno: ${pl.landsThisTurn}.` : ""}</p>
    <div class="hand-grid">${pl.hand.map((id) => handCard(id)).join("") || '<p class="muted">Nessuna carta in mano.</p>'}</div>
    ${fromExile.length ? `<h3 class="sheet-h">Puoi giocarle dall'esilio</h3>
      <div class="hand-grid">${fromExile.map((id) => handCard(id, { act: "exilecard" })).join("")}</div>` : ""}`,
  { label: "La tua mano" });
  s.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act=handcard],[data-act=exilecard]");
    if (!b) return;
    e.stopPropagation();
    s.close();
    handCardSheet(b.dataset.id, { fromExile: b.dataset.act === "exilecard" });
  });
}

function handCardSheet(id, { readOnly = false, fromExile = false } = {}) {
  const i = E.info(S, id);
  const p = fromExile ? (S.cards[id].playable?.by ?? S.cards[id].owner) : S.cards[id].owner;
  const land = i && i.is_land;
  const disguise = /\b(disguise|cloak|morph|manifest)\b/i.test((i && i.text) || "");
  const s = openSheet(`<div class="card-sheet">
    <div class="cs-head"><h2>${esc(E.displayName(S, id))}</h2>${cost(i?.cost)}</div>
    <p class="cs-type">${esc(typeIt(i))}${i?.pt ? `, ${esc(i.pt)}` : ""}${i?.loyalty ? `, fedeltà ${esc(i.loyalty)}` : ""}</p>
    ${cardText(i)}
    ${fromExile ? `<p class="micro">È in esilio: ${S.cards[id].playable && S.cards[id].playable.until != null ? (S.cards[id].playable.until === S.turn ? "puoi giocarla fino alla fine di questo turno." : "puoi giocarla fino alla fine del tuo prossimo turno.") : "puoi giocarla finché resta lì."}</p>` : ""}
    ${readOnly ? "" : `<div class="sheet-grid">
      ${land ? `<button class="btn btn-object" data-x="land">Gioca la terra</button>`
        : `<button class="btn btn-object" data-x="cast">Lancia</button>`}
      ${i?.land_back ? `<button class="btn" data-x="land">Gioca come terra</button>` : ""}
      ${disguise && !fromExile ? `<button class="btn" data-x="facedown">Lancia a faccia in giù (2/2)</button>` : ""}
      ${fromExile ? "" : `<button class="btn" data-x="discard">Scarta</button>`}
      ${fromExile ? "" : `<button class="btn" data-x="reveal">Mostrala</button>
      <button class="btn" data-x="top">In cima al grimorio</button>
      <button class="btn" data-x="bottom">In fondo al grimorio</button>
      <button class="btn" data-x="exile">In esilio</button>`}
    </div>`}</div>`, { label: E.displayName(S, id) });
  s.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    s.close();
    const x = b.dataset.x;
    if (x === "land") return playLandFlow(id, p);
    if (x === "cast") return castFlow(id, p);
    if (x === "facedown") return commit((st) => E.putFaceDown(st, id, { controller: p, how: `${st.players[p].name} lancia una carta a faccia in giù (2/2).` }));
    if (x === "discard") return commit((st) => E.moveCard(st, id, "graveyard", { reason: `${st.players[p].name} scarta ${E.displayName(st, id)}` }));
    if (x === "reveal") return commit((st) => E.logPublic(st, p, `${st.players[p].name} mostra ${E.displayName(st, id)}.`, "reveal"));
    if (x === "top") return commit((st) => E.moveCard(st, id, "library", { pos: "top" }));
    if (x === "bottom") return commit((st) => E.moveCard(st, id, "library", { pos: "bottom" }));
    if (x === "exile") return commit((st) => E.moveCard(st, id, "exile"));
    return undefined;
  });
}

const BASIC_TYPES = [["Plains", "Pianura"], ["Island", "Isola"], ["Swamp", "Palude"], ["Mountain", "Montagna"], ["Forest", "Foresta"]];

async function playLandFlow(id, by = null) {
  const p = by ?? S.cards[id].owner;
  const pl = P(p);
  if (pl.landsThisTurn >= 1 && !(await confirmSheet("Seconda terra", `${pl.name} ha già giocato una terra in questo turno. La giochi lo stesso?`, "Sì, la gioco"))) return;
  const sc = E.script(S, id);
  const i = E.info(S, id);
  let etb = sc ? sc.etb : undefined;
  if (etb === undefined) etb = i && i.etb_tapped === "yes" ? { tapped: "always" } : i && i.etb_tapped === "conditional" ? { tapped: "ask" } : null;
  let chosen = null;
  if (etb && etb.choose === "basic_land_type") {
    chosen = await pick(`${E.displayName(S, id)}: scegli il tipo`, BASIC_TYPES.map(([en, it]) => ({ value: it, label: it })));
    if (chosen == null) return;
  }
  let tapped = false;
  let payLife = 0;
  const others = pl.battlefield.filter((x) => E.info(S, x)?.is_land);
  if (etb) {
    const rule = etb.text_it || etb.text || "";
    switch (etb.tapped) {
      case "always": tapped = true; break;
      case "unless_other_lands_lte": tapped = others.length > etb.n; break;
      case "unless_other_lands_gte": tapped = others.length < etb.n; break;
      case "unless_turn_lte": tapped = pl.turnsTaken > etb.n; break;
      case "unless_control": {
        const want = (etb.types || []).map((t) => (BASIC_TYPES.find(([en]) => en === t) || [t, t])[1]);
        const has = others.some((x) => {
          const xi = E.info(S, x);
          const sub = (xi && xi.subtypes) || [];
          return (etb.types || []).some((t) => sub.includes(t)) || want.includes(S.cards[x].chosen);
        });
        tapped = !has;
        break;
      }
      case "unless_pay_life": {
        const ans = await pick(`${E.displayName(S, id)}`, [
          { value: "pay", label: `Paga ${etb.n} vite: entra stappata` },
          { value: "tap", label: "Entra tappata" }], rule);
        if (ans == null) return;
        if (ans === "pay") payLife = etb.n; else tapped = true;
        break;
      }
      default: {
        const ans = await pick(`${E.displayName(S, id)}: entra tappata?`, [
          { value: "tap", label: "Tappata" }, { value: "untap", label: "Stappata" }], rule);
        if (ans == null) return;
        tapped = ans === "tap";
      }
    }
  }
  commit((s) => E.playLand(s, id, { tapped, payLife, chosen, controller: p }));
}

async function castFlow(id, by = null) {
  if (!stackOk()) return;
  const p = by ?? S.cards[id].owner;
  const opts = await castChoices(id);
  if (!opts) return;
  const i = E.info(S, id);
  commit((s) => E.cast(s, id, { controller: p, ...opts }));
  // senza pila un istantaneo o una stregoneria si risolve subito: i suoi effetti, se li sappiamo
  const sp = i && !i.is_permanent && !E.usesStack(S) ? E.spellOf(S, id) : null;
  if (sp) await runEffects(id, sp.do, p, sp.text_it || sp.text || "");
}

// "{U}{U}", "{B}{B}": i mana che le abilita' della carta (o della copia) controllano
function spentPairs(sc) {
  const out = [];
  for (const t of (sc && sc.triggers) || []) if (t.if && t.if.spent && !out.includes(t.if.spent)) out.push(t.if.spent);
  return out;
}
const sym = (pair) => pair.split("").map((x) => `{${x}}`).join("");
const altCost = (kw) => {
  const part = kw.split(":").slice(-1)[0].trim().split(/\s+/);
  return part.map((x) => (/^[A-Z]{2}$/.test(x) ? `{${x[0]}/${x[1]}}` : `{${x}}`)).join("");
};

// le domande prima di lanciare; null = annullato
async function castChoices(id) {
  const sc = E.script(S, id) || {};
  const i = E.info(S, id) || {};
  const name = E.displayName(S, id);
  const kws = sc.other_keywords || [];
  const opts = {};
  const evoke = kws.find((k) => /^Evoke:/.test(k));
  const imp = kws.find((k) => /^Impending:/.test(k));
  if (evoke || imp) {
    const n = imp ? parseInt(imp.split(":")[1], 10) || 1 : 0;
    const alt = evoke
      ? { value: "evoke", label: `Con Apparire (${altCost(evoke)}): entra, fa le sue abilità e si sacrifica` }
      : { value: "impending", label: `Con Imminente (${altCost(imp)}): ${n} segnalini tempo, non è una creatura finché ne ha` };
    const full = String(i.cost || "?").replace(/\{([WUBRG])([WUBRG])\}/g, "{$1/$2}");
    const ans = await pick(`Come lanci ${name}?`, [{ value: "full", label: `Costo pieno (${full})` }, alt]);
    if (!ans) return null;
    if (ans === "evoke") opts.evoke = true;
    if (ans === "impending") opts.impending = n;
  }
  let target = sc;
  if (E.entersAsCopy(S, id)) {
    const pool = S.players.flatMap((x) => x.graveyard).filter((g) => E.hasType(S, g, "Creature"));
    if (pool.length) {
      const got = await pickCards(`${name}: entra come copia di…`, pool, {
        note: "Una carta creatura in un cimitero, tuo o dell'avversario: va in esilio. Se non ne scegli nessuna, entra come 4/4.",
        max: 1, min: 0, okLabel: "Conferma" });
      if (got === null) return null;
      if (got.length) { opts.copyOf = got[0]; target = E.script(S, got[0]) || {}; }
    }
  }
  const pairs = spentPairs(target);
  if (pairs.length) {
    const choices = opts.evoke
      ? [...pairs.map((x) => ({ value: x, label: sym(x) })), { value: "-", label: `${pairs.map((x) => `{${x[0]}}`).join("")}: un mana per colore` }]
      : [{ value: pairs.join("+"), label: `${pairs.map(sym).join(" e ")}` }, ...pairs.map((x) => ({ value: x, label: `Solo ${sym(x)}` })),
        { value: "-", label: "Nessuna delle due coppie" }];
    const ans = await pick(`Che mana spendi per ${name}?`, choices, "Conta anche il mana con cui paghi la parte generica del costo.");
    if (!ans) return null;
    opts.spent = Object.fromEntries(ans.split("+").filter((x) => x !== "-").map((x) => [x, true]));
  }
  return opts;
}

// ---- la pila: dettagli, contromagie, abilita' che si risolvono ------------------------------------
function stackItemSheet(sid) {
  const it = E.stackItem(S, sid);
  if (!it) return;
  const i = it.kind === "spell" ? E.info(S, it.card) : null;
  openSheet(`<div class="card-sheet">
    <div class="cs-head"><h2>${esc(E.itemName(S, it))}</h2>${i ? cost(i.cost) : ""}</div>
    <p class="cs-type">${it.kind === "spell" ? esc(typeIt(i)) : it.kind === "copy" ? "Copia di una magia" : "Abilità"}, di ${esc(P(it.controller).name)}</p>
    ${i ? cardText(i) : `<div class="cs-text">${esc(it.text || "").replace(/\n/g, "<br>") || "<em>Nessun testo</em>"}</div>`}
    <p class="micro">${S.resolving === sid ? "Si sta risolvendo." : "È sulla pila: si risolve quando tutti e due lasciano risolvere."} Bersagli e regole li decidete voi.</p>
  </div>`, { label: E.itemName(S, it) });
}

async function counterFromResolution() {
  const r = RESOLVING();
  if (!r) return;
  const others = STACK().filter((x) => x.sid !== r.sid).reverse();
  const ans = await pick(`${E.itemName(S, r)}: cosa contrasta?`, others.map((x) => ({ value: x.sid, label: `${E.itemName(S, x)} (di ${P(x.controller).name})` })));
  if (!ans) return;
  const sid = r.sid;
  commit((s) => { E.counterItem(s, ans, r.controller); E.finishResolve(s, sid); });
}

// gli effetti noti di una magia (o della sua copia) che si sta risolvendo
function resolvingSpell(r) {
  if (r.kind === "spell" && r.card) return E.spellOf(S, r.card);
  if (r.kind === "copy" && r.ref && S.cards[r.ref]) return E.spellOf(S, r.ref);
  return null;
}

async function runResolvingAbility() {
  const r = RESOLVING();
  if (!r) return;
  const sid = r.sid;
  if (r.kind === "ability") await runEffects(r.source, (r.abil && r.abil.do) || [], r.controller, r.text || "");
  else {
    const sp = resolvingSpell(r);
    if (!sp) return;
    await runEffects(r.card || r.ref, sp.do, r.controller, sp.text_it || sp.text || "");
  }
  commit((s) => E.finishResolve(s, sid));
}

// ---- foglio di scelta generico ---------------------------------------------------------------
function pick(title, options, note = "") {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet(`<h2>${esc(title)}</h2>${note ? `<p class="micro" style="margin-top:6px">${esc(note)}</p>` : ""}
      <div class="pick-list">${options.map((o, k) => `<button class="btn ${k === 0 ? "btn-object" : ""} btn-big" data-k="${k}">${esc(o.label)}</button>`).join("")}</div>`,
    { label: title, onClose: () => { if (!done) resolve(null); } });
    s.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      done = true;
      s.close();
      resolve(options[Number(b.dataset.k)].value);
    });
  });
}

// scelta di carte da una lista (cimitero, grimorio, campo)
function pickCards(title, ids, { note = "", max = 1, min = 0, okLabel = "Conferma" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const sel = [];
    const s = openSheet(`<h2>${esc(title)}</h2>${note ? `<p class="micro" style="margin-top:6px">${esc(note)}</p>` : ""}
      <div class="hand-grid pickable">${ids.map((id) => handCard(id, { selectable: true, act: "pc" })).join("") || '<p class="muted">Nessuna carta adatta.</p>'}</div>
      <div class="pick-list"><button class="btn btn-object btn-big" data-ok ${min ? "disabled" : ""}>${esc(okLabel)}</button></div>`,
    { label: title, onClose: () => { if (!done) resolve(null); } });
    s.el.addEventListener("click", (e) => {
      const c = e.target.closest("[data-act=pc]");
      if (c) {
        e.stopPropagation();
        const id = c.dataset.id;
        if (sel.includes(id)) sel.splice(sel.indexOf(id), 1);
        else { if (sel.length >= max) sel.shift(); sel.push(id); }
        s.el.querySelectorAll("[data-act=pc]").forEach((b) => {
          const on = sel.includes(b.dataset.id);
          b.classList.toggle("selected", on);
          b.setAttribute("aria-pressed", String(on));
        });
        s.el.querySelector("[data-ok]").disabled = sel.length < min;
        return;
      }
      if (e.target.closest("[data-ok]")) { done = true; s.close(); resolve(sel.slice()); }
    });
  });
}

// ---- vite ----------------------------------------------------------------------------------
function lifeSheet(p) {
  const pl = P(p);
  const s = openSheet(`<h2>Vite di ${esc(pl.name)}</h2>
    <p class="life-big num" aria-live="polite">${pl.life}</p>
    <div class="life-steps">
      <button class="btn btn-big" data-d="-5">−5</button><button class="btn btn-big" data-d="-1">−1</button>
      <button class="btn btn-big" data-d="1">+1</button><button class="btn btn-big" data-d="5">+5</button>
    </div>
    <p class="micro">Ogni tocco conta come un evento a sé: le carte che guardano «quando guadagni vita» si accorgono di ognuno.</p>
    <div class="pstats">
      <div class="stepper"><button class="btn" data-q="poi:-1" aria-label="Togli un segnalino veleno">−1</button><span>Veleno <b class="num" id="poi">${pl.poison || 0}</b></span><button class="btn" data-q="poi:1" aria-label="Aggiungi un segnalino veleno">+1</button></div>
      <div class="stepper"><button class="btn" data-q="spd:-1" aria-label="Velocità meno uno">−1</button><span>Velocità <b class="num" id="spd">${pl.speed || 0}</b></span><button class="btn" data-q="spd:1" aria-label="Velocità più uno">+1</button></div>
    </div>
    ${(pl.emblems || []).length ? `<h3 class="sheet-h">Emblemi</h3><ul class="emblems">${pl.emblems.map((em) => `<li><span>${esc(em.text)}</span></li>`).join("")}</ul>` : ""}
    ${toolsNow() ? `<div class="pick-list"><button class="btn" data-q="tools">${icon("tools")}Altre modifiche ${esc(aName(pl.name))}…</button></div>`
      : isHost() ? `<div class="pick-list"><button class="btn" data-q="pausetools">${icon("pause")}Pausa e modifica…</button></div>` : ""}`,
  { label: `Vite di ${pl.name}` });
  s.el.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]");
    if (q) {
      const [k, v] = q.dataset.q.split(":");
      if (k === "tools") { s.close(); H.hostPlayerSheet(hostCtx(), p); return; }
      if (k === "pausetools") { s.close(); pauseGame(() => H.hostPlayerSheet(hostCtx(), p)); return; }
      if (k === "poi") commit((st) => E.changePoison(st, p, Number(v), st.viewer));
      if (k === "spd") commit((st) => E.setSpeed(st, p, (st.players[p].speed || 0) + Number(v), st.viewer));
      s.el.querySelector("#poi").textContent = P(p).poison || 0;
      s.el.querySelector("#spd").textContent = P(p).speed || 0;
      return;
    }
    const b = e.target.closest("[data-d]");
    if (!b) return;
    commit((st) => E.changeLife(st, p, Number(b.dataset.d)));
    const n = s.el.querySelector(".life-big");
    if (n) n.textContent = P(p).life;
  });
}

// ---- zone ----------------------------------------------------------------------------------
function zoneSheet(p, z) {
  const pl = P(p);
  const own = p === S.viewer;
  if (z === "library") {
    if (!own) { toast(`Il grimorio di ${pl.name}: ${plural(pl.library.length, "carta", "carte")}.`); return; }
    const s = openSheet(`<h2>Il tuo grimorio <span class="muted num">${pl.library.length}</span></h2>
      <div class="pick-list">
        <button class="btn btn-big" data-x="look">Guarda la prima carta</button>
        <button class="btn btn-big" data-x="search">Cerca una carta</button>
        <button class="btn btn-big" data-x="shuffle">${icon("shuffle")}Mescola</button>
        <button class="btn btn-big" data-x="mill">Metti la prima nel cimitero</button>
        <button class="btn btn-big" data-x="revealtop">Rivela la prima a tutti</button>
      </div>`, { label: "Grimorio" });
    s.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      s.close();
      const x = b.dataset.x;
      if (x === "shuffle") commit((st) => E.shuffleLibrary(st, p));
      if (x === "mill") commit((st) => { const id = st.players[p].library[0]; if (id) E.moveCard(st, id, "graveyard", { reason: `${st.players[p].name} mette ${E.displayName(st, id)} dal grimorio al cimitero` }); });
      if (x === "revealtop") commit((st) => { const id = st.players[p].library[0]; if (id) E.logPublic(st, p, `${st.players[p].name} rivela ${E.displayName(st, id)} dalla cima del grimorio.`, "reveal"); });
      if (x === "look") {
        const id = pl.library[0];
        if (!id) return;
        const ans = await pick(`In cima: ${E.displayName(S, id)}`, [
          { value: "keep", label: "Lasciala in cima" }, { value: "bottom", label: "Mettila in fondo" },
          { value: "grave", label: "Mettila nel cimitero" }, { value: "hand", label: "Prendila in mano" }]);
        if (ans === "bottom") commit((st) => E.moveCard(st, id, "library", { pos: "bottom" }));
        if (ans === "grave") commit((st) => E.moveCard(st, id, "graveyard"));
        if (ans === "hand") commit((st) => E.moveCard(st, id, "hand"));
      }
      if (x === "search") {
        const sorted = pl.library.slice().sort((a, b2) => E.displayName(S, a).localeCompare(E.displayName(S, b2)));
        const got = await pickCards("Cerca nel grimorio", sorted, { note: "Scegli una carta. Poi il grimorio si mescola.", okLabel: "Prendi" });
        if (!got || !got.length) return;
        const where = await pick(`${E.displayName(S, got[0])}: dove va?`, [
          { value: "hand", label: "In mano" }, { value: "bf", label: "In campo" }, { value: "bftap", label: "In campo tappata" },
          { value: "grave", label: "Nel cimitero" }]);
        if (!where) return;
        commit((st) => {
          if (where === "hand") E.moveCard(st, got[0], "hand", { reason: `${st.players[p].name} cerca una carta e la prende in mano` });
          else if (where === "grave") E.moveCard(st, got[0], "graveyard");
          else E.enterBattlefield(st, got[0], { tapped: where === "bftap", controller: p, how: `${st.players[p].name} cerca ${E.displayName(st, got[0])} e la mette in campo.` });
          E.shuffleLibrary(st, p);
        });
      }
    });
    return;
  }
  const ids = pl[z].slice().reverse();
  const label = z === "graveyard" ? "Cimitero" : "Esilio";
  const s = openSheet(`<h2>${label} di ${esc(pl.name)} <span class="muted num">${ids.length}</span></h2>
    <p class="micro">${z === "graveyard" ? "In alto le ultime arrivate." : ""} Tocca una carta per spostarla.</p>
    <div class="hand-grid">${ids.map((id) => handCard(id, { act: "zc" })).join("") || '<p class="muted">Vuoto.</p>'}</div>
    ${z === "graveyard" && ids.length > 1 ? `<div class="pick-list"><button class="btn btn-big" data-x="exileall">Esilia tutto il cimitero</button></div>` : ""}`, { label });
  s.el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-x=exileall]")) {
      s.close();
      const ok = await confirmSheet("Esilia tutto il cimitero", `Le ${ids.length} carte del cimitero di ${pl.name} vanno in esilio.`, "Esilia tutto");
      if (ok) commit((st) => E.exileGraveyard(st, p));
      return;
    }
    const b = e.target.closest("[data-act=zc]");
    if (!b) return;
    e.stopPropagation();
    const id = b.dataset.id;
    const i = E.info(S, id);
    s.close();
    const opts = [{ value: "hand", label: "In mano" }, { value: "bf", label: "In campo" },
      { value: "cast", label: E.exiledAfterCast(S, id, z) ? "Lanciala da qui (poi va in esilio)" : "Lanciala da qui" }, { value: "top", label: "In cima al grimorio" },
      { value: "bottom", label: "In fondo al grimorio" }];
    opts.push(z === "graveyard" ? { value: "exile", label: "In esilio" } : { value: "grave", label: "Al cimitero" });
    const ans = await pick(E.displayName(S, id), opts, i ? (i.text_it || i.text || "").slice(0, 300) : "");
    if (!ans || (ans === "cast" && !stackOk())) return;
    if (ans === "cast") { castFlow(id, NET() ? mySeat : (S.viewer ?? S.cards[id].owner)); return; }
    commit((st) => {
      if (ans === "hand") E.moveCard(st, id, "hand");
      if (ans === "bf") E.enterBattlefield(st, id, { controller: st.cards[id].owner, how: `${st.players[st.cards[id].owner].name} mette ${E.displayName(st, id)} in campo da ${z === "graveyard" ? "cimitero" : "esilio"}.` });
      if (ans === "top") E.moveCard(st, id, "library", { pos: "top" });
      if (ans === "bottom") E.moveCard(st, id, "library", { pos: "bottom" });
      if (ans === "exile") E.moveCard(st, id, "exile");
      if (ans === "grave") E.moveCard(st, id, "graveyard");
    });
  });
}

// ---- promemoria delle carte ------------------------------------------------------------------
async function runPending(pid) {
  const q = S.pending.find((x) => x.pid === pid);
  if (!q) return;
  if (NET() && q.controller !== mySeat) return;
  if (q.trig.if && !condition(S, q.source, q.trig.if)) {
    commit((s) => {
      s.pending = s.pending.filter((x) => x.pid !== pid);
      E.logPublic(s, q.controller, `${E.displayName(s, q.source)}: la condizione non c'è più, niente effetto.`, "trigger");
    });
    return;
  }
  commit((s) => { s.pending = s.pending.filter((x) => x.pid !== pid); });
  await runEffects(q.source, q.trig.do || [], q.controller, q.trig.text_it || q.trig.text || "");
}

function runAllAuto() {
  const seat = NET() ? mySeat : null;
  commit((s) => {
    let guard = 0;
    while (guard++ < 120) {
      const q = s.pending.find((x) => isAuto(x) && (seat == null || x.controller === seat));
      if (!q) break;
      s.pending = s.pending.filter((x) => x !== q);
      if (q.trig.if && !condition(s, q.source, q.trig.if)) continue;
      for (const eff of q.trig.do || []) applySimple(s, q.source, eff, q.controller);
    }
  });
}

async function runEffects(src, effs, ctl, fullText) {
  for (const eff of effs) {
    const kind = effectKind(eff);
    if (eff.if && !condition(S, src, eff.if)) {
      commit((s) => E.logPublic(s, ctl, `${E.displayName(s, src)}: la condizione non c'è, nessun effetto.`, "trigger"));
      continue;
    }
    if (kind === "simple") { commit((s) => applySimple(s, src, eff, ctl)); continue; }
    // eslint-disable-next-line no-await-in-loop
    const goOn = await interactive(kind, eff, src, ctl, fullText);
    if (goOn === false) break;
  }
}

// l'ultima scelta di scarto (per "quando scarti carte non terra in questo modo")
let lastDiscard = null;

// la carta va bene per il filtro di un effetto: types (almeno uno), not_types, mv_lte
function fits(id, f) {
  const i = E.info(S, id);
  if (!i) return false;
  const has = (t) => (t === "Creature" ? E.hasType(S, id, "Creature") : (i.types || []).includes(t));
  if (f.types && f.types.length && !f.types.some(has)) return false;
  if (f.not_types && f.not_types.some(has)) return false;
  if (f.mv_lte != null && (i.mv ?? 0) > f.mv_lte) return false;
  return true;
}

const MAIN_TYPES_IT = { Creature: "creatura", Instant: "istantaneo", Sorcery: "stregoneria", Enchantment: "incantesimo",
  Artifact: "artefatto", Planeswalker: "planeswalker", Battle: "battaglia", Kindred: "tribale" };

// una carta per tipo: si puo' assegnare ogni carta a un tipo suo, tutti diversi?
function onePerType(ids) {
  const types = ids.map((id) => ((E.info(S, id) || {}).types || []).filter((t) => MAIN_TYPES_IT[t]));
  const used = new Set();
  const tryAt = (k) => {
    if (k === types.length) return true;
    for (const t of types[k]) {
      if (used.has(t)) continue;
      used.add(t);
      if (tryAt(k + 1)) return true;
      used.delete(t);
    }
    return false;
  };
  return tryAt(0);
}

// Uldaros Theorix: esilia dal cimitero fino a una carta non terra per tipo, poi lancia gratis le
// copie che vuoi con valore di mana totale fino a 6 (i permanenti diventano pedine)
async function uldarosFlow(f, src, ctl, srcName) {
  const lim = f.mv_total || 6;
  const pl = P(ctl);
  const pool = pl.graveyard.filter((id) => !(E.info(S, id) || {}).is_land);
  if (!pool.length) { toast("Nel tuo cimitero non ci sono carte non terra."); return true; }
  let got = null;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    got = await pickCards(`${srcName}: esilia dal cimitero`, pool, {
      note: `Fino a una carta per tipo (creatura, istantaneo, stregoneria, incantesimo, artefatto, planeswalker). Dopo scegli quali copie lanciare gratis: valore di mana totale fino a ${lim}.`,
      max: 7, min: 0, okLabel: "Esilia" });
    if (!got || !got.length) return true;
    if (onePerType(got)) break;
    toast("Al massimo una carta per tipo.");
  }
  const mv = (ids) => ids.reduce((t, id) => t + ((E.info(S, id) || {}).mv || 0), 0);
  let cast = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const pickNow = await pickCards(`Quali copie lanci? (valore totale fino a ${lim})`, got,
      { note: got.map((id) => `${E.displayName(S, id)}: ${(E.info(S, id) || {}).mv || 0}`).join(", "), max: got.length, min: 0, okLabel: "Lancia" });
    if (pickNow === null) { cast = []; break; }
    if (mv(pickNow) <= lim) { cast = pickNow; break; }
    toast(`Troppo: valore totale ${mv(pickNow)}, al massimo ${lim}.`);
  }
  commit((s) => {
    got.forEach((id) => E.moveCard(s, id, "exile", { reason: `${srcName} esilia ${E.displayName(s, id)} dal cimitero di ${s.players[ctl].name}` }));
    cast.forEach((id) => E.castCopy(s, id, ctl, { by: srcName }));
  });
  // le copie di istantanei e stregonerie senza pila si risolvono subito, con i loro effetti se li sappiamo
  if (!E.usesStack(S)) {
    for (const id of cast) {
      const i = E.info(S, id);
      const sp = i && !i.is_permanent ? E.spellOf(S, id) : null;
      // eslint-disable-next-line no-await-in-loop
      if (sp) await runEffects(id, sp.do, ctl, sp.text_it || sp.text || "");
      else if (i && !i.is_permanent) {
        // eslint-disable-next-line no-await-in-loop
        await interactive("note", { note: `Copia di ${E.displayName(S, id)}: ${i.text_it || i.text || "fai il suo effetto"}` }, id, ctl, "");
      }
    }
  }
  return true;
}

async function interactive(kind, eff, src, ctl, fullText) {
  const pl = P(ctl);
  const srcName = src && S.cards[src] ? E.displayName(S, src) : "";
  if (kind === "note") {
    const ans = await pick(srcName || "Promemoria", [{ value: "done", label: "Fatto" }, { value: "skip", label: "Salta" }], eff.note || fullText);
    if (ans === "done") commit((s) => E.logPublic(s, ctl, `${srcName}: ${eff.note || "fatto a mano"}.`, "trigger"));
    return true;
  }
  if (kind === "search") {
    const basics = pl.library.filter((id) => { const x = E.info(S, id); return x && x.is_land && (x.supertypes || []).includes("Basic"); })
      .sort((a, b) => E.displayName(S, a).localeCompare(E.displayName(S, b)));
    const got = await pickCards(`${srcName || "Cerca"}: una terra base`, basics, { note: "Va in campo tappata, poi il grimorio si mescola.", max: 1, min: 0, okLabel: "Prendi" });
    commit((s) => {
      if (got && got.length && s.cards[got[0]]) E.enterBattlefield(s, got[0], { controller: ctl, tapped: !!(eff.search && eff.search.tapped), how: `${s.players[ctl].name} cerca ${E.displayName(s, got[0])} e la mette in campo${eff.search && eff.search.tapped ? " tappata" : ""}.` });
      E.shuffleLibrary(s, ctl);
    });
    return true;
  }
  if (kind === "explore" && eff.explore === "target") {
    const mine = P(ctl).battlefield.filter((id) => E.hasType(S, id, "Creature"));
    if (!mine.length) { toast("Non hai creature che possano esplorare."); return true; }
    const got = await pickCards(`${srcName || "Mappa"}: chi esplora?`, mine, { max: 1, min: 1, okLabel: "Esplora" });
    if (!got || !got.length) return true;
    return interactive("explore", { explore: "self" }, got[0], ctl, fullText);
  }
  if (kind === "explore") {
    const top = pl.library[0];
    if (!top) { toast("Grimorio vuoto: niente da esplorare."); return true; }
    const ti = E.info(S, top);
    if (ti && ti.is_land) {
      commit((s) => { E.logPublic(s, ctl, `${srcName} esplora: rivela ${E.displayName(s, top)}, una terra, che va in mano.`, "trigger"); E.moveCard(s, top, "hand", { reason: `${s.players[ctl].name} prende ${E.displayName(s, top)} in mano` }); });
      return true;
    }
    const ans = await pick(`${srcName} esplora: rivela ${E.displayName(S, top)}`, [
      { value: "keep", label: "Lasciala in cima" }, { value: "grave", label: "Mettila nel cimitero" }],
    `Non è una terra: ${srcName} prende un segnalino +1/+1.`);
    commit((s) => {
      E.logPublic(s, ctl, `${srcName} esplora: rivela ${E.displayName(s, top)}.`, "trigger");
      if (s.cards[src]) E.addCounter(s, src, "P1P1", 1);
      if (ans === "grave") E.moveCard(s, top, "graveyard");
    });
    return true;
  }
  if (kind === "surveil" || kind === "scry") {
    const n = eff.surveil ?? eff.scry;
    const tops = pl.library.slice(0, n);
    for (const id of tops) {
      const opts = kind === "surveil"
        ? [{ value: "top", label: "Lasciala in cima" }, { value: "grave", label: "Mettila nel cimitero" }]
        : [{ value: "top", label: "Lasciala in cima" }, { value: "bottom", label: "Mettila in fondo" }];
      // eslint-disable-next-line no-await-in-loop
      const ans = await pick(`${kind === "surveil" ? "Sorveglia" : "Profetizza"}: ${E.displayName(S, id)}`, opts,
        `${srcName}. Guarda solo ${pl.name}.`);
      commit((s) => {
        E.logPublic(s, ctl, `${s.players[ctl].name} ${kind === "surveil" ? "sorveglia" : "profetizza"} ${n}.`, "trigger");
        if (ans === "grave") {
          E.moveCard(s, id, "graveyard");
          const lim = eff.regrow_if_mv_lte === "life_gained_this_turn" ? s.players[ctl].gained : eff.regrow_if_mv_lte;
          const mv = (E.info(s, id) || {}).mv ?? 99;
          if (lim != null && mv <= lim) E.moveCard(s, id, "hand", { reason: `${E.displayName(s, id)} costa ${mv}, non più delle vite guadagnate (${lim}): torna in mano a ${s.players[ctl].name}` });
        }
        if (ans === "bottom") E.moveCard(s, id, "library", { pos: "bottom" });
      });
    }
    return true;
  }
  if (kind === "discard") {
    const n = eff.discard;
    const isCreature = (id) => E.hasType(S, id, "Creature");
    let got = null;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      got = await pickCards(`${pl.name}: scarta ${plural(n, "carta", "carte")}${eff.unless_creature ? " o una creatura" : ""}`, pl.hand.slice(),
        { note: eff.unless_creature ? `Scarta ${plural(n, "carta", "carte")}, oppure una sola carta creatura.` : "",
          max: n, min: Math.min(eff.unless_creature ? 1 : n, pl.hand.length), okLabel: "Scarta" });
      if (!got || !eff.unless_creature || got.length >= Math.min(n, pl.hand.length) || got.every(isCreature)) break;
      toast("Una carta sola va bene solo se è una creatura.");
    }
    lastDiscard = { nonland: (got || []).filter((id) => !(E.info(S, id) || {}).is_land).length };
    if (got) commit((s) => got.forEach((id) => E.moveCard(s, id, "graveyard", { reason: `${s.players[ctl].name} scarta ${E.displayName(s, id)}` })));
    return true;
  }
  if (kind === "hand_discard") {
    if (S.mode === "solo") { toast("L'avversario finto non ha una mano: salta."); return true; }
    const foe = 1 - ctl;
    const fp = P(foe);
    const f = eff.hand_discard || {};
    const names = fp.hand.map((id) => E.displayName(S, id));
    commit((s) => E.logPublic(s, foe, `${fp.name} rivela la mano: ${names.join(", ") || "nessuna carta"}.`, "reveal"));
    const ok = fp.hand.filter((id) => fits(id, f));
    if (!ok.length) { toast(`${fp.name} non ha carte da scegliere.`); return true; }
    const got = await pickCards(`${srcName}: ${fp.name} scarta…`, ok, { note: `Mano di ${fp.name}: ${names.join(", ")}.`, max: 1, min: 1, okLabel: "Fagli scartare" });
    if (got && got.length) commit((s) => E.moveCard(s, got[0], "graveyard", { reason: `${s.players[ctl].name} sceglie ${E.displayName(s, got[0])}: ${fp.name} la scarta` }));
    return true;
  }
  if (kind === "bounce" || kind === "destroy" || kind === "exile") {
    const f = eff[kind];
    const pool = S.players.flatMap((x, k) => (f.controller === "opponent" && k === ctl ? [] : x.battlefield))
      .filter((id) => !(f.other && id === src) && fits(id, f));
    const what = { bounce: ["torna in mano", "In mano"], destroy: ["distruggi", "Distruggi"], exile: ["esilia", "Esilia"] }[kind];
    const who = f.chooser === "opponent" && S.mode !== "solo" ? `La sceglie ${P(1 - ctl).name}: chiediglielo. ` : "";
    const got = await pickCards(`${srcName}: ${what[0]}`, pool,
      { note: `${who}${f.mv_lte != null ? `Valore di mana fino a ${f.mv_lte}.` : ""}`, max: 1, min: 0, okLabel: what[1] });
    if (got && got.length) {
      commit((s) => {
        const owner = s.players[s.cards[got[0]].owner].name;
        if (kind === "bounce") E.moveCard(s, got[0], "hand", { reason: `${E.displayName(s, got[0])} torna in mano a ${owner} (${srcName})` });
        else if (kind === "exile") E.moveCard(s, got[0], "exile", { reason: `${srcName}: ${E.displayName(s, got[0])} va in esilio` });
        else E.moveCard(s, got[0], "graveyard", { reason: `${srcName} distrugge ${E.displayName(s, got[0])}` });
      });
    }
    return true;
  }
  if (kind === "modes") {
    const k = await pick(`${srcName}: scegli uno`, eff.modes.map((m, n) => ({ value: String(n), label: m.label })));
    if (k == null) return true;
    const m = eff.modes[Number(k)];
    commit((s) => E.logPublic(s, ctl, `${srcName}: ${s.players[ctl].name} sceglie «${m.label}».`, "trigger"));
    await runEffects(src, m.do || [], ctl, m.label);
    return true;
  }
  if (kind === "pump") {
    const f = eff.pump;
    const pool = S.players.flatMap((x) => x.battlefield).filter((id) => E.hasType(S, id, "Creature"));
    const got = await pickCards(`${srcName}: ${f.p >= 0 ? "+" : ""}${f.p}/${f.t >= 0 ? "+" : ""}${f.t} a…`, pool,
      { note: "Fino alla fine del turno. Se la costituzione va a 0, muore.", max: 1, min: 0, okLabel: "Conferma" });
    if (got && got.length) {
      commit((s) => {
        E.modPT(s, got[0], f.p, f.t, true, ctl);
        const pw = E.power(s, got[0]);
        if (pw && pw.t <= 0) E.moveCard(s, got[0], "graveyard", { reason: `${E.displayName(s, got[0])} ha costituzione ${pw.t}: muore` });
      });
    }
    return true;
  }
  if (kind === "destroy_all") {
    const x = await pick(`${srcName}: quanto vale X?`, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `X = ${n}` })),
      "Muoiono le creature con valore di mana fino a X.");
    if (x == null) return true;
    commit((s) => applySimple(s, src, { destroy_all: { ...eff.destroy_all, mv_lte: Number(x) } }, ctl));
    return true;
  }
  if (kind === "tap_stun") {
    const n = eff.tap_stun === "discarded_nonland" ? (lastDiscard ? lastDiscard.nonland : 0) : Number(eff.tap_stun) || 0;
    if (!n) { toast(`${srcName}: nessuna carta non terra scartata, niente da TAPpare.`); return true; }
    const pool = S.players.flatMap((x) => x.battlefield).filter((id) => E.hasType(S, id, "Creature"));
    const got = await pickCards(`${srcName}: TAPpa e stordisci (fino a ${n})`, pool,
      { note: "Ognuna si TAPpa e prende un segnalino stordimento: al prossimo stap non si stappa.", max: n, min: 0, okLabel: "TAPpa" });
    if (got && got.length) {
      commit((s) => {
        got.forEach((id) => { E.setTapped(s, id, true); E.addCounter(s, id, "STUN", 1); });
        E.logPublic(s, ctl, `${srcName}: ${got.map((id) => E.displayName(s, id)).join(", ")} ${got.length === 1 ? "si TAPpa e prende" : "si TAPpano e prendono"} un segnalino stordimento.`, "counter");
      });
    }
    return true;
  }
  if (kind === "uldaros") return uldarosFlow(eff.uldaros || {}, src, ctl, srcName);
  if (kind === "return") {
    const r = eff.return;
    const lim = r.mv_lte === "life_gained_this_turn" ? pl.gained : r.mv_lte;
    const ok = pl.graveyard.filter((id) => {
      const i = E.info(S, id);
      if (!i) return false;
      if (r.types && r.types.length && !r.types.some((t) => (i.types || []).includes(t))) return false;
      if (r.not_subtypes && r.not_subtypes.some((t) => (i.subtypes || []).includes(t))) return false;
      if (lim != null && i.mv > lim) return false;
      return true;
    });
    const got = await pickCards(`${srcName}: riporta ${r.to === "hand" ? "in mano" : "in campo"}`, ok,
      { note: lim != null ? `Valore di mana fino a ${lim}.` : "", max: 1, min: 0, okLabel: "Conferma" });
    if (got && got.length) {
      commit((s) => {
        if (r.to === "hand") E.moveCard(s, got[0], "hand");
        else E.enterBattlefield(s, got[0], { controller: ctl, how: `${srcName} riporta in campo ${E.displayName(s, got[0])}.` });
      });
    }
    return true;
  }
  if (kind === "damage_target") {
    const opts = S.mode === "solo" ? [{ value: "dummy", label: "L'avversario finto" }]
      : [{ value: String(1 - ctl), label: P(1 - ctl).name }, { value: String(ctl), label: pl.name }];
    opts.push({ value: "creature", label: "Una creatura (la gestisci a mano)" });
    const ans = await pick(`${srcName}: ${eff.damage} danni a…`, opts);
    if (ans == null || ans === "creature") return true;
    commit((s) => E.changeLife(s, ans === "dummy" ? "dummy" : Number(ans), -eff.damage, { why: `per ${srcName}` }));
    return true;
  }
  if (kind === "counter_target") {
    const all = S.players.flatMap((x) => x.battlefield);
    const got = await pickCards(`${srcName}: segnalino su…`, all, { max: 1, min: 1 });
    if (got && got.length) commit((s) => E.addCounter(s, got[0], eff.counter.kind, eff.counter.n || 1));
    return true;
  }
  return true;
}

// ---- combattimento ------------------------------------------------------------------------------
function damageSheet() {
  const pv = E.combatPreview(S);
  if (!pv) { ui = freshUi(); draw(); return; }
  const foe = S.mode === "solo" ? "l'avversario finto" : P(1 - S.active).name;
  let dmg = pv.toPlayer;
  let ll = pv.lifelink;
  const s = openSheet(`<h2>Danni del combattimento</h2>
    <div class="dmg-row"><span>Danni a ${esc(foe)}</span>
      <div class="stepper"><button class="btn" data-d="dmg-">−1</button><b class="num" id="dmg">${dmg}</b><button class="btn" data-d="dmg+">+1</button></div></div>
    <div class="dmg-row"><span>${esc(P(S.active).name)} guadagna (legame vitale)</span>
      <div class="stepper"><button class="btn" data-d="ll-">−1</button><b class="num" id="ll">${ll}</b><button class="btn" data-d="ll+">+1</button></div></div>
    <p class="micro">Ho sommato la forza degli attaccanti non bloccati. Le creature che si bloccano tra loro le sistemate voi: tocca quelle morte e mettile al cimitero.</p>
    <div class="pick-list"><button class="btn btn-object btn-big" data-ok>Applica i danni</button></div>`, { label: "Danni" });
  s.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-d]");
    if (b) {
      if (b.dataset.d === "dmg-") dmg = Math.max(0, dmg - 1);
      if (b.dataset.d === "dmg+") dmg++;
      if (b.dataset.d === "ll-") ll = Math.max(0, ll - 1);
      if (b.dataset.d === "ll+") ll++;
      s.el.querySelector("#dmg").textContent = dmg;
      s.el.querySelector("#ll").textContent = ll;
      return;
    }
    if (e.target.closest("[data-ok]")) {
      s.close();
      ui = freshUi();
      commit((st) => E.resolveCombat(st, dmg, ll));
    }
  });
}

// ---- fine turno --------------------------------------------------------------------------------
async function endTurnClicked() {
  const pl = P(S.active);
  if (STACK().length) { toast("Prima risolvete la pila."); return; }
  if (S.step !== "end") {
    commit((s) => E.endStep(s));
    if (S.pending.length) { toast("Prima di passare: risolvi o salta le abilità di fine turno."); return; }
  }
  if (S.pending.length) {
    const ok = await confirmSheet("Abilità ancora da risolvere", `Ce ne sono ${S.pending.length}. Le salto e passo il turno?`, "Salta e passa");
    if (!ok) return;
  }
  if (pl.hand.length > E.HAND_SIZE) {
    const extra = pl.hand.length - E.HAND_SIZE;
    const got = await pickCards(`Hai ${pl.hand.length} carte: scartane ${extra}`, pl.hand.slice(), { max: extra, min: extra, okLabel: "Scarta" });
    if (!got) return;
    commit((s) => got.forEach((id) => E.moveCard(s, id, "graveyard", { reason: `${s.players[s.active].name} scarta ${E.displayName(s, id)} a fine turno` })));
  }
  commit((s) => { s.pending = []; E.passTurn(s); });
}

// ---- altro ------------------------------------------------------------------------------------
// Altro: in alto le cose di tutti i turni (pedine, moneta, dado), poi la partita, in fondo e
// separate le uscite (fine partita, esci). Pausa o strumenti in cima, perche' cambiano tutto.
function moreSheet() {
  const net = NET();
  const asked = net && S.pauseAsk && S.pauseAsk.by === mySeat;
  const top = !net ? `<button class="btn btn-big" data-x="tools">${icon("tools")}Strumenti: cambia qualsiasi cosa</button>`
    : isHost() ? `<button class="btn btn-big" data-x="pausetools">${icon("pause")}Pausa e strumenti dell'host</button>`
      : `<button class="btn btn-big" data-x="askpause" ${asked ? "disabled" : ""}>${icon("pause")}${asked ? `Pausa chiesta ${esc(aName(hostName()))}` : `Chiedi una pausa ${esc(aName(hostName()))}`}</button>`;
  const two = S.players.length > 1;
  const stackOn = E.usesStack(S);
  const s = openSheet(`<h2>Altro</h2>
    <div class="pick-list">${top}</div>
    <div class="quick-grid">
      <button class="btn act2" data-x="token">${icon("token")}<span>Pedina</span></button>
      <button class="btn act2" data-x="coin">${icon("coin")}<span>Moneta</span></button>
      <button class="btn act2" data-x="die">${icon("die")}<span>Dado</span></button>
    </div>
    <h3 class="sheet-h">Partita</h3>
    <div class="pick-list">
      <button class="btn btn-big" data-x="diary">${icon("diary")}Diario della partita</button>
      ${two ? `<button class="switch-row" role="switch" aria-checked="${stackOn}" data-x="stackrule">
        <span class="sw-text"><b>Risposte sulla pila</b><span>${stackOn ? "Accese: ogni magia aspetta che l'altro la lasci risolvere." : "Spente: le magie si risolvono subito. Accendile per rispondere e contrastare."}</span></span>
        <span class="sw-pill" aria-hidden="true"><span></span></span></button>` : ""}
      <button class="btn btn-big" data-x="guide">${icon("info")}Guida veloce</button>
    </div>
    <div class="exit-zone">
      <button class="btn btn-quiet" data-x="end">Fine partita: scegli il vincitore</button>
      <a class="btn btn-quiet" href="#/">Esci (la partita resta salvata)</a>
    </div>`, { label: "Altro" });
  s.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    const x = b.dataset.x;
    if (x === "stackrule") {
      if (STACK().length) { toast("Prima risolvete la pila."); return; }
      const on = !E.usesStack(S);
      const who = NET() ? mySeat : S.viewer;
      commit((st) => E.setRule(st, "stack", on, who), { force: true });
      s.close();
      toast(on ? "Risposte sulla pila accese per tutti e due." : "Risposte sulla pila spente: le magie si risolvono subito.");
      return;
    }
    s.close();
    if (x === "token") return H.tokenSheet(hostCtx());
    if (x === "tools") return H.hostTools(hostCtx());
    if (x === "pausetools") return pauseGame(() => H.hostTools(hostCtx()));
    if (x === "askpause") return commit((st) => { if (!st.paused) { st.pauseAsk = { by: mySeat, at: Date.now() }; E.logPublic(st, mySeat, `${st.players[mySeat].name} chiede una pausa all'host.`, "host"); } }, { undoable: false, force: true });
    if (x === "coin") { const r = Math.random() < 0.5 ? "testa" : "croce"; toast(`Moneta: ${r}.`); return commit((st) => E.logPublic(st, st.viewer, `Moneta: ${r}.`, "dice")); }
    if (x === "die") { const r = 1 + Math.floor(Math.random() * 6); toast(`Dado: ${r}.`); return commit((st) => E.logPublic(st, st.viewer, `Dado: ${r}.`, "dice")); }
    if (x === "diary") return diarySheet();
    if (x === "guide") return guideSheet();
    if (x === "end") return askEnd("Chi ha vinto?", null, "concessa");
    return undefined;
  });
}

function guideSheet() {
  const net = NET();
  openSheet(`<h2>Guida veloce</h2>
    <ul class="guide">
      <li><b>Una carta in campo</b>: toccala per leggerla e usarla (tappa, segnalini, abilità, sposta). Una terra si tappa e stappa con un tocco; tienila premuta per aprirla.</li>
      <li><b>La mano</b> è in basso: toccala, poi tocca la carta da giocare.</li>
      <li><b>Il tasto grande a destra</b> fa la cosa successiva: fine turno, lascia risolvere, fatto, blocchi fatti. La riga al centro dice cosa tocca fare.</li>
      <li><b>Annulla</b> (la freccia al centro) torna indietro di una mossa${net ? " per tutti e due" : ""}; il <b>diario</b> racconta tutta la partita.</li>
      <li><b>Vite, veleno e velocità</b>: tocca il numero delle vite.</li>
      <li><b>Cimitero ed esilio</b>: tocca le icone accanto alle vite. Il pallino giallo sull'esilio vuol dire che hai carte da giocare da lì: le trovi nella mano.</li>
      ${net ? "<li><b>L'host</b> (chi ha creato la stanza) può mettere in pausa con il tasto pausa e cambiare qualsiasi cosa. L'altro può chiedere una pausa da Altro.</li>" : "<li><b>Strumenti</b> (in Altro) cambia qualsiasi cosa: forza, abilità, segnalini, zone, turno.</li>"}
      <li><b>Risposte sulla pila</b> (in Altro): accese, ogni magia aspetta che l'altro la lasci risolvere, così si può rispondere e contrastare.</li>
      <li>Il tasto <b>Indietro</b> del telefono chiude il foglio aperto.</li>
    </ul>`, { label: "Guida veloce" });
}

function diarySheet() {
  const byTurn = new Map();
  for (const l of S.log) {
    if (!byTurn.has(l.turn)) byTurn.set(l.turn, []);
    byTurn.get(l.turn).push(l);
  }
  const turns = [...byTurn.entries()].reverse();
  openSheet(`<h2>Diario</h2>
    <div class="diary">${turns.map(([t, ls]) => `<section><h3>Turno ${t}</h3><ol>${ls.map((l) => `<li class="k-${esc(l.kind)}">${esc(l.text)}</li>`).join("")}</ol></section>`).join("")}</div>`,
  { label: "Diario" });
}

// ---- fine partita -------------------------------------------------------------------------------
async function askDeath(p, why = "vite") {
  const winner = 1 - p;
  const title = why === "veleno" ? `${P(p).name} ha ${P(p).poison} segnalini veleno` : `${P(p).name} è a ${P(p).life} vite`;
  const ok = await confirmSheet(title, "La partita finisce qui?", `Sì, vince ${P(winner).name}`);
  if (ok) commit((s) => E.finish(s, winner, why), { force: true });
}

async function askEnd(title, suggested, reason) {
  const opts = S.mode === "solo"
    ? [{ value: "0", label: "Ho finito la prova" }, { value: "none", label: "Interrompi senza salvare un risultato" }]
    : [{ value: "0", label: `Vince ${P(0).name}` }, { value: "1", label: `Vince ${P(1).name}` }, { value: "none", label: "Nessun vincitore" }];
  if (suggested != null) opts.sort((a) => (a.value === String(suggested) ? -1 : 0));
  const ans = await pick(title, opts);
  if (ans == null) return;
  commit((s) => E.finish(s, ans === "none" ? null : Number(ans), ans === "none" ? "interrotta" : reason));
}

let saving = false;
async function drawEnd() {
  const sum = E.summary(S);
  const solo = S.mode === "solo";
  const w = S.winner == null ? null : P(S.winner);
  const title = solo
    ? (S.dummy.life <= 0 ? `A zero al turno ${P(0).turnsTaken}` : "Prova interrotta")
    : w ? `Vince ${w.name}` : "Partita finita";
  const sub = solo
    ? (S.dummy.life <= 0 ? `${P(0).deckName}: l'avversario finto è arrivato a ${S.dummy.life} al tuo turno ${P(0).turnsTaken}.` : "Nessun risultato da contare.")
    : `${P(0).name} (${P(0).deckName}) ${P(0).life} vite, ${P(1).name} (${P(1).deckName}) ${P(1).life} vite. Turno ${S.turn}.`;
  host.innerHTML = `<div class="handoff end">
    <h1>${esc(title)}</h1>
    <p class="muted">${esc(sub)}</p>
    <p class="save-state micro" id="save-state">${S.saved ? SAVED_TXT : "Salvo la partita…"}</p>
    <div class="pick-list end-actions">
      ${solo ? `<button class="btn btn-object btn-big" data-end="again">Riprova</button>`
        : `<button class="btn btn-object btn-big" data-end="rematch">Rivincita${w ? `: inizia ${esc(P(1 - S.winner).name)}` : ""}</button>
           <button class="btn btn-big" data-end="side">Rivincita con cambi dalla sideboard</button>`}
      <button class="btn btn-big" data-end="diary">${icon("diary")}Diario</button>
      <button class="btn btn-big" data-end="undo">${icon("undo")}Annulla la fine</button>
      <a class="btn btn-big" href="#/mazzo/${encodeURIComponent(P(NET() ? mySeat : 0).deck)}/partite">Statistiche del mazzo</a>
      <a class="btn btn-quiet" href="#/">Torna ai mazzi</a>
    </div>
  </div>`;
  host.querySelector(".end-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-end]");
    if (!b) return;
    if (b.dataset.end === "diary") diarySheet();
    if (b.dataset.end === "undo") undo();
    if (b.dataset.end === "rematch" || b.dataset.end === "again") { if (NET()) netRematch(); else rematch(); }
    if (b.dataset.end === "side") {
      if (NET()) commit((s) => { if (s.over && !s.sbNext) s.sbNext = { ready: [false, false], lists: [null, null], notes: [false, false] }; }, { undoable: false });
      else startSideboard();
    }
  });
  if (DEMO) {
    const el = host.querySelector("#save-state");
    if (el) el.textContent = "Nella prova nel browser le partite non si salvano.";
  } else if (!S.saved && !saving && (S.reason !== "interrotta")) {
    saving = true;
    try {
      await api.post("/api/games", sum);
      S.saved = true;
      save();
      const el = host.querySelector("#save-state");
      if (el) el.textContent = SAVED_TXT;
    } catch (ex) {
      const queue = store.get("unsent", []);
      if (!queue.some((g) => g.client_id === sum.client_id)) queue.push(sum);
      store.set("unsent", queue);
      const el = host.querySelector("#save-state");
      if (el) el.textContent = `Non riesco a salvarla adesso (${ex.message}). La tengo da parte e riprovo alla prossima partita.`;
    } finally {
      saving = false;
    }
  } else if (S.reason === "interrotta") {
    const el = host.querySelector("#save-state");
    if (el) el.textContent = "Partita interrotta: non la salvo.";
  }
}

// ---- sideboard tra una partita e l'altra (di nascosto, come al tavolo vero) --------------------
let sb = null;

function startSideboard() {
  const decks = E.getDecks().map((d) => ({ ...d, main: d.main.map((x) => ({ ...x })), side: d.side.map((x) => ({ ...x })) }));
  // due telefoni: ognuno cambia solo il suo mazzo, sul suo telefono
  sb = { decks, idx: NET() ? mySeat : 0, locked: !NET(), net: NET(), base: E.getDecks().map((d) => ({ main: d.main, side: d.side })) };
  drawSideboard();
}

function drawSideboard() {
  const p = sb.idx;
  const pl = P(p);
  const d = sb.decks[p];
  if (sb.locked) {
    host.innerHTML = `<div class="handoff">
      <div class="handoff-card sl-${esc(pl.sleeve)}" aria-hidden="true"><span></span></div>
      <h1>Sideboard di ${esc(pl.name)}</h1>
      <p class="muted">Passa il telefono ${esc(aName(pl.name))}: sceglie le carte da cambiare senza farle vedere.</p>
      <button class="btn btn-object btn-big" data-sb="unlock">Sono ${esc(pl.name)}</button>
      <button class="btn btn-quiet" data-sb="cancel">Lascia stare la sideboard</button>
    </div>`;
  } else {
    const nm = (n) => cardName(d.cards[n], n);
    const tot = (z) => d[z].reduce((t, x) => t + x.qty, 0);
    const rows = (zone) => d[zone].filter((x) => x.qty > 0)
      .sort((a, b) => nm(a.name).localeCompare(nm(b.name)))
      .map((x) => `<li class="sb-row"><span class="qty num">${x.qty}</span><span class="sb-name">${esc(nm(x.name))}</span>
        <button class="btn small-btn" data-sb="${zone === "main" ? "out" : "in"}" data-name="${esc(x.name)}">${zone === "main" ? "Fuori" : "Dentro"}</button></li>`).join("");
    host.innerHTML = `<div class="page sb-page">
      <h1>Sideboard di ${esc(pl.name)}</h1>
      <p class="muted small">Mazzo ${tot("main")} carte, sideboard ${tot("side")}. Fuori = la carta passa in sideboard; dentro = entra nel mazzo.</p>
      ${tot("main") < 60 ? `<p class="verdict warn">${icon("alert")}Il mazzo ha meno di 60 carte</p>` : ""}
      <h2 class="sb-h">Nel mazzo</h2><ul class="sb-list">${rows("main")}</ul>
      <h2 class="sb-h">In sideboard</h2><ul class="sb-list">${rows("side") || '<li class="muted">Vuota.</li>'}</ul>
      <div class="pick-list"><button class="btn btn-object btn-big" data-sb="done">Fatto</button>
        <button class="btn btn-big" data-sb="reset">Rimetti come prima</button>
        ${sb.net ? `<button class="btn btn-quiet" data-sb="cancel">Non cambio niente</button>` : ""}</div>
    </div>`;
  }
  host.querySelectorAll("[data-sb]").forEach((b) => b.addEventListener("click", onSb));
}

function moveSb(d, from, to, name) {
  const a = d[from].find((x) => x.name === name);
  if (!a || a.qty < 1) return;
  a.qty--;
  const b = d[to].find((x) => x.name === name);
  if (b) b.qty++; else d[to].push({ name, qty: 1 });
}

function onSb(e) {
  e.stopPropagation();
  const b = e.currentTarget;
  const d = sb.decks[sb.idx];
  const act = b.dataset.sb;
  if (sb.net && (act === "done" || act === "cancel")) {
    const seat = sb.idx;
    const base = sb.base[seat];
    if (act === "cancel") { d.main = base.main.map((x) => ({ ...x })); d.side = base.side.map((x) => ({ ...x })); }
    const changed = d.main.some((x) => (base.main.find((y) => y.name === x.name) || { qty: 0 }).qty !== x.qty);
    const list = { main: d.main.filter((y) => y.qty > 0), side: d.side.filter((y) => y.qty > 0) };
    sb = null;
    commit((s) => {
      if (!s.sbNext) return;
      s.sbNext.lists[seat] = list;
      s.sbNext.ready[seat] = true;
      s.sbNext.notes[seat] = changed;
    }, { undoable: false });
    return;
  }
  if (act === "cancel") { sb = null; draw(); return; }
  if (act === "unlock") sb.locked = false;
  if (act === "out") moveSb(d, "main", "side", b.dataset.name);
  if (act === "in") moveSb(d, "side", "main", b.dataset.name);
  if (act === "reset") {
    const base = sb.base[sb.idx];
    d.main = base.main.map((x) => ({ ...x }));
    d.side = base.side.map((x) => ({ ...x }));
  }
  if (act === "done") {
    const changed = d.main.some((x) => (sb.base[sb.idx].main.find((y) => y.name === x.name) || { qty: 0 }).qty !== x.qty);
    d.sbNote = changed;
    if (sb.idx + 1 < sb.decks.length) { sb.idx++; sb.locked = true; }
    else {
      const decks = sb.decks.map((x) => ({ ...x, main: x.main.filter((y) => y.qty > 0), side: x.side.filter((y) => y.qty > 0) }));
      sb = null;
      rematch(decks);
      return;
    }
  }
  drawSideboard();
}

// due telefoni: la nuova partita sostituisce quella finita (solo se e' ancora quella)
let rematching = false;
function netRematch() {
  if (rematching) return;
  rematching = true;
  try {
    const old = S;
    const oldId = old.id;
    let decks = E.getDecks();
    if (old.sbNext) decks = decks.map((d, i) => (old.sbNext.lists[i] ? { ...d, main: old.sbNext.lists[i].main, side: old.sbNext.lists[i].side } : d));
    E.setDecks(decks);
    store.set("game-decks", decks);
    const first = old.winner == null ? 1 - old.first : 1 - old.winner;
    const players = old.players.map((p) => ({ name: p.name, sleeve: p.sleeve }));
    players.match_id = old.match_id;
    players.game_no = (old.game_no || 1) + 1;
    players.rules = old.rules;
    const st = E.newGame({ mode: "duo", players, first });
    st.room = old.room;
    st.host = old.host ?? 0;
    st.deckLists = decks.map((d) => ({ main: d.main, side: d.side }));
    if (old.sbNext) old.sbNext.notes.forEach((ch, i) => { if (ch) E.logPublic(st, i, `${st.players[i].name} ha cambiato qualche carta con la sideboard.`, "mull"); });
    const frozen = JSON.stringify(st);
    const op = (s) => {
      if (s.id !== oldId || !s.over) return;
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, JSON.parse(frozen));
    };
    op(S);
    ui = freshUi();
    save();
    if (sync) sync.push(op, "start");
    draw();
  } finally {
    rematching = false;
  }
}

function rematch(newDecks = null) {
  const decks = newDecks || E.getDecks();
  E.setDecks(decks);
  const old = S;
  const first = old.mode === "solo" ? 0 : old.winner == null ? 1 - old.first : 1 - old.winner;
  const players = old.players.map((p) => ({ name: p.name, sleeve: p.sleeve }));
  players.match_id = old.match_id;
  players.game_no = (old.game_no || 1) + 1;
  players.rules = old.rules;
  const st = E.newGame({ mode: old.mode, players, first });
  decks.forEach((d, i) => { if (d.sbNote) E.logPublic(st, i, `${st.players[i].name} ha cambiato qualche carta con la sideboard.`, "mull"); d.sbNote = false; });
  startNew(st, decks);
  draw();
}

// manda le partite rimaste in sospeso (server spento al momento della fine)
export async function flushUnsent() {
  const queue = store.get("unsent", []);
  if (!queue.length) return;
  const left = [];
  for (const g of queue) {
    try { await api.post("/api/games", g); } catch { left.push(g); }
  }
  store.set("unsent", left);
}
