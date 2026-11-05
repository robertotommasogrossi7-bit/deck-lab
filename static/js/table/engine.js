// Il tavolo senza regole: tiene le zone, le vite, le carte tappate, il diario e la pila dei
// promemoria. Tutte le funzioni qui modificano lo stato che ricevono e non toccano la pagina:
// la vista le chiama dentro commit(), che salva una copia per "Annulla".
import { shuffle, uid } from "../ui.js";
import { collect, describe } from "./effects.js";
import { COUNTER_KEYWORD, JACE_TOKEN, TOKEN_EXTRAS } from "./tokens.js";

export const START_LIFE = 20;
export const HAND_SIZE = 7;

// mazzi della partita in corso: { slug, name, cards: {nome: info}, scripts: {nome: script} }
let DECKS = [];
export function setDecks(decks) { DECKS = decks; }
export function getDecks() { return DECKS; }

// ---- creazione --------------------------------------------------------------------------------
export function newGame({ mode, players, first = 0 }) {
  const s = {
    v: 1, id: uid(), started_at: new Date().toISOString(), mode,
    phase: "mulligan", turn: 1, active: first, first, viewer: first, locked: mode === "duo",
    players: [], cards: {}, pending: [], combat: null, log: [], seq: 0,
    winner: null, reason: null, over: false, dummy: mode === "solo" ? { life: START_LIFE } : null,
    rules: { stack: !!(players.rules && players.rules.stack) },
    match_id: players.match_id || uid(), game_no: players.game_no || 1,
  };
  players.forEach((p, i) => {
    const deck = DECKS[i];
    const library = [];
    for (const { name, qty } of deck.main) {
      for (let k = 0; k < qty; k++) {
        const id = `p${i}c${++s.seq}`;
        s.cards[id] = blankCard(id, name, i);
        library.push(id);
      }
    }
    s.players.push({
      name: p.name, deck: deck.slug, deckName: deck.name, hash: deck.hash, sleeve: p.sleeve,
      life: START_LIFE, poison: 0, library: shuffle(library), hand: [], graveyard: [], exile: [],
      battlefield: [], mulligans: 0, kept: false, gained: 0, lost: 0, turnsTaken: 0,
      landsThisTurn: 0,
    });
  });
  // mulligan: si parte in ordine dal primo giocatore
  s.players.forEach((_, i) => drawN(s, i, HAND_SIZE, { silent: true }));
  s.mulliganTurn = first;
  logPublic(s, null, `${s.players[first].name} inizia la partita.`);
  return s;
}

function blankCard(id, name, owner, token = null) {
  return { id, name, owner, controller: owner, tapped: false, counters: {}, token,
    enteredTurn: null, attacking: false, blocked: false, solved: false, chosen: null };
}

// ---- informazioni sulle carte -----------------------------------------------------------------
// una pedina che ha lasciato il campo resta in s.gone, per le sue abilita' ancora in pila
const rec = (s, id) => s.cards[id] || (s.gone && s.gone[id]) || null;

// carta a faccia in giu': per tutti e' una creatura 2/2 senza nome (il proprietario la guarda con infoReal)
export const FACE_DOWN = {
  name: "Face-down", it: "A faccia in giù", type: "Creature", type_it: "Creatura", types: ["Creature"], subtypes: [],
  supertypes: [], pt: "2/2", text: "Creatura 2/2 senza nome, senza colore e senza abilità.",
  text_it: "Creatura 2/2 senza nome, senza colore e senza abilità.", cost: "", colors: "",
  is_permanent: true, is_creature: true, is_land: false, faces: [],
};
const MAIN_TYPES = ["Creature", "Artifact", "Enchantment", "Land", "Planeswalker", "Instant", "Sorcery", "Battle", "Kindred"];
const SUPER_TYPES = ["Legendary", "Basic", "Snow", "World"];

// l'altra faccia di una carta bifronte (craft, saghe che si girano...)
function backInfo(base) {
  const f = base.faces[1];
  const words = String(f.type || "").split(/\s+/).filter(Boolean);
  const types = words.filter((w) => MAIN_TYPES.includes(w));
  return { ...base, name: f.name, it: f.it, type: f.type, type_it: null, types,
    supertypes: words.filter((w) => SUPER_TYPES.includes(w)), subtypes: words.filter((w) => !MAIN_TYPES.includes(w) && !SUPER_TYPES.includes(w)),
    pt: f.pt, loyalty: f.loyalty, text: f.text, text_it: null, cost: f.cost || "",
    is_creature: types.includes("Creature"), is_land: types.includes("Land"), is_permanent: !types.includes("Instant") && !types.includes("Sorcery") };
}

// carte che possono entrare come copia di una carta creatura in un cimitero (e cosa tengono di loro)
export const ENTER_AS_COPY = {
  "Superior Spider-Man": { pt: "4/4", add: ["Spider", "Human", "Hero"], add_it: "Eroe Umano Ragno" },
};
export function entersAsCopy(s, id) {
  const c = rec(s, id);
  return (c && !c.token && ENTER_AS_COPY[c.name]) || null;
}

// la copia: le informazioni della carta copiata, con il nome e la forza/costituzione della carta vera
function copyInfo(s, c) {
  const k = c.copy;
  const src = (DECKS[k.owner] && DECKS[k.owner].cards[k.name]) || null;
  const self = (DECKS[c.owner] && DECKS[c.owner].cards[c.name]) || null;
  if (!src) return self;
  const srcName = src.it || src.name;
  const extra = ENTER_AS_COPY[c.name] || {};
  const head = `Copia di ${srcName}: si chiama ${c.name} ed è ${extra.pt || src.pt || ""} ${extra.add_it || ""}`.replace(/\s+/g, " ").trim();
  return { ...src, name: c.name, it: null, pt: extra.pt || src.pt,
    subtypes: [...new Set([...(src.subtypes || []), ...(extra.add || [])])],
    text: `${head}.\n${src.text || ""}`, text_it: `${head}.\n${src.text_it || src.text || ""}`,
    faces: src.faces || [], copyOf: srcName };
}

export function infoReal(s, id) {
  const c = rec(s, id);
  if (!c) return null;
  if (c.token) return c.token.info;
  if (c.copy) return copyInfo(s, c);
  const base = (DECKS[c.owner] && DECKS[c.owner].cards[c.name]) || null;
  if (c.back && base && base.faces && base.faces[1]) return backInfo(base);
  return base;
}

export function info(s, id) {
  const c = rec(s, id);
  if (!c) return null;
  if (c.faceDown) return FACE_DOWN;
  return infoReal(s, id);
}

export function script(s, id) {
  const c = rec(s, id);
  if (!c || c.faceDown || c.back) return null;
  if (c.token) return c.token.script || null;
  if (c.copy) return (DECKS[c.copy.owner] && DECKS[c.copy.owner].scripts && DECKS[c.copy.owner].scripts[c.copy.name]) || null;
  return (DECKS[c.owner] && DECKS[c.owner].scripts && DECKS[c.owner].scripts[c.name]) || null;
}

// imminente: con segnalini tempo non e' una creatura
export const isImpending = (c) => !!(c && c.impending && (c.counters.TIME || 0) > 0);

export function realName(s, id) {
  const i = infoReal(s, id);
  const c = rec(s, id);
  return (i && (i.it || i.name)) || (c && c.name) || "?";
}

export function displayName(s, id) {
  const i = info(s, id);
  const c = rec(s, id);
  return (i && (i.it || i.name)) || (c && c.name) || "?";
}

// nome breve per le carte piccole: i leggendari con la virgola si chiamano per nome ("Kaito")
export function shortName(s, id) {
  const n = displayName(s, id);
  const k = n.indexOf(", ");
  return k > 2 ? n.slice(0, k) : n;
}

export function hasType(s, id, t) {
  const c = rec(s, id);
  if (t === "Creature" && isImpending(c)) return false;
  if (t === "Creature" && c && c.becomes) return true;
  const i = info(s, id);
  return !!(i && (i.types || []).includes(t));
}

export function keywords(s, id) {
  const c = rec(s, id);
  if (c && c.faceDown) return new Set();
  const sc = script(s, id);
  const i = info(s, id);
  const k = new Set((sc && sc.keywords) || []);
  if (!sc && i && i.text) {          // senza script: parole chiave dalla prima riga del testo
    for (const w of ["Flying", "Lifelink", "Vigilance", "Deathtouch", "Trample", "Haste", "First strike",
      "Double strike", "Reach", "Menace", "Defender", "Hexproof", "Indestructible", "Flash"]) {
      if (new RegExp(`(^|\\n|, )${w}(,|\\n|$| \\()`, "i").test(i.text)) k.add(w.replace(/ s/, " S"));
    }
  }
  // segnalini parola chiave (volare, tocco letale...): valgono finche' ci sono
  if (c && c.counters) for (const [kind, kw] of Object.entries(COUNTER_KEYWORD)) if (c.counters[kind] > 0) k.add(kw);
  // abilita' date o tolte dall'host: per sempre, poi fino a fine turno
  for (const m of [c && c.kw, c && c.kwEot]) {
    if (!m) continue;
    (m.add || []).forEach((x) => k.add(x));
    (m.del || []).forEach((x) => k.delete(x));
  }
  return k;
}

export function power(s, id) {
  const i = info(s, id);
  const c = s.cards[id];
  if (!c) return null;
  if (isImpending(c) && !c.becomes) return null;
  const printed = i && i.pt;
  const basePt = (!c.faceDown && c.basePt) || (c.becomes && c.becomes.pt) || printed;
  if (!basePt) return null;
  const [p, t] = String(basePt).split("/").map((x) => parseInt(x, 10));
  const plus = (c.counters.P1P1 || 0) - (c.counters.M1M1 || 0);
  const mod = c.mod || { p: 0, t: 0 };
  const pm = c.pmod || { p: 0, t: 0 };
  let dyn = 0;
  if (!c.faceDown && c.token && c.token.info && c.token.info.dyn === "artifacts") {
    dyn = s.players[c.controller].battlefield.filter((x) => hasType(s, x, "Artifact")).length;
  }
  return { p: (Number.isNaN(p) ? 0 : p) + plus + mod.p + pm.p + dyn, t: (Number.isNaN(t) ? 0 : t) + plus + mod.t + pm.t + dyn,
    base: printed || basePt };
}

export function zoneOf(s, id) {
  for (let i = 0; i < s.players.length; i++) {
    const P = s.players[i];
    for (const z of ["hand", "battlefield", "library", "graveyard", "exile"]) {
      if (P[z].includes(id)) return { player: i, zone: z };
    }
  }
  return null;
}

export const opp = (s, p) => (s.players.length > 1 ? 1 - p : null);

// ---- diario -----------------------------------------------------------------------------------
// Il diario e' pubblico: mai scriverci carte nascoste (pescate, mano, cima del grimorio).
export function logPublic(s, p, text, kind = "") {
  s.log.push({ turn: s.turn, p, text, kind, at: Date.now() });
}

// ---- movimenti -------------------------------------------------------------------------------
function removeFromZone(s, id) {
  const z = zoneOf(s, id);
  if (z) {
    const arr = s.players[z.player][z.zone];
    arr.splice(arr.indexOf(id), 1);
    if (z.zone === "exile" && s.cards[id]) { s.cards[id].playable = null; s.cards[id].linkedTo = null; }
  }
  return z;
}

export function drawN(s, p, n = 1, { silent = false } = {}) {
  const P = s.players[p];
  let got = 0;
  for (let k = 0; k < n; k++) {
    if (!P.library.length) {
      logPublic(s, p, `${P.name} dovrebbe pescare ma il grimorio è vuoto: ha perso la partita.`, "alert");
      s.emptyDraw = p;
      break;
    }
    P.hand.push(P.library.shift());
    got++;
  }
  if (!silent && got) logPublic(s, p, `${P.name} pesca ${got === 1 ? "una carta" : `${got} carte`}.`, "draw");
  return got;
}

// sposta una carta in una zona; `pos` per il grimorio: "top" | "bottom".
// `sacrificed`: la carta e' stata sacrificata (oltre a "muore" parte anche "sacrificata").
export function moveCard(s, id, zone, { pos = "top", to = null, reason = "", sacrificed = false } = {}) {
  const c = s.cards[id];
  leaveStack(s, id);
  const from = removeFromZone(s, id);
  const owner = c.owner;
  const ctl = c.controller;
  const name = c.faceDown ? realName(s, id) : displayName(s, id);
  const fromBf = from && from.zone === "battlefield";
  const wasCreature = fromBf && hasType(s, id, "Creature");
  if (fromBf) {
    c.tapped = false; c.counters = {}; c.attacking = false; c.blocked = false; c.mod = null;
    c.controller = owner; c.solved = false;
    leftBattlefield(s, id);
  }
  if (c.token && zone !== "battlefield") {           // le pedine smettono di esistere
    logPublic(s, owner, `${reason || `${name} (pedina) lascia il campo`}.`, "move");
    if (fromBf && zone === "graveyard") {            // ma prima "muoiono": le abilita' lo vedono
      if (wasCreature) collect(s, { type: "dies", card: id, controller: ctl });
      if (sacrificed) collect(s, { type: "sacrificed", card: id, controller: ctl });
    }
    s.gone = s.gone || {};
    s.gone[id] = { name: c.name, owner, token: c.token };   // le sue abilita' in pila sanno ancora chi era
    delete s.cards[id];
    return null;
  }
  const P = s.players[to ?? owner];
  if (zone === "library") {
    if (pos === "bottom") P.library.push(id); else P.library.unshift(id);
  } else {
    P[zone].push(id);
  }
  if (zone === "battlefield") {
    c.enteredTurn = s.turn;
    c.controller = to ?? owner;
  }
  const where = { hand: "in mano", graveyard: "al cimitero", exile: "in esilio", battlefield: "in campo",
    library: pos === "bottom" ? "in fondo al grimorio" : "in cima al grimorio" }[zone];
  const hiddenTarget = zone === "hand" || zone === "library";
  const hiddenSource = from && (from.zone === "hand" || from.zone === "library");
  if (!(hiddenTarget && hiddenSource)) {
    const who = s.players[owner].name;
    logPublic(s, owner, `${reason || `${who} mette ${name} ${where}`}.`, "move");
  }
  if (fromBf && zone === "graveyard") {
    if (wasCreature) collect(s, { type: "dies", card: id, controller: ctl });
    if (sacrificed) collect(s, { type: "sacrificed", card: id, controller: ctl });
  }
  return from;
}

// una carta lascia il campo: via gli stati in piu', cadono le aure agganciate, tornano le carte
// esiliate "finche' resta in campo"
function leftBattlefield(s, id) {
  const c = s.cards[id];
  Object.assign(c, { pmod: null, basePt: null, kw: null, kwEot: null, becomes: null, attachedTo: null,
    prepared: false, noUntap: 0, faceDown: false, back: false, sacAtEnd: false, exileAtEnd: false,
    copy: null, impending: false });
  for (const P of s.players) {
    for (const other of [...P.battlefield]) {
      const o = s.cards[other];
      if (!o || o.attachedTo !== id) continue;
      o.attachedTo = null;
      const oi = info(s, other);
      if (oi && (oi.subtypes || []).includes("Aura")) moveCard(s, other, "graveyard", { reason: `${displayName(s, other)} cade: la carta a cui era agganciata ha lasciato il campo` });
    }
    for (const other of [...P.exile]) {
      const o = s.cards[other];
      if (!o || o.linkedTo !== id) continue;
      o.linkedTo = null;
      o.playable = null;
      enterBattlefield(s, other, { controller: o.owner, how: `${displayName(s, other)} torna in campo: ${displayName(s, id)} se n'è andata.` });
    }
  }
}

// tutto il cimitero in esilio (Tradimento Strategico, Insabbiamento Fatale...)
export function exileGraveyard(s, p) {
  const P = s.players[p];
  const n = P.graveyard.length;
  P.exile.push(...P.graveyard.splice(0));
  logPublic(s, p, `${P.name} esilia tutto il cimitero (${n === 1 ? "una carta" : `${n} carte`}).`, "move");
}

export function shuffleLibrary(s, p) {
  s.players[p].library = shuffle(s.players[p].library);
  logPublic(s, p, `${s.players[p].name} mescola il grimorio.`, "move");
}

// entra nel campo (da qualunque zona) e fa partire i promemoria "quando entra".
// `cast`: arriva da una magia lanciata; allora valgono le scelte fatte lanciandola (c.castInfo):
// copia (Superior Spider-Man), imminente (segnalini tempo), apparire (poi si sacrifica), mana speso.
export function enterBattlefield(s, id, { tapped = false, controller = null, how = "", cast = false } = {}) {
  const c = s.cards[id];
  leaveStack(s, id);
  const p = controller ?? c.owner;
  const ci = (cast && c.castInfo) || {};
  c.castInfo = null;
  c.wasCast = !!cast;
  c.spent = (cast && ci.spent) || null;
  removeFromZone(s, id);
  s.players[p].battlefield.push(id);
  c.controller = p;
  c.tapped = tapped;
  c.enteredTurn = s.turn;
  if (how) logPublic(s, p, how, "play");
  if (ci.copyOf) becomeCopy(s, id, ci.copyOf, p);
  const i = info(s, id);
  if (i && i.loyalty && !c.counters.LOYALTY) c.counters.LOYALTY = parseInt(i.loyalty, 10) || 0;
  if (ci.impending) {
    c.impending = true;
    c.counters.TIME = ci.impending;
    logPublic(s, p, `${displayName(s, id)} entra con ${ci.impending} segnalini tempo: non è una creatura finché ne ha.`, "counter");
  }
  if (isSaga(s, id)) {
    c.counters.LORE = 1;
    logPublic(s, p, `${displayName(s, id)}: capitolo I.`, "counter");
  }
  if (!c.faceDown && i && /enters prepared/i.test(i.text || "")) c.prepared = true;
  collect(s, { type: "enters", card: id, controller: p });
  // apparire: entra, le sue abilita' "quando entra" partono, poi si sacrifica
  if (ci.evoke && s.cards[id] && zoneOf(s, id)?.zone === "battlefield") {
    moveCard(s, id, "graveyard", { sacrificed: true, reason: `${displayName(s, id)} è entrata con Apparire: si sacrifica` });
  }
}

// entra come copia di una carta creatura in un cimitero (che poi va in esilio)
function becomeCopy(s, id, srcId, p) {
  const c = s.cards[id];
  const src = s.cards[srcId];
  const z = src && zoneOf(s, srcId);
  if (!src || !z || z.zone !== "graveyard" || !hasType(s, srcId, "Creature")) {
    logPublic(s, p, `${displayName(s, id)}: la carta da copiare non è più nel cimitero, entra com'è.`, "play");
    return;
  }
  const srcName = displayName(s, srcId);
  c.copy = { name: src.name, owner: src.owner };
  logPublic(s, p, `${c.name} entra come copia di ${srcName}.`, "play");
  moveCard(s, srcId, "exile", { reason: `${srcName} va in esilio (l'ha copiata ${c.name})` });
}

// carta in campo a faccia in giu' (camuffamento, manto, manifesta): per tutti e' una 2/2 senza nome
export function putFaceDown(s, id, { controller = null, tapped = false, how = "" } = {}) {
  const c = s.cards[id];
  if (!c) return;
  const p = controller ?? c.owner;
  c.faceDown = true;
  enterBattlefield(s, id, { controller: p, tapped, how: how || `${s.players[p].name} mette in campo una carta a faccia in giù (2/2).` });
}

export function isSaga(s, id) {
  const i = info(s, id);
  return !!(i && (i.subtypes || []).includes("Saga"));
}

export function playLand(s, id, { tapped = false, payLife = 0, chosen = null, controller = null } = {}) {
  const c = s.cards[id];
  const p = controller ?? c.owner;
  const P = s.players[p];
  P.landsThisTurn++;
  if (chosen) c.chosen = chosen;
  enterBattlefield(s, id, { tapped, controller: p, how: `${P.name} gioca ${displayName(s, id)}${tapped ? " (tappata)" : ""}${chosen ? `, tipo ${chosen}` : ""}.` });
  if (payLife) changeLife(s, p, -payLife, { why: `per ${displayName(s, id)}` });
}

// scelte fatte lanciando una magia: { spent: {UU, BB}, evoke, impending: n, copyOf: id }
function castChoices(opts) {
  const out = {};
  if (opts.spent) out.spent = opts.spent;
  if (opts.evoke) out.evoke = true;
  if (opts.impending) out.impending = opts.impending;
  if (opts.copyOf) out.copyOf = opts.copyOf;
  return Object.keys(out).length ? out : null;
}
const HOW = (o) => (o.evoke ? " con Apparire" : o.impending ? " con Imminente" : "");

// dal cimitero con Armonizzare o Flashback: dopo va in esilio
export function exiledAfterCast(s, id, fromZone) {
  if (fromZone !== "graveyard") return false;
  const sc = script(s, id);
  return !!(sc && (sc.other_keywords || []).some((k) => /^(Harmonize|Flashback)\b/.test(k)));
}

export function castCard(s, id, { controller = null, ...opts } = {}) {
  const c = s.cards[id];
  const p = controller ?? c.owner;
  const i = info(s, id);
  const name = displayName(s, id);
  const from = zoneOf(s, id);
  const fromWhere = from && from.zone !== "hand" ? { graveyard: " dal cimitero", exile: " dall'esilio" }[from.zone] || "" : "";
  collect(s, { type: "cast", card: id, controller: p });
  if (i && !i.is_permanent) {
    const toExile = exiledAfterCast(s, id, from && from.zone);
    removeFromZone(s, id);
    s.players[c.owner][toExile ? "exile" : "graveyard"].push(id);
    logPublic(s, p, `${s.players[p].name} lancia ${name}${fromWhere}${toExile ? ", poi va in esilio" : ""}.`, "cast");
    return "spell";
  }
  c.castInfo = castChoices(opts);
  enterBattlefield(s, id, { controller: p, cast: true, how: `${s.players[p].name} lancia ${name}${fromWhere}${HOW(opts)}.` });
  return "permanent";
}

// ---- la pila ------------------------------------------------------------------------------------
// In due giocatori le magie e le abilita' attivate vanno sulla pila. Chi ha "la parola" (s.prio)
// puo' rispondere o lasciar risolvere; quando tutti e due lasciano risolvere di fila si risolve la
// cima: un permanente entra in campo, il resto passa da "si risolve" (s.resolving) e chi lo
// controlla fa gli effetti e tocca Fatto. Bersagli e legalita' restano ai giocatori.
// Oggetto: { sid, kind: "spell" | "ability" | "copy", card, source, abil, controller, name, text }
// la pila con le risposte e' una regola del tavolo: spenta di base, si accende dal menu
export const usesStack = (s) => s.players.length > 1 && !!(s.rules && s.rules.stack);

export function setRule(s, key, on, who) {
  s.rules = { ...(s.rules || {}), [key]: !!on };
  const text = key === "stack" ? (on ? "risposte sulla pila accese: ogni magia aspetta che l'altro la lasci risolvere."
    : "risposte sulla pila spente: le magie si risolvono subito.") : `${key}: ${on ? "sì" : "no"}.`;
  if (who === "host") hostLog(s, text);
  else logPublic(s, who ?? null, `${who != null && s.players[who] ? `${s.players[who].name}: ` : ""}${text[0].toUpperCase()}${text.slice(1)}`, "host");
}

export function stackItem(s, sid) { return (s.stack || []).find((x) => x.sid === sid) || null; }

export function itemName(s, it) {
  if (!it) return "";
  if (it.kind === "spell") return displayName(s, it.card);
  return it.name || "?";
}

export function itemText(s, it) {
  if (!it) return "";
  if (it.kind === "spell") { const i = info(s, it.card); return (i && (i.text_it || i.text)) || ""; }
  return it.text || "";
}

function afterAdd(s, p) { s.prio = usesStack(s) ? { p: 1 - p, passes: 1 } : null; }
function afterResolve(s) { s.prio = (s.stack || []).length ? { p: s.active, passes: 0 } : null; }

// la carta lascia la pila senza risolversi (spostata a mano): via anche l'oggetto
function leaveStack(s, id) {
  const c = s.cards[id];
  if (!c || !c.onStack) return;
  const sid = c.onStack;
  c.onStack = null;
  s.stack = (s.stack || []).filter((x) => x.sid !== sid);
  if (s.resolving === sid) s.resolving = null;
  if (!s.stack.length) s.prio = null;
}

export function castToStack(s, id, { controller = null, ...opts } = {}) {
  const c = s.cards[id];
  if (!c || c.onStack) return null;
  c.castInfo = castChoices(opts);
  const p = controller ?? c.owner;
  const from = zoneOf(s, id);
  const fromWhere = from && from.zone !== "hand" ? { graveyard: " dal cimitero", exile: " dall'esilio", library: " dal grimorio" }[from.zone] || "" : "";
  removeFromZone(s, id);
  s.stack = s.stack || [];
  const sid = `k${++s.seq}`;
  s.stack.push({ sid, kind: "spell", card: id, controller: p, from: from ? from.zone : null });
  c.onStack = sid;
  c.controller = p;
  logPublic(s, p, `${s.players[p].name} lancia ${displayName(s, id)}${fromWhere}${HOW(opts)}: va sulla pila.`, "cast");
  collect(s, { type: "cast", card: id, controller: p });
  afterAdd(s, p);
  return sid;
}

// abilita' attivata: i costi sono gia' pagati, l'effetto aspetta sulla pila
export function abilityToStack(s, src, abil, p) {
  s.stack = s.stack || [];
  const sid = `k${++s.seq}`;
  s.stack.push({ sid, kind: "ability", card: null, source: src, abil, controller: p,
    name: `Abilità di ${displayName(s, src)}`, text: abil.text_it || abil.text || "" });
  afterAdd(s, p);
  return sid;
}

// copia di una magia (preparata, "copia la magia bersaglio"): si risolve e sparisce.
// `ref`: la carta copiata, per usare i suoi effetti (script.spell) quando si risolve
export function copyToStack(s, { name, text, controller, who = null, log = true, ref = null }) {
  s.stack = s.stack || [];
  const sid = `k${++s.seq}`;
  s.stack.push({ sid, kind: "copy", card: null, ref, controller, name: `Copia di ${name}`, text: text || "" });
  const line = `${s.players[controller].name} mette sulla pila una copia di ${name}.`;
  if (log) { if (who === "host") hostLog(s, line); else logPublic(s, controller, line, "cast"); }
  afterAdd(s, controller);
  return sid;
}

export function passPriority(s, p) {
  if (!s.prio || s.prio.p !== p || s.resolving) return null;
  s.prio.passes++;
  if (s.prio.passes >= s.players.length) return resolveTop(s);
  s.prio.p = 1 - p;
  return null;
}

// comincia a risolvere la cima: un permanente entra subito, il resto aspetta "Fatto"
export function resolveTop(s) {
  const st = s.stack || [];
  const top = st[st.length - 1];
  if (!top || s.resolving) return null;
  if (top.kind === "spell" && s.cards[top.card]) {
    const i = info(s, top.card);
    if (i && i.is_permanent) {
      st.pop();
      s.cards[top.card].onStack = null;
      enterBattlefield(s, top.card, { controller: top.controller, cast: true, how: `${displayName(s, top.card)} si risolve ed entra in campo.` });
      afterResolve(s);
      return { sid: top.sid, done: true };
    }
  }
  s.resolving = top.sid;
  s.prio = null;
  logPublic(s, top.controller, `Si risolve ${itemName(s, top)}.`, "prio");
  return { sid: top.sid, done: false };
}

// fine della risoluzione: la magia va al cimitero (o in esilio), copie e abilita' spariscono
export function finishResolve(s, sid, { to = "graveyard" } = {}) {
  if (!sid || s.resolving !== sid) return;
  s.resolving = null;
  const st = s.stack || [];
  const k = st.findIndex((x) => x.sid === sid);
  if (k < 0) { afterResolve(s); return; }
  const [it] = st.splice(k, 1);
  if (it.kind === "spell" && s.cards[it.card]) {
    const c = s.cards[it.card];
    c.onStack = null;
    c.controller = c.owner;
    const exile = to === "exile" || exiledAfterCast(s, it.card, it.from);
    s.players[c.owner][exile ? "exile" : "graveyard"].push(it.card);
    if (exile) logPublic(s, it.controller, `${displayName(s, it.card)} va in esilio.`, "move");
  }
  afterResolve(s);
}

export function counterItem(s, sid, who = "host") {
  const st = s.stack || [];
  const k = st.findIndex((x) => x.sid === sid);
  if (k < 0) return;
  const [it] = st.splice(k, 1);
  if (s.resolving === sid) s.resolving = null;
  const name = itemName(s, it);
  if (it.kind === "spell" && s.cards[it.card]) {
    const c = s.cards[it.card];
    c.onStack = null;
    c.controller = c.owner;
    s.players[c.owner].graveyard.push(it.card);
  }
  note(s, who, `${name} viene contrastata${it.kind === "spell" ? " e va al cimitero" : ""}.`);
  if (!st.length) s.prio = null;
}

export function returnItemToHand(s, sid, who = "host") {
  const st = s.stack || [];
  const it = st.find((x) => x.sid === sid);
  if (!it) return;
  if (it.kind !== "spell") { counterItem(s, sid, who); return; }
  s.stack = st.filter((x) => x.sid !== sid);
  if (s.resolving === sid) s.resolving = null;
  const c = s.cards[it.card];
  c.onStack = null;
  c.controller = c.owner;
  s.players[c.owner].hand.push(it.card);
  note(s, who, `${displayName(s, it.card)} torna in mano a ${s.players[c.owner].name}.`);
  if (!s.stack.length) s.prio = null;
}

export function moveItem(s, sid, dir, who = "host") {
  const st = s.stack || [];
  const k = st.findIndex((x) => x.sid === sid);
  const j = k + (dir === "up" ? 1 : -1);
  if (k < 0 || j < 0 || j >= st.length) return;
  [st[k], st[j]] = [st[j], st[k]];
  note(s, who, `${itemName(s, st[j])} ${dir === "up" ? "sale" : "scende"} nella pila.`);
}

export function givePriority(s, p, who = "host") {
  if (!(s.stack || []).length) return;
  s.prio = { p, passes: 0 };
  note(s, who, `la parola passa a ${s.players[p].name}.`);
}

// la pila si svuota senza risolversi (l'host passa il turno): le magie vanno al cimitero
export function clearStack(s) {
  const st = s.stack || [];
  if (!st.length) { s.prio = null; s.resolving = null; return; }
  for (const it of st) {
    if (it.kind === "spell" && s.cards[it.card]) {
      const c = s.cards[it.card];
      c.onStack = null;
      c.controller = c.owner;
      s.players[c.owner].graveyard.push(it.card);
    }
  }
  logPublic(s, null, `La pila si svuota: ${st.map((x) => itemName(s, x)).join(", ")}.`, "prio");
  s.stack = [];
  s.prio = null;
  s.resolving = null;
}

// lanciare: in due va sulla pila, da soli (prova di velocita') si risolve subito
export function cast(s, id, opts = {}) { return usesStack(s) ? castToStack(s, id, opts) : castCard(s, id, opts); }

// effetti di un istantaneo o di una stregoneria (script.spell, scritti a mano), se ci sono
export function spellOf(s, id) {
  const sc = script(s, id);
  return sc && sc.spell && (sc.spell.do || []).length ? sc.spell : null;
}

// pedina che copia una carta (stesse informazioni e abilita'); `cast`: la copia e' stata lanciata
export function tokenDefOf(s, id) {
  const i = info(s, id) || {};
  const sc = script(s, id) || {};
  return { name: i.name, name_it: i.it || i.name, pt: i.pt || null, loyalty: i.loyalty || null,
    types: [...(i.types || []), ...(i.subtypes || [])].join(" "), copy: true,
    colors: i.colors || "", keywords: sc.keywords || [], triggers: sc.triggers || null,
    abilities: sc.abilities && sc.abilities.length ? sc.abilities : null, text: i.text_it || i.text || "" };
}

// lancia gratis la copia di una carta (Uldaros Theorix): un permanente diventa una pedina,
// un istantaneo o una stregoneria si risolve (sulla pila, se c'e')
export function castCopy(s, id, p, { by = "" } = {}) {
  const i = info(s, id);
  const name = displayName(s, id);
  if (i && i.is_permanent) {
    logPublic(s, p, `${s.players[p].name} lancia una copia di ${name}${by ? ` (${by})` : ""}: diventa una pedina.`, "cast");
    return createTokens(s, p, tokenDefOf(s, id), 1, { cast: true })[0] || null;
  }
  if (usesStack(s)) {
    copyToStack(s, { name, text: (i && (i.text_it || i.text)) || "", controller: p, ref: id });
  } else {
    logPublic(s, p, `${s.players[p].name} lancia una copia di ${name}${by ? ` (${by})` : ""}.`, "cast");
  }
  return null;
}

export function createTokens(s, p, def0, count = 1, { tapped = false, attacking = false, sacAtEnd = false, cast = false } = {}) {
  const made = [];
  // Tesoro, Cibo, Indizio, Mappa, Lander: le loro abilita' le sappiamo noi (Forge non le scrive)
  const extra = !def0.abilities && TOKEN_EXTRAS[def0.name];
  const def = extra ? { ...def0, text: def0.text || extra.text, abilities: extra.abilities } : def0;
  for (let k = 0; k < count; k++) {
    const id = `t${++s.seq}`;
    const sc = { keywords: def.keywords || [] };
    if (def.triggers) sc.triggers = def.triggers;
    if (def.abilities) sc.abilities = def.abilities;
    s.cards[id] = blankCard(id, def.name || "Pedina", p, { info: tokenInfo(def), script: sc });
    made.push(id);
  }
  logPublic(s, p, `${s.players[p].name} crea ${count === 1 ? "una pedina" : `${count} pedine`} ${tokenLabel(def)}${attacking ? ", tappate e attaccanti" : tapped ? ", tappate" : ""}.`, "play");
  for (const id of made) {
    enterBattlefield(s, id, { controller: p, tapped: tapped || attacking, cast });
    const c = s.cards[id];
    if (sacAtEnd) c.sacAtEnd = true;
    if (attacking) {
      c.attacking = true;
      if (s.combat) s.combat.attackers.push(id);
    }
  }
  return made;
}

const TOKEN_IT = { Bat: "Pipistrello", Pest: "Peste", Spirit: "Spirito", Soldier: "Soldato", Cat: "Gatto",
  Treasure: "Tesoro", Food: "Cibo", Clue: "Indizio", Human: "Umano", Zombie: "Zombie", Goblin: "Goblin",
  Elemental: "Elementale", Bird: "Uccello", Rat: "Ratto", Faerie: "Fatato", Wolf: "Lupo", Insect: "Insetto",
  Dragon: "Drago", Knight: "Cavaliere", Warrior: "Guerriero", Squirrel: "Scoiattolo", Rabbit: "Coniglio",
  Fish: "Pesce", Blood: "Sangue", Map: "Mappa", Construct: "Costrutto", Thopter: "Thopter",
  Servo: "Servitore", Shapeshifter: "Mutaforma", Beast: "Bestia", Plant: "Pianta", Saproling: "Saprolingio",
  Treefolk: "Silvantropo", Monk: "Monaco", Otter: "Lontra", Illusion: "Illusione", Gnome: "Gnomo", Robot: "Robot",
  Scorpion: "Scorpione", Lander: "Lander", Jace: "Jace", Monkey: "Scimmia", Frog: "Rana", Mouse: "Topo",
  Lizard: "Lucertola", Detective: "Detective", Golem: "Golem", Horror: "Orrore", Vampire: "Vampiro" };

// tipi doppi e pedine con un nome proprio, come nei testi italiani delle carte
const TOKEN_IT_COMBO = { "Scorpion Dragon": "Drago Scorpione", "Robot Villain": "Nemico Robot" };
const TOKEN_NAMES = { Doombot: "Destinobot" };

function tokenInfo(def) {
  const types = (def.types || "Creature").split(/\s+/);
  const main = types.filter((t) => ["Creature", "Artifact", "Enchantment", "Land", "Planeswalker"].includes(t));
  const sub = types.filter((t) => !main.includes(t));
  const subKey = sub.join(" ");
  const named = def.name && def.name !== subKey && !sub.includes(def.name) && def.name !== "Pedina" && !TOKEN_IT[def.name];
  const itName = def.name_it || (named ? TOKEN_NAMES[def.name] || def.name : TOKEN_IT_COMBO[subKey] || sub.map((t) => TOKEN_IT[t] || t).join(" ")) || def.name;
  const info = { name: def.name || "Pedina", it: itName, types: main, subtypes: sub, pt: def.pt || null,
    colors: def.colors || "", is_land: main.includes("Land"), is_creature: main.includes("Creature"),
    is_permanent: true, text: [((def.keywords || []).map((k) => KW_IT[k] || k).join(", ")), def.text || ""].filter(Boolean).join("\n"),
    loyalty: def.loyalty || null, token: true, cost: "",
    dyn: def.dyn || (/total_artifacts/.test(def.script || "") ? "artifacts" : null) };
  if (def.copy) {                // copia di una carta: il testo e' gia' quello della carta
    info.text = def.text || "";
    info.text_it = info.text;
    return info;
  }
  const extraText = (def.triggers || []).map((t) => t.text_it || t.text).filter(Boolean);
  if (info.dyn === "artifacts" && !def.text) extraText.push("Prende +1/+1 per ogni artefatto che controlli.");
  if (extraText.length) info.text = [info.text, ...extraText].filter(Boolean).join("\n");
  info.text_it = info.text;      // i testi delle pedine li scriviamo gia' in italiano
  return info;
}

export function tokenLabel(def) {
  const i = tokenInfo(def);
  const kw = (def.keywords || []).map((k) => KW_IT[k] || k).join(", ");
  return `${i.it}${def.pt ? ` ${def.pt}` : ""}${kw ? ` con ${kw.toLowerCase()}` : ""}`;
}

export const KW_IT = { Flying: "Volare", Lifelink: "Legame vitale", Vigilance: "Cautela", Deathtouch: "Tocco letale",
  Trample: "Travolgere", Haste: "Rapidità", "First Strike": "Attacco improvviso", "Double Strike": "Doppio attacco",
  Reach: "Raggiungere", Menace: "Minacciare", Defender: "Difensore", Hexproof: "Anti-malocchio",
  Indestructible: "Indistruttibile", Flash: "Lampo", Prowess: "Prodezza", Ward: "Protezione rituale" };

// ---- vite ---------------------------------------------------------------------------------------
// p = 0/1 per i giocatori, "dummy" per l'avversario finto della prova di velocita'
export function changeLife(s, p, delta, { why = "", silent = false } = {}) {
  if (!delta) return;
  if (p === "dummy") {
    s.dummy.life -= Math.max(0, -delta);
    if (!silent) logPublic(s, 0, `L'avversario finto perde ${-delta} ${-delta === 1 ? "vita" : "vite"}${why ? ` ${why}` : ""}: ora ne ha ${s.dummy.life}.`, "life");
    if (s.dummy.life <= 0 && !s.over) finish(s, 0, "vite");
    return;
  }
  const P = s.players[p];
  P.life += delta;
  if (delta > 0) P.gained += delta; else P.lost += -delta;
  if (!silent) {
    const verb = delta > 0 ? "guadagna" : "perde";
    const n = Math.abs(delta);
    logPublic(s, p, `${P.name} ${verb} ${n} ${n === 1 ? "vita" : "vite"}${why ? ` ${why}` : ""}: ora ne ha ${P.life}.`, "life");
  }
  collect(s, { type: delta > 0 ? "gain_life" : "lose_life", player: p, amount: Math.abs(delta) });
}

// ---- tap, segnalini ---------------------------------------------------------------------------
export function setTapped(s, id, tapped) {
  const c = s.cards[id];
  if (!c || c.tapped === tapped) return;
  c.tapped = tapped;
}

export function addCounter(s, id, kind, n) {
  const c = s.cards[id];
  if (!c) return;
  const v = (c.counters[kind] || 0) + n;
  if (v <= 0) delete c.counters[kind]; else c.counters[kind] = v;
  const name = displayName(s, id);
  const label = COUNTER_IT[kind] || kind;
  logPublic(s, c.controller, `${name}: ${n > 0 ? "+" : ""}${n} ${label} (ora ${Math.max(v, 0)}).`, "counter");
}

export const COUNTER_IT = { P1P1: "segnalino +1/+1", M1M1: "segnalino −1/−1", LOYALTY: "fedeltà", LORE: "sapere",
  CHARGE: "carica", OIL: "olio", STUN: "stordimento", SHIELD: "scudo", FINALITY: "finalità", TIME: "tempo",
  QUEST: "missione", NET: "rete", FLYING: "volare", DEATHTOUCH: "tocco letale", LIFELINK: "legame vitale",
  TRAMPLE: "travolgere", FIRST_STRIKE: "attacco improvviso", HEXPROOF: "anti-malocchio", INDESTRUCTIBLE: "indistruttibile",
  REACH: "raggiungere", MENACE: "minacciare", VIGILANCE: "cautela", HASTE: "rapidità" };

// ---- poteri dell'host: tutto si puo' cambiare, e finisce nel diario --------------------------------
// `who`: "host" (riga "Host: ...") oppure il numero del giocatore che lo fa da se'.
// `key`: due modifiche di fila alla stessa cosa aggiornano la stessa riga del diario.
const nm = (s, id) => displayName(s, id);
export function note(s, who, text, key = null) {
  const host = who === "host" || who == null;
  const line = host ? `Host: ${text}` : text;
  const last = s.log[s.log.length - 1];
  if (key && last && last.key === key && last.turn === s.turn) { last.text = line; last.at = Date.now(); return; }
  s.log.push({ turn: s.turn, p: host ? (s.host ?? 0) : who, text: line, kind: host ? "host" : "manual", at: Date.now(), key });
}
export const hostLog = (s, text, key = null) => note(s, "host", text, key);

const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const ptText = (m) => `${sign(m.p)}/${sign(m.t)}`;

// vite messe a mano dall'host (correzione): niente "quando guadagni/perdi vita"
export function setLife(s, p, value, who = "host") {
  const P = s.players[p];
  const v = Math.round(Number(value));
  if (!Number.isFinite(v) || v === P.life) return;
  P.life = v;
  note(s, who, `${P.name} ha ${P.life} ${P.life === 1 ? "vita" : "vite"}.`, `life:${p}`);
}

// Potenzia Jace N: segnalini fedelta' sulla tua pedina Jace; se non c'e', prima la crei
export function empowerJace(s, p, n = 1) {
  let id = s.players[p].battlefield.find((x) => s.cards[x] && s.cards[x].token && s.cards[x].name === "Jace");
  if (!id) [id] = createTokens(s, p, JACE_TOKEN, 1);
  if (id && s.cards[id]) addCounter(s, id, "LOYALTY", n);
  return id;
}

export function changePoison(s, p, d, who = "host") {
  const P = s.players[p];
  P.poison = Math.max(0, (P.poison || 0) + d);
  note(s, who, `${P.name} ha ${P.poison} ${P.poison === 1 ? "segnalino veleno" : "segnalini veleno"}.`, `poison:${p}`);
}

export function setSpeed(s, p, v, who = "host") {
  const P = s.players[p];
  P.speed = Math.max(0, Math.min(4, v));
  note(s, who, `velocità di ${P.name}: ${P.speed}${P.speed === 4 ? " (massima)" : ""}.`, `speed:${p}`);
}

export function addEmblem(s, p, text, who = "host") {
  const P = s.players[p];
  const t = String(text).trim().slice(0, 200);
  if (!t) return;
  P.emblems = [...(P.emblems || []), { id: `e${++s.seq}`, text: t }];
  note(s, who, `${P.name} riceve un emblema: «${t}».`);
}

export function removeEmblem(s, p, eid, who = "host") {
  const P = s.players[p];
  const e = (P.emblems || []).find((x) => x.id === eid);
  if (!e) return;
  P.emblems = P.emblems.filter((x) => x.id !== eid);
  note(s, who, `${P.name} perde l'emblema «${e.text}».`);
}

export function addExtraTurn(s, p, who = "host") {
  const P = s.players[p];
  P.extraTurns = (P.extraTurns || 0) + 1;
  note(s, who, `${P.name} avrà un turno in più${p === s.active ? " dopo questo" : ""}.`);
}

export function setCounter(s, id, kind, n, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  const v = Math.max(0, n);
  if (v > 0) c.counters[kind] = v; else delete c.counters[kind];
  note(s, who, `${nm(s, id)}: ${v} ${COUNTER_IT[kind] || kind}.`, `cnt:${id}:${kind}`);
}

// forza e costituzione: +X/+Y fino a fine turno (eot) o per sempre
export function modPT(s, id, dp, dt, eot = true, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  const key = eot ? "mod" : "pmod";
  const m = c[key] || { p: 0, t: 0 };
  c[key] = { p: m.p + dp, t: m.t + dt };
  if (!c[key].p && !c[key].t) c[key] = null;
  const pw = power(s, id);
  note(s, who, `${nm(s, id)} ${c[key] ? ptText(c[key]) : "+0/+0"} ${eot ? "fino a fine turno" : "per sempre"}${pw ? `: ora è ${pw.p}/${pw.t}` : ""}.`, `pt:${id}:${key}`);
}

export function setBasePT(s, id, pt, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  c.basePt = pt || null;
  const pw = power(s, id);
  note(s, who, pt ? `${nm(s, id)} ha forza e costituzione base ${pt}${pw ? `: ora è ${pw.p}/${pw.t}` : ""}.` : `${nm(s, id)} torna alla forza e costituzione stampata.`);
}

export function clearMods(s, id, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  Object.assign(c, { mod: null, pmod: null, basePt: null, kw: null, kwEot: null, becomes: null });
  note(s, who, `${nm(s, id)} torna com'è stampata: tolte le modifiche a forza, costituzione e abilità.`);
}

export function setKeyword(s, id, kw, on, eot = true, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  const key = eot ? "kwEot" : "kw";
  const m = c[key] ? { add: [...(c[key].add || [])], del: [...(c[key].del || [])] } : { add: [], del: [] };
  m.add = m.add.filter((x) => x !== kw);
  m.del = m.del.filter((x) => x !== kw);
  (on ? m.add : m.del).push(kw);
  c[key] = m;
  note(s, who, `${nm(s, id)} ${on ? "ha" : "perde"} ${(KW_IT[kw] || kw).toLowerCase()} ${eot ? "fino a fine turno" : "per sempre"}.`);
}

export function becomeCreature(s, id, pt, eot = true, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  c.becomes = pt ? { pt, until: eot ? "eot" : "perm" } : null;
  note(s, who, pt ? `${nm(s, id)} diventa una creatura ${pt} ${eot ? "fino a fine turno" : "per sempre"}.` : `${nm(s, id)} smette di essere una creatura.`);
}

export function setFaceDown(s, id, down, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  if (down) {
    note(s, who, `${nm(s, id)} viene girata a faccia in giù: ora è una creatura 2/2 senza nome.`);
    c.faceDown = true;
  } else {
    c.faceDown = false;
    note(s, who, `la carta a faccia in giù viene girata: è ${nm(s, id)}.`);
  }
}

// l'altra faccia di una carta bifronte
export function hasBack(s, id) {
  const c = rec(s, id);
  if (!c || c.token) return false;
  const base = DECKS[c.owner] && DECKS[c.owner].cards[c.name];
  return !!(base && base.layout === "dfc" && base.faces && base.faces[1]);
}

export function transform(s, id, who = "host") {
  const c = s.cards[id];
  if (!c || !hasBack(s, id)) return;
  const before = nm(s, id);
  c.back = !c.back;
  if (isSaga(s, id)) { if (!c.counters.LORE) c.counters.LORE = 1; } else delete c.counters.LORE;
  note(s, who, `${before} si trasforma: ora è ${nm(s, id)}.`);
}

export function attach(s, id, toId, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  c.attachedTo = toId || null;
  note(s, who, toId ? `${nm(s, id)} viene agganciata a ${nm(s, toId)}.` : `${nm(s, id)} viene sganciata.`);
}

// esiliata finche' `holderId` resta in campo: quando lui se ne va, la carta torna da sola
export function linkExile(s, id, holderId, who = "host") {
  const c = s.cards[id];
  if (!c || !s.cards[holderId]) return;
  const name = nm(s, id);
  moveCard(s, id, "exile", { reason: `${who === "host" ? "Host: " : ""}${name} va in esilio finché ${nm(s, holderId)} resta in campo` });
  if (s.cards[id]) s.cards[id].linkedTo = holderId;
}

// carte esiliate da questa, che tornano quando lei se ne va
export function linkedExiles(s, holderId) {
  return s.players.flatMap((P) => P.exile.filter((x) => s.cards[x] && s.cards[x].linkedTo === holderId));
}

// esilio da cui si puo' giocare: turns = 0 (fino a fine turno), 2 (fino alla fine del prossimo turno),
// null (finche' resta li'), false (non piu')
export function setPlayable(s, id, turns, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  c.playable = turns === false ? null : { until: turns == null ? null : s.turn + turns, by: c.playable?.by ?? null };
  note(s, who, turns === false ? `${nm(s, id)} non si può più giocare dall'esilio.`
    : `${nm(s, id)} si può giocare dall'esilio${turns == null ? "" : turns === 0 ? " fino a fine turno" : " fino alla fine del prossimo turno"}.`);
}

// "esilia la prima carta del grimorio: puoi giocarla" (rosso, a ogni turno)
export function exileTopPlayable(s, p, turns = 0, who = "host") {
  const P = s.players[p];
  const id = P.library[0];
  if (!id) return null;
  moveCard(s, id, "exile", { reason: `${who === "host" ? "Host: " : ""}${P.name} esilia la prima carta del grimorio: ${displayName(s, id)}` });
  s.cards[id].playable = { until: turns == null ? null : s.turn + turns, by: p };
  return id;
}

export function exilePlayable(s, p) {
  const out = [];
  for (const P of s.players) {
    for (const id of P.exile) {
      const c = s.cards[id];
      if (c && c.playable && (c.playable.by ?? c.owner) === p) out.push(id);
    }
  }
  return out;
}

export function setPrepared(s, id, on, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  c.prepared = !!on;
  note(s, who, `${nm(s, id)} ${on ? "è preparata" : "non è più preparata"}.`);
}

// "mentre e' preparata puoi lanciare una copia della sua magia": la copia la risolvete a mano
export const PREPARED_SPELL = {
  "Emeritus of Ideation": { name: "Ancestral Recall", it: "Richiamo Ancestrale", text_it: "Un giocatore bersaglio pesca tre carte." },
};
export function castPrepared(s, id) {
  const c = s.cards[id];
  if (!c || !c.prepared) return;
  let base = infoReal(s, id);
  const known = PREPARED_SPELL[(c.copy && c.copy.name) || c.name];
  if (base && !(base.faces && base.faces[1]) && known) base = { ...base, faces: [base, { ...known, text: known.text_it }] };
  const spell = base && base.faces && base.faces[1] ? (base.faces[1].it || base.faces[1].name) : "la sua magia";
  c.prepared = false;
  logPublic(s, c.controller, `${s.players[c.controller].name} lancia una copia di ${spell} da ${nm(s, id)}, che non è più preparata.`, "cast");
  if (usesStack(s)) {
    const f = base && base.faces && base.faces[1];
    copyToStack(s, { name: spell, text: f ? f.text_it || f.text || "" : "", controller: c.controller, log: false });
  }
}

export function setNoUntap(s, id, n, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  c.noUntap = Math.max(0, n);
  note(s, who, n ? `${nm(s, id)} non si stappa al prossimo turno di chi la controlla.` : `${nm(s, id)} si stappa normalmente.`);
}

export function setEndOfTurn(s, id, what, on, who = "host") {
  const c = s.cards[id];
  if (!c) return;
  if (what === "sac") c.sacAtEnd = !!on; else c.exileAtEnd = !!on;
  note(s, who, on ? `${nm(s, id)} ${what === "sac" ? "se ne va (sacrificata) alla fine del turno" : "va in esilio alla fine del turno e si potrà rilanciare"}.`
    : `${nm(s, id)} resta in campo a fine turno.`);
}

export function giveControl(s, id, to, who = "host") {
  const c = s.cards[id];
  const from = zoneOf(s, id);
  if (!c || !from || from.zone !== "battlefield" || from.player === to) return;
  s.players[from.player].battlefield.splice(s.players[from.player].battlefield.indexOf(id), 1);
  s.players[to].battlefield.push(id);
  c.controller = to;
  c.attacking = false; c.blocked = false;
  if (who === "host") hostLog(s, `${s.players[to].name} prende il controllo di ${nm(s, id)}.`);
  else logPublic(s, to, `${s.players[to].name} prende il controllo di ${nm(s, id)}.`, "move");
}

export function setActive(s, p, step = "main", who = "host") {
  s.active = p;
  s.step = step;
  s.combat = null;
  for (const id of Object.keys(s.cards)) { s.cards[id].attacking = false; s.cards[id].blocked = false; }
  if (s.mode === "duo") { s.locked = true; s.viewer = p; s.respond = null; s.backTo = null; }
  note(s, who, step === "start" ? `il turno di ${s.players[p].name} ricomincia da capo.` : `ora gioca ${s.players[p].name}.`);
}

export function cancelCombat(s, who = "host") {
  if (!s.combat) return;
  for (const id of s.combat.attackers) if (s.cards[id]) { s.cards[id].attacking = false; s.cards[id].blocked = false; }
  s.combat = null;
  note(s, who, "il combattimento è annullato.");
}

// ---- turni ---------------------------------------------------------------------------------------
// inizio turno: si stappa tutto, si azzerano i conti del turno, mantenimento e pescata
export function beginTurn(s) {
  const p = s.active;
  const P = s.players[p];
  P.turnsTaken++;
  for (const pl of s.players) { pl.gained = 0; pl.lost = 0; pl.landsThisTurn = 0; }
  let untapped = 0;
  const notes = [];
  for (const id of P.battlefield) {
    const c = s.cards[id];
    if (c.noUntap > 0) {
      c.noUntap--;
      if (c.tapped) notes.push(`${displayName(s, id)} resta tappata`);
      continue;
    }
    if (!c.tapped) continue;
    if (c.counters.STUN > 0) {
      c.counters.STUN--;
      if (!c.counters.STUN) delete c.counters.STUN;
      notes.push(`${displayName(s, id)} perde un segnalino stordimento invece di stapparsi`);
      continue;
    }
    c.tapped = false;
    untapped++;
  }
  logPublic(s, p, `Turno ${s.turn}: tocca a ${P.name}.${untapped ? ` Stappa ${untapped === 1 ? "una carta" : `${untapped} carte`}.` : ""}${notes.length ? ` ${notes.join("; ")}.` : ""}`, "turn");
  collect(s, { type: "upkeep", player: p });
  const skipDraw = s.turn === 1 && p === s.first;
  if (!skipDraw) drawN(s, p, 1);
  collect(s, { type: "draw_step", player: p });
  for (const id of P.battlefield) {
    if (!isSaga(s, id)) continue;
    const c = s.cards[id];
    c.counters.LORE = (c.counters.LORE || 0) + 1;
    logPublic(s, p, `${displayName(s, id)}: capitolo ${ROMAN[c.counters.LORE] || c.counters.LORE}.`, "counter");
  }
  s.step = "main";
}

export function endStep(s) {
  s.step = "end";
  for (const id of s.players[s.active].battlefield) {
    const c = s.cards[id];
    if (!isImpending(c)) continue;
    c.counters.TIME--;
    if (c.counters.TIME > 0) {
      logPublic(s, s.active, `${displayName(s, id)}: tolto un segnalino tempo, ne restano ${c.counters.TIME}.`, "counter");
    } else {
      delete c.counters.TIME;
      c.impending = false;
      logPublic(s, s.active, `${displayName(s, id)}: tolto l'ultimo segnalino tempo, ora è una creatura.`, "counter");
    }
  }
  collect(s, { type: "end_step", player: s.active });
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];

export function passTurn(s) {
  let next = s.mode === "solo" ? 0 : 1 - s.active;
  s.combat = null;
  clearStack(s);
  // fine del turno: le pedine che se ne vanno, l'esilio del warp
  for (const P of s.players) {
    for (const id of [...P.battlefield]) {
      const c = s.cards[id];
      if (!c) continue;
      if (c.sacAtEnd) moveCard(s, id, "graveyard", { sacrificed: true, reason: `${displayName(s, id)} se ne va a fine turno` });
      else if (c.exileAtEnd) {
        moveCard(s, id, "exile", { reason: `${displayName(s, id)} va in esilio a fine turno: si potrà rilanciare` });
        if (s.cards[id]) s.cards[id].playable = { until: null };
      }
    }
  }
  for (const id of Object.keys(s.cards)) {
    const c = s.cards[id];
    c.attacking = false; c.blocked = false; c.mod = null; c.kwEot = null;
    if (c.becomes && c.becomes.until === "eot") c.becomes = null;
    if (c.playable && c.playable.until != null && c.playable.until <= s.turn) c.playable = null;
  }
  const cur = s.players[s.active];
  if (s.mode !== "solo" && cur && cur.extraTurns > 0) {
    cur.extraTurns--;
    next = s.active;
    logPublic(s, s.active, `${cur.name} gioca un turno extra.`, "turn");
  }
  s.turn++;
  s.active = next;
  s.respond = null;
  s.backTo = null;
  if (s.mode === "duo") { s.locked = true; s.viewer = next; }
  s.step = "start";
}

// ---- combattimento -------------------------------------------------------------------------------
export function canAttack(s, id) {
  const c = s.cards[id];
  if (!c || c.controller !== s.active || !hasType(s, id, "Creature") || c.tapped) return false;
  const k = keywords(s, id);
  if (k.has("Defender")) return false;
  return true;
}

export function sick(s, id) {
  const c = s.cards[id];
  return c && c.enteredTurn === s.turn && !keywords(s, id).has("Haste") && hasType(s, id, "Creature");
}

export function declareAttackers(s, ids) {
  const p = s.active;
  s.combat = { attackers: ids.slice(), stage: "blocks" };
  const names = [];
  for (const id of ids) {
    const c = s.cards[id];
    c.attacking = true;
    if (!keywords(s, id).has("Vigilance")) c.tapped = true;
    names.push(displayName(s, id));
  }
  logPublic(s, p, `${s.players[p].name} attacca con ${names.join(", ")}.`, "combat");
  for (const id of ids) collect(s, { type: "attacks", card: id, controller: p });
}

export function combatPreview(s) {
  if (!s.combat) return null;
  let toPlayer = 0;
  let lifelink = 0;
  for (const id of s.combat.attackers) {
    const c = s.cards[id];
    if (!c) continue;
    const pw = power(s, id);
    const p = pw ? Math.max(0, pw.p) : 0;
    const k = keywords(s, id);
    const mult = k.has("Double Strike") ? 2 : 1;
    if (!c.blocked) toPlayer += p * mult;
    if (k.has("Lifelink")) lifelink += p * mult;
  }
  return { toPlayer, lifelink };
}

export function resolveCombat(s, toPlayer, lifelink) {
  const p = s.active;
  const target = s.mode === "solo" ? "dummy" : 1 - p;
  if (toPlayer > 0) changeLife(s, target, -toPlayer, { why: "in combattimento" });
  if (lifelink > 0) changeLife(s, p, lifelink, { why: "con legame vitale" });
  for (const id of s.combat.attackers) {
    if (!s.cards[id]) continue;
    if (!s.cards[id].blocked) collect(s, { type: "combat_damage_player", card: id, controller: p });
    s.cards[id].attacking = false;
    s.cards[id].blocked = false;
  }
  s.combat = null;
}

// ---- mulligan -----------------------------------------------------------------------------------
export function mulligan(s, p) {
  const P = s.players[p];
  P.library = shuffle([...P.library, ...P.hand]);
  P.hand = [];
  P.mulligans++;
  drawN(s, p, HAND_SIZE, { silent: true });
  logPublic(s, p, `${P.name} fa mulligan (${P.mulligans}°).`, "mull");
}

export function keepHand(s, p, bottom = []) {
  const P = s.players[p];
  for (const id of bottom) {
    P.hand.splice(P.hand.indexOf(id), 1);
    P.library.push(id);
  }
  P.kept = true;
  logPublic(s, p, `${P.name} tiene ${P.hand.length} carte.`, "mull");
  const next = s.players.findIndex((x) => !x.kept);
  if (next >= 0) {
    s.mulliganTurn = next;
    s.viewer = next;
    s.locked = true;
  } else {
    s.phase = "play";
    s.active = s.first;
    s.viewer = s.first;
    s.locked = s.mode === "duo";
    s.step = "start";
  }
}

// ---- fine partita -------------------------------------------------------------------------------
export function finish(s, winner, reason) {
  s.over = true;
  s.paused = null;
  s.pauseAsk = null;
  s.prio = null;
  s.resolving = null;
  s.phase = "over";
  s.winner = winner;
  s.reason = reason;
  s.ended_at = new Date().toISOString();
  const w = winner == null ? null : s.players[winner];
  logPublic(s, winner, w ? `${w.name} vince la partita.` : "Partita finita senza vincitore.", "end");
}

export function summary(s) {
  const P = s.players;
  return {
    client_id: s.id, started_at: s.started_at, ended_at: s.ended_at, mode: s.mode,
    p1: { name: P[0].name, deck: P[0].deck, hash: P[0].hash, life: P[0].life, mulligans: P[0].mulligans },
    p2: P[1] ? { name: P[1].name, deck: P[1].deck, hash: P[1].hash, life: P[1].life, mulligans: P[1].mulligans }
      : { name: "Avversario finto", deck: null, life: s.dummy ? s.dummy.life : null },
    first_player: s.mode === "solo" ? 1 : s.first + 1,
    winner: s.winner == null ? null : s.winner + 1,
    reason: s.reason,
    turns: s.mode === "solo" ? P[0].turnsTaken : s.turn,
    match_id: s.match_id, game_no: s.game_no,
    log: s.log.map((l) => ({ turn: l.turn, p: l.p, text: l.text, kind: l.kind })),
  };
}

export { describe };
