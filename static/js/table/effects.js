// Promemoria e "un tocco" dagli script delle carte (formato in decklab/SCRIPTS.md).
// collect() mette in pila le abilita' innescate da un evento; describe() le racconta in
// italiano; applySimple() esegue gli effetti che non chiedono scelte.
import {
  addCounter, changeLife, createTokens, displayName, drawN, exileGraveyard, hasType, info, logPublic, moveCard,
  script, tokenLabel,
} from "./engine.js";

const CHAIN_LIMIT = 80;

export function startChain(s) { s.chain = 0; s.chainWarned = false; }

// ---- raccolta ---------------------------------------------------------------------------------
export function collect(s, ev) {
  if (!s.players || s.over) return;
  s.chain = (s.chain || 0) + 1;
  if (s.chain > CHAIN_LIMIT) {
    if (!s.chainWarned) {
      logPublic(s, null, "Troppi effetti a catena: da qui continuate a mano.", "alert");
      s.chainWarned = true;
    }
    return;
  }
  const sources = [];
  s.players.forEach((P) => sources.push(...P.battlefield));
  // chi lascia il campo puo' ancora innescarsi ("quando muore")
  if ((ev.type === "dies" || ev.type === "sacrificed") && ev.card && !sources.includes(ev.card)) sources.push(ev.card);
  for (const id of sources) {
    const card = s.cards[id];
    const sc = script(s, id);
    if (!card || !sc || !sc.triggers) continue;
    sc.triggers.forEach((t, idx) => {
      if (!t.when || t.when.event === "manual" || t.face === "back") return;
      if (!matches(s, id, t.when, ev)) return;
      if (t.if && !condition(s, id, t.if)) return;          // condizione "se" al momento dell'innesco
      s.pendingSeq = (s.pendingSeq || 0) + 1;
      s.pending.push({ pid: `q${s.pendingSeq}`, source: id, controller: card.controller, tIndex: idx,
        trig: t, ev: { type: ev.type, card: ev.card ?? null, player: ev.player ?? null, amount: ev.amount ?? null } });
    });
  }
}

function typesOf(s, id) {
  const i = info(s, id);
  return (i && i.types) || [];
}

function matches(s, src, when, ev) {
  if (when.any_of) return when.any_of.some((w) => matches(s, src, w, ev));
  if (when.event !== ev.type) return false;
  const ctrl = s.cards[src].controller;
  switch (ev.type) {
    case "enters": case "dies": case "attacks": case "sacrificed": case "cast": case "combat_damage_player": {
      if (when.who === "self" && ev.card !== src) return false;
      if (when.who === "other" && ev.card === src) return false;
      if (when.controller === "you" && ev.controller !== ctrl) return false;
      if (when.controller === "opponent" && ev.controller === ctrl) return false;
      const ts = typesOf(s, ev.card);
      if (when.types && when.types.length && !when.types.some((t) => ts.includes(t))) return false;
      if (when.not_types && when.not_types.some((t) => ts.includes(t))) return false;
      if (when.token === true && !s.cards[ev.card]?.token) return false;
      if (when.token === false && s.cards[ev.card]?.token) return false;
      return true;
    }
    case "gain_life": case "lose_life": {
      const isYou = ev.player === ctrl;
      if (when.player === "you") return isYou;
      if (when.player === "opponent") return !isYou;
      return true;
    }
    case "upkeep": case "draw_step": case "combat_start": case "end_step": {
      if (when.player === "you") return ev.player === ctrl;
      if (when.player === "opponent") return ev.player !== ctrl;
      return true;
    }
    default:
      return false;
  }
}

// tutte le chiavi di `if` devono valere insieme (AND); `text` lo decide il giocatore
export function condition(s, src, cond) {
  if (!cond) return true;
  const card = s.cards[src];
  const P = card ? s.players[card.controller] : null;
  if (cond.life_gained_this_turn && !(P && P.gained >= (cond.life_gained_this_turn.gte ?? 1))) return false;
  if (cond.life_gained_and_lost_this_turn && !(P && P.gained > 0 && P.lost > 0)) return false;
  if (cond.self_unsolved && !(card && !card.solved)) return false;
  // mana speso per lanciarla ("UU", "BB"): lo dice chi la lancia; "cast": e' stata lanciata
  if (cond.spent && !(card && card.spent && card.spent[cond.spent])) return false;
  if (cond.cast && !(card && card.wasCast)) return false;
  return true;
}

function condText(s, src, cond) {
  if (!cond) return "";
  const card = s.cards[src];
  const P = card ? s.players[card.controller] : null;
  const parts = [];
  if (cond.life_gained_this_turn) {
    const n = cond.life_gained_this_turn.gte ?? 1;
    parts.push(n === 1 ? "se ha guadagnato vita in questo turno" : `se ha guadagnato almeno ${n} vite in questo turno (ora ${P ? P.gained : 0})`);
  }
  if (cond.life_gained_and_lost_this_turn) parts.push("se in questo turno ha guadagnato e perso vita");
  if (cond.self_unsolved) parts.push("se il caso non è ancora risolto");
  if (cond.spent) parts.push(`se per lanciarla è stato speso ${cond.spent.split("").map((x) => `{${x}}`).join("")}`);
  if (cond.cast) parts.push("se è stata lanciata");
  if (cond.text) parts.push(`se ${cond.text}`);
  return parts.join(" e ");
}

// ---- racconto in italiano ----------------------------------------------------------------------
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

export function lifeGainedNow(s, p) { return s.players[p] ? s.players[p].gained : 0; }

export function describeEffect(s, src, eff, ctrl) {
  const me = s.players[ctrl] ? s.players[ctrl].name : "";
  const foe = s.mode === "solo" ? "l'avversario finto" : (s.players[1 - ctrl] ? s.players[1 - ctrl].name : "l'avversario");
  const self = src && s.cards[src] ? displayName(s, src) : "";
  let t = "";
  if (eff.gain_life != null) t = `${me} guadagna ${plural(eff.gain_life, "vita", "vite")}`;
  else if (eff.lose_life != null) t = eff.who === "you" ? `${me} perde ${plural(eff.lose_life, "vita", "vite")}` : `${foe} perde ${plural(eff.lose_life, "vita", "vite")}`;
  else if (eff.damage != null) t = eff.to === "opponent" ? `${plural(eff.damage, "danno", "danni")} a ${foe}` : `${plural(eff.damage, "danno", "danni")} a un bersaglio a scelta`;
  else if (eff.draw != null) t = `${me} pesca ${plural(eff.draw, "carta", "carte")}`;
  else if (eff.discard != null) t = `${me} scarta ${plural(eff.discard, "carta", "carte")}`;
  else if (eff.mill != null) t = `${me} mette ${eff.mill === 1 ? "la prima carta" : `le prime ${eff.mill} carte`} del grimorio nel cimitero`;
  else if (eff.surveil != null) t = `sorveglia ${eff.surveil}${eff.regrow_if_mv_lte ? " (se va al cimitero e costa al massimo le vite guadagnate nel turno, va in mano)" : ""}`;
  else if (eff.scry != null) t = `profetizza ${eff.scry}`;
  else if (eff.explore) t = eff.explore === "target" ? "una creatura che controlli esplora" : `${self} esplora`;
  else if (eff.search) t = `${me} cerca una terra base, la mette in campo${eff.search.tapped ? " tappata" : ""} e mescola`;
  else if (eff.token) t = `crea ${eff.token.count > 1 ? `${eff.token.count} pedine` : "una pedina"} ${tokenLabel(eff.token)}`;
  else if (eff.counter) {
    const k = { P1P1: "segnalino +1/+1", M1M1: "segnalino −1/−1", LOYALTY: "segnalino fedeltà" }[eff.counter.kind] || `segnalino ${eff.counter.kind}`;
    const n = eff.counter.n || 1;
    const where = eff.counter.on === "self" ? `su ${self}` : eff.counter.on === "each_yours" ? "su ogni tua creatura" : "su un permanente a scelta";
    t = `${n > 1 ? `${n} ` : ""}${k} ${where}`;
  } else if (eff.return) {
    const r = eff.return;
    const lim = r.mv_lte === "life_gained_this_turn" ? `di valore fino a ${lifeGainedNow(s, ctrl)} (le vite guadagnate nel turno)` : r.mv_lte != null ? `di valore fino a ${r.mv_lte}` : "";
    const what = (r.types || []).includes("Creature") ? "una creatura" : "una carta";
    t = `riporta ${r.to === "hand" ? "in mano" : "in campo"} ${r.up_to ? "fino a " : ""}${what} ${lim} dal cimitero`.replace(/\s+/g, " ");
  } else if (eff.solve) t = `${self} è risolto`;
  else if (eff.hand_discard) t = `${foe} rivela la mano e scarta una carta che scegli tu`;
  else if (eff.bounce) t = "un permanente bersaglio torna in mano al suo proprietario";
  else if (eff.destroy) t = "distruggi un permanente bersaglio";
  else if (eff.tap_stun) t = "TAPpa delle creature e mettici un segnalino stordimento";
  else if (eff.uldaros) t = `esilia carte dal cimitero e lancia gratis le copie (valore totale fino a ${eff.uldaros.mv_total || 6})`;
  else if (eff.modes) t = `scegli uno: ${eff.modes.map((m) => m.label).join("; ")}`;
  else if (eff.pump) t = `una creatura bersaglio prende ${eff.pump.p >= 0 ? "+" : ""}${eff.pump.p}/${eff.pump.t >= 0 ? "+" : ""}${eff.pump.t} fino alla fine del turno`;
  else if (eff.exile) t = "esilia un permanente bersaglio";
  else if (eff.exile_graveyard) t = `${eff.exile_graveyard === "you" ? me : foe} esilia il cimitero`;
  else if (eff.destroy_all) t = `distruggi tutte le creature${eff.destroy_all.mv_lte != null ? ` con valore di mana fino a ${eff.destroy_all.mv_lte}` : ""}`;
  else if (eff.exile_library_but != null) t = `ogni giocatore esilia a faccia in giù il grimorio tranne le ultime ${eff.exile_library_but} carte`;
  else if (eff.note) t = eff.note;
  const c = eff.if ? condText(s, src, eff.if) : "";
  return c ? `${t} (${c})` : t;
}

export function describe(s, item) {
  const t = item.trig;
  const effs = (t.do || []).map((e) => describeEffect(s, item.source, e, item.controller)).filter(Boolean);
  const pre = t.if ? condText(s, item.source, t.if) : "";
  let text = effs.join(", poi ");
  if (!t.auto && t.text_it) text = t.text_it;
  else if (!t.auto && !effs.length) text = t.text || "";
  return { who: displayName(s, item.source), text: pre && t.auto ? `${text} (${pre})` : text,
    manual: !t.auto, full: t.text_it || t.text || "" };
}

// ---- esecuzione ---------------------------------------------------------------------------------
// Effetti che chiedono una scelta: li gestisce la vista con un foglio.
export const INTERACTIVE = ["discard", "surveil", "scry", "explore", "search", "return", "note", "damage_target", "counter_target",
  "hand_discard", "bounce", "destroy", "tap_stun", "uldaros", "modes", "pump", "exile", "destroy_all"];

export function effectKind(eff) {
  if (eff.discard != null) return "discard";
  if (eff.surveil != null) return "surveil";
  if (eff.scry != null) return "scry";
  if (eff.explore) return "explore";
  if (eff.search) return "search";
  if (eff.return) return "return";
  if (eff.note) return "note";
  if (eff.damage != null && eff.to !== "opponent") return "damage_target";
  if (eff.counter && eff.counter.on === "target") return "counter_target";
  if (eff.hand_discard) return "hand_discard";
  if (eff.bounce) return "bounce";
  if (eff.destroy) return "destroy";
  if (eff.tap_stun) return "tap_stun";
  if (eff.uldaros) return "uldaros";
  if (eff.modes) return "modes";
  if (eff.pump) return "pump";
  if (eff.exile) return "exile";
  if (eff.destroy_all) return eff.destroy_all.mv_lte === "X" ? "destroy_all" : "simple";
  return "simple";
}

// esegue un effetto semplice; ritorna false se non e' semplice
export function applySimple(s, src, eff, ctrl) {
  if (eff.if && !condition(s, src, eff.if)) {
    logPublic(s, ctrl, `${displayName(s, src)}: la condizione non c'è, nessun effetto.`, "trigger");
    return true;
  }
  const foe = s.mode === "solo" ? "dummy" : 1 - ctrl;
  const why = src && s.cards[src] ? `per ${displayName(s, src)}` : "";
  if (eff.gain_life != null) { changeLife(s, ctrl, eff.gain_life, { why }); return true; }
  if (eff.lose_life != null) { changeLife(s, eff.who === "you" ? ctrl : foe, -eff.lose_life, { why }); return true; }
  if (eff.damage != null && eff.to === "opponent") { changeLife(s, foe, -eff.damage, { why }); return true; }
  if (eff.draw != null) { drawN(s, ctrl, eff.draw); return true; }
  if (eff.mill != null) {
    const P = s.players[ctrl];
    for (let k = 0; k < eff.mill && P.library.length; k++) moveCard(s, P.library[0], "graveyard", { reason: `${P.name} mette ${displayName(s, P.library[0])} dal grimorio al cimitero` });
    return true;
  }
  if (eff.token) { createTokens(s, ctrl, eff.token, eff.token.count || 1); return true; }
  if (eff.counter && eff.counter.on === "self") { if (s.cards[src]) addCounter(s, src, eff.counter.kind, eff.counter.n || 1); return true; }
  if (eff.counter && eff.counter.on === "each_yours") {
    for (const id of s.players[ctrl].battlefield) if (hasType(s, id, "Creature")) addCounter(s, id, eff.counter.kind, eff.counter.n || 1);
    return true;
  }
  if (eff.solve) {
    if (s.cards[src]) { s.cards[src].solved = true; logPublic(s, ctrl, `${displayName(s, src)} è risolto.`, "trigger"); }
    return true;
  }
  if (eff.exile_library_but != null) { exileLibraryBut(s, eff.exile_library_but, why); return true; }
  if (eff.exile_graveyard) {
    const who = eff.exile_graveyard === "you" ? ctrl : foe;
    if (who !== "dummy") exileGraveyard(s, who);
    return true;
  }
  if (eff.destroy_all && eff.destroy_all.mv_lte !== "X") { destroyAll(s, eff.destroy_all, why); return true; }
  return false;
}

// tutte le creature (con valore di mana fino a mv_lte) vanno al cimitero
export function destroyAll(s, f, why = "") {
  const ids = s.players.flatMap((P) => P.battlefield).filter((id) => (f.types || ["Creature"]).some((t) => hasType(s, id, t))
    && (f.mv_lte == null || ((info(s, id) || {}).mv ?? 0) <= f.mv_lte));
  logPublic(s, null, `${ids.length ? `Distrutte ${ids.length === 1 ? "una creatura" : `${ids.length} creature`}` : "Nessuna creatura da distruggere"}${why ? ` ${why}` : ""}.`, "move");
  for (const id of ids) if (s.cards[id]) moveCard(s, id, "graveyard", { reason: `${displayName(s, id)} viene distrutta` });
  return ids.length;
}

// ogni giocatore esilia a faccia in giu' tutto il grimorio tranne le ultime N carte (nessuno le vede)
export function exileLibraryBut(s, keep, why = "") {
  for (const P of s.players) {
    const n = Math.max(0, P.library.length - keep);
    const gone = P.library.splice(0, n);
    for (const id of gone) {
      s.cards[id].faceDown = true;
      P.exile.push(id);
    }
    logPublic(s, s.players.indexOf(P), `${P.name} esilia a faccia in giù ${n} carte del grimorio${why ? ` ${why}` : ""}: ne restano ${P.library.length}.`, "move");
  }
}
