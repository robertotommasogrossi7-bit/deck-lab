// La stanza per giocare con due telefoni: codice, link e QR per l'amico, chi gioca con cosa,
// chi inizia. Quando la partita parte, tutti e due passano al tavolo.
import { api } from "../api.js";
import { rooms } from "../backend.js";
import { esc, icon, store, toast } from "../ui.js";
import { newGame, setDecks } from "./engine.js";
import { forgetSeat, mySeatIn, rememberSeat } from "./net.js";
import { SLEEVES } from "./setup.js";

export const VIEW = "hub";

let timer = null;
let seenVersion = -1;
let alive = 0;

export function leave() { stop(); }
function stop() { clearTimeout(timer); timer = null; alive++; }

const roomUrl = (code) => `${location.origin}${location.pathname}#/stanza/${code}`;

export async function render(root, { code }) {
  stop();
  const my = alive;
  code = code.toUpperCase();
  root.innerHTML = `<div class="page narrow"><p class="muted">Apro la stanza ${esc(code)}…</p></div>`;
  let room;
  try { room = await rooms.get(code); } catch (e) { root.innerHTML = page(`<h1>Non riesco ad aprire la stanza</h1><p class="muted">${esc(e.message)}</p>`); return; }
  if (my !== alive) return;
  if (!room) {
    root.innerHTML = page(`<h1>Stanza ${esc(code)} non trovata</h1>
      <p class="muted" style="margin-top:8px">Controlla il codice, oppure creane una nuova.</p>
      <div class="pick-list"><a class="btn btn-object btn-big" href="#/tavolo/nuova">Nuova partita</a></div>`);
    return;
  }
  seenVersion = room.version;
  const me = mySeatIn(code);
  if (room.state && me) { await enterTable(room); return; }
  const { decks } = await api.get("/api/decks");
  if (my !== alive) return;
  if (me) drawSeated(root, room, me, decks);
  else if (room.seats.length < 2) drawJoin(root, room, decks);
  else drawFull(root, room);
  if (me || room.seats.length < 2) watch(root, code, my);
}

// ogni 2 secondi: e' cambiato qualcosa? (l'amico e' entrato, la partita e' partita)
function watch(root, code, my) {
  const tick = async () => {
    if (my !== alive) return;
    try {
      const v = await rooms.version(code);
      if (my !== alive) return;
      if (v !== seenVersion) { render(root, { code }); return; }
    } catch { /* senza rete: riprovo */ }
    timer = setTimeout(tick, 2000);
  };
  timer = setTimeout(tick, 2000);
}

function page(inner) {
  return `<div class="page narrow lobby">
    <div class="topbar"><a class="btn btn-quiet back" href="#/">${icon("back")}Mazzi</a></div>${inner}</div>`;
}

const deckName = (decks, slug) => (decks.find((d) => d.slug === slug) || {}).name || slug || "?";

function deckOptions(decks, sel) {
  const g = (kind, label) => {
    const list = decks.filter((d) => d.kind === kind);
    return list.length ? `<optgroup label="${label}">${list.map((d) => `<option value="${esc(d.slug)}" ${d.slug === sel ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</optgroup>` : "";
  };
  return g("mine", "I tuoi") + g("gauntlet", "Il metagame");
}

function sleevePick(name, sel) {
  return `<div class="sleeve-pick" role="radiogroup" aria-label="Colore delle bustine">
    ${SLEEVES.map(([k, label]) => `<label class="sw sl-${k}"><input type="radio" name="${name}" value="${k}" ${k === sel ? "checked" : ""}>
      <span class="sw-card" aria-hidden="true"></span><span class="sr-only">${label}</span></label>`).join("")}</div>`;
}

function seatsList(room, decks, me) {
  const rows = [0, 1].map((i) => {
    const s = room.seats[i];
    if (!s) return `<li class="seat empty"><span class="sw-card sl-rosso" aria-hidden="true"></span><span><strong>Posto libero</strong><span class="muted small"> aspetto il tuo amico</span></span></li>`;
    return `<li class="seat"><span class="seat-card sl-${esc(s.sleeve)}" aria-hidden="true"></span>
      <span><strong>${esc(s.name)}${me && me.seat === i ? " (tu)" : ""}</strong>${i === 0 ? '<span class="host-badge">host</span>' : ""}<span class="muted small"> con ${esc(deckName(decks, s.deck))}</span></span></li>`;
  });
  return `<ul class="seats">${rows.join("")}</ul>
    <p class="micro">L'host è chi ha creato la stanza: può mettere in pausa la partita e sistemare qualsiasi cosa sul tavolo.</p>`;
}

function qrBlock(code) {
  return `<div class="qr-box">
      <div class="qr" id="qr" aria-hidden="true"></div>
      <p class="qr-addr"><span class="room-code num">${esc(code)}</span></p>
    </div>
    <div class="row-actions"><button class="btn btn-object btn-big" data-act="share">Manda il link all'amico</button></div>`;
}

async function drawQr(root, code) {
  const el = root.querySelector("#qr");
  if (!el) return;
  try {
    const { default: qrcode } = await import("../../vendor/qrcode.mjs");
    const qr = qrcode(0, "M");
    qr.addData(roomUrl(code));
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  } catch { el.hidden = true; }
}

function bindShare(root, code, host) {
  const b = root.querySelector("[data-act=share]");
  if (!b) return;
  b.addEventListener("click", async () => {
    const { shareLink } = await import("../views/info.js");
    shareLink(roomUrl(code), `${host}: partita a Magic nel Deck Lab, stanza ${code}.`);
  });
}

// ---- sono gia' nella stanza ----------------------------------------------------------------------
function drawSeated(root, room, me, decks) {
  const full = room.seats.length >= 2;
  const host = room.seats[0] ? room.seats[0].name : "";
  const mine = room.seats[me.seat] || {};
  const other = room.seats[1 - me.seat];
  root.innerHTML = page(`
    <h1>Stanza ${esc(room.code)}</h1>
    ${full ? `<p class="muted" style="margin-top:6px">Ci siete tutti e due.</p>` : `<p class="muted" style="margin-top:6px">Manda il link all'amico, oppure fagli inquadrare il QR. Va bene anche da un'altra casa.</p>${qrBlock(room.code)}`}
    <section class="deck-section"><h2>Giocatori</h2>${seatsList(room, decks, me)}</section>
    <section class="deck-section">
      <h2>Il tuo mazzo</h2>
      <form class="stack-form" id="mine">
        <label class="field"><span>Mazzo</span><select name="deck">${deckOptions(decks, mine.deck)}</select></label>
        <div class="field"><span>Bustine</span>${sleevePick("sleeve", mine.sleeve || "nero")}</div>
      </form>
    </section>
    ${me.seat === 0 && full ? `<section class="deck-section">
      <h2>Chi inizia</h2>
      <div class="seg" id="first">
        <label><input type="radio" name="first" value="coin" checked><span>${icon("coin")}Moneta</span></label>
        <label><input type="radio" name="first" value="0"><span>${esc(room.seats[0].name)}</span></label>
        <label><input type="radio" name="first" value="1"><span>${esc(room.seats[1].name)}</span></label>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="pick-list"><button class="btn btn-object btn-big" data-act="start">${icon("play")}Inizia la partita</button></div>
    </section>` : full ? `<p class="muted lobby-wait">Aspetta che ${esc(host)} inizi la partita.</p>` : ""}
    <div class="pick-list"><button class="btn btn-quiet" data-act="leave">Esci dalla stanza</button></div>`);
  if (!full) { drawQr(root, room.code); bindShare(root, room.code, mine.name || "Ti invito"); }
  root.querySelector("#mine").addEventListener("change", async (e) => {
    const f = e.currentTarget;
    try {
      const r = await rooms.setSeat(room.code, me.seat, { name: mine.name, deck: f.deck.value, sleeve: f.sleeve.value });
      if (r && r.ok) { seenVersion = r.version; toast("Fatto."); }
    } catch (ex) { toast(ex.message, 5000); }
  });
  root.querySelector("[data-act=leave]").addEventListener("click", () => { forgetSeat(); location.hash = "#/"; });
  const start = root.querySelector("[data-act=start]");
  if (start) start.addEventListener("click", () => startGame(root, room, start));
  if (other && !room.state) { /* in attesa */ }
}

async function startGame(root, room, btn) {
  const err = root.querySelector(".form-error");
  err.hidden = true;
  btn.disabled = true;
  try {
    const fresh = await rooms.get(room.code);
    const decks = await Promise.all(fresh.seats.map((s) => api.get(`/api/decks/${encodeURIComponent(s.deck)}/table`)));
    for (const d of decks) if (!d.main.length) throw new Error(`Il mazzo ${d.name} è vuoto.`);
    const choice = root.querySelector("input[name=first]:checked").value;
    const first = choice === "coin" ? (Math.random() < 0.5 ? 0 : 1) : Number(choice);
    setDecks(decks);
    const players = fresh.seats.map((s) => ({ name: s.name, sleeve: s.sleeve }));
    const state = newGame({ mode: "duo", players, first });
    state.room = fresh.code;
    state.host = 0;
    if (choice === "coin") state.log[state.log.length - 1].text = `Moneta: ${state.players[first].name} inizia la partita.`;
    const r = await rooms.push(fresh.code, fresh.version, state, "start", 0);
    if (!r || !r.ok) throw new Error(r && r.conflict ? "Qualcosa è cambiato nella stanza: riprova." : "Non riesco a cominciare la partita.");
    stop();
    await enterTable({ ...fresh, version: r.version, state });
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
  }
}

async function enterTable(room) {
  stop();
  const decks = await Promise.all(room.state.players.map((p) => api.get(`/api/decks/${encodeURIComponent(p.deck)}/table`)));
  const view = await import("./view.js");
  view.startNew(room.state, decks);
  location.hash = "#/tavolo";
}

// ---- entro nella stanza -----------------------------------------------------------------------------
function drawJoin(root, room, decks) {
  const host = room.seats[0] || {};
  const prefs = store.get("setup", {});
  const name = prefs.n1 && prefs.n1 !== host.name ? prefs.n1 : "";
  const deck = prefs.d1 || (decks.find((d) => d.slug !== host.deck) || decks[0] || {}).slug;
  root.innerHTML = page(`
    <h1>${esc(host.name || "Un amico")} ti invita a giocare</h1>
    <p class="muted" style="margin-top:6px">Stanza ${esc(room.code)}. ${esc(host.name || "")} gioca con ${esc(deckName(decks, host.deck))}.</p>
    <form class="stack-form" id="join">
      <label class="field"><span>Il tuo nome</span><input type="text" name="name" maxlength="20" required value="${esc(name)}" placeholder="Per esempio: Marco"></label>
      <label class="field"><span>Il tuo mazzo</span><select name="deck">${deckOptions(decks, deck)}</select></label>
      <div class="field"><span>Bustine</span>${sleevePick("sleeve", host.sleeve === "rosso" ? "blu" : "rosso")}</div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-object btn-big" type="submit">Entra nella stanza</button>
    </form>`);
  const form = root.querySelector("#join");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = form.querySelector(".form-error");
    err.hidden = true;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const seat = { name: form.name.value.trim() || "Amico", deck: form.deck.value, sleeve: form.sleeve.value };
      const r = await rooms.join(room.code, seat);
      if (!r || !r.ok) throw new Error(r && r.error === "full" ? "La stanza è già piena." : "Stanza non trovata.");
      rememberSeat(room.code, r.seat, seat.name);
      store.set("setup", { ...store.get("setup", {}), n1: seat.name, d1: seat.deck, s1: seat.sleeve });
      render(root, { code: room.code });
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}

// stanza piena e questo telefono non ha un posto: forse e' uno dei due su un altro browser
function drawFull(root, room) {
  root.innerHTML = page(`
    <h1>Stanza ${esc(room.code)} piena</h1>
    <p class="muted" style="margin-top:6px">Ci sono già due giocatori. Se sei uno dei due e hai cambiato telefono o browser, scegli chi sei.</p>
    <div class="pick-list">${room.seats.map((s, i) => `<button class="btn btn-big" data-seat="${i}">Sono ${esc(s.name)}</button>`).join("")}</div>`);
  root.querySelectorAll("[data-seat]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.seat);
    rememberSeat(room.code, i, room.seats[i].name);
    render(root, { code: room.code });
  }));
}
