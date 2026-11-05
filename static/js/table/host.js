// Strumenti dell'host: con la partita in pausa l'host puo' cambiare qualsiasi cosa sul tavolo
// (segnalini, forza, abilita', facce, zone, pedine, turno). Su un telefono solo li usa chi gioca.
// Ogni modifica passa da ctx.commit (si annulla, si sincronizza) e finisce nel diario.
import { aName, cost, esc, openSheet, plural, toast, typeIt } from "../ui.js";
import * as E from "./engine.js";
import { COUNTER_KINDS, KEYWORDS, TOKEN_CATALOG } from "./tokens.js";

const KW_SHORT = { Flying: "vola", Lifelink: "legame", Vigilance: "cautela", Deathtouch: "letale", Trample: "travolge",
  Haste: "rapidità", "First Strike": "att. improvviso", "Double Strike": "doppio att.", Reach: "raggiunge",
  Menace: "minaccia", Hexproof: "anti-malocchio", Indestructible: "indistruttibile", Defender: "difensore",
  Ward: "protezione", Prowess: "prodezza", Flash: "lampo" };

const kwName = (k) => E.KW_IT[k] || k;
const cntName = (k) => (E.COUNTER_IT[k] || k).replace("segnalino ", "");

// ---- per il tavolo: etichette sulle carte e sui giocatori -------------------------------------
export function keywordFlags(s, id) {
  const k = E.keywords(s, id);
  return [...k].filter((x) => KW_SHORT[x] && x !== "Prowess" && x !== "Flash" && x !== "Ward").map((x) => KW_SHORT[x]);
}

// stati in piu' di una carta in campo, in parole brevi (la vista li mette sotto il nome)
export function cardTags(s, id, viewer) {
  const c = s.cards[id];
  if (!c) return [];
  const t = [];
  if (c.faceDown && c.controller === viewer && viewer != null) t.push(`tua: ${E.realName(s, id)}`);
  if (c.attachedTo && s.cards[c.attachedTo]) t.push(`su ${E.shortName(s, c.attachedTo)}`);
  if (c.becomes) t.push(c.becomes.until === "eot" ? "creatura nel turno" : "creatura");
  if (c.copy) { const ri = E.infoReal(s, id); t.push(`copia di ${(ri && ri.copyOf) || c.copy.name}`); }
  if (E.isImpending(c)) t.push(`imminente: ${c.counters.TIME} tempo`);
  if (c.prepared) t.push("preparata");
  if (c.noUntap) t.push("non si stappa");
  if (c.sacAtEnd) t.push("via a fine turno");
  if (c.exileAtEnd) t.push("esilio a fine turno");
  const held = E.linkedExiles(s, id).length;
  if (held) t.push(`tiene ${held} in esilio`);
  return t;
}

export function playerChips(s, p) {
  const P = s.players[p];
  const out = [];
  if (P.poison) out.push(`veleno ${P.poison}`);
  if (P.speed) out.push(`velocità ${P.speed}`);
  if (P.emblems && P.emblems.length) out.push(plural(P.emblems.length, "emblema", "emblemi"));
  if (P.extraTurns) out.push("turno extra");
  return out;
}

// ---- piccoli pezzi di interfaccia -------------------------------------------------------------
function tabsHtml(list, active) {
  return `<div class="htabs" role="tablist">${list.map(([k, label]) => `<button class="htab" role="tab" data-tab="${k}"
    aria-selected="${k === active}">${esc(label)}</button>`).join("")}</div>`;
}

function durationSeg(eot) {
  return `<div class="seg two" role="radiogroup" aria-label="Quanto dura">
    <button class="segb" data-eot="1" aria-pressed="${eot}">Fino a fine turno</button>
    <button class="segb" data-eot="0" aria-pressed="${!eot}">Per sempre</button></div>`;
}

function stepper(label, n, minus, plusKey) {
  return `<div class="stepper hstep"><button class="btn" data-x="${minus}" aria-label="Togli uno: ${esc(label)}">−1</button>
    <span>${esc(label)} <b class="num">${n}</b></span><button class="btn" data-x="${plusKey}" aria-label="Aggiungi uno: ${esc(label)}">+1</button></div>`;
}

const toggleBtn = (x, on, labelOn, labelOff) => `<button class="btn ${on ? "on" : ""}" data-x="${x}" aria-pressed="${on}">${esc(on ? labelOn : labelOff)}</button>`;

function onBattlefield(s, id) {
  const z = s.cards[id] && E.zoneOf(s, id);
  return !!(z && z.zone === "battlefield");
}

// foglio che si ridisegna da solo dopo ogni modifica
function liveSheet(label, render, onClick, { onSubmit = null } = {}) {
  const sh = openSheet("", { label });
  const redraw = () => {
    const html = render();
    if (html == null) { sh.close(); return; }
    const scroll = sh.el.scrollTop;
    sh.body.innerHTML = html;
    sh.el.scrollTop = scroll;
  };
  sh.el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-x],button[data-tab],button[data-eot],button[data-kw],button[data-cnt],button[data-k],button[data-sp]");
    if (!b || !sh.body.contains(b)) return;
    e.preventDefault();
    onClick(b, redraw, sh);
  });
  if (onSubmit) sh.el.addEventListener("submit", (e) => { e.preventDefault(); onSubmit(e.target, redraw, sh); });
  redraw();
  return { ...sh, redraw };
}

// ---- foglio di una carta in campo -------------------------------------------------------------
// schede del foglio di una carta (in una griglia 3x2: tutte visibili senza scorrere)
const CARD_TABS = [["stato", "Stato"], ["segnalini", "Segnalini"], ["forza", "Forza"], ["abilita", "Abilità"], ["forma", "Forma"], ["sposta", "Sposta"]];

export function hostCardSheet(ctx, id, { tab: firstTab = "stato" } = {}) {
  let tab = firstTab;
  let eot = true;
  const who = ctx.who;
  const render = () => {
    const S = ctx.S;
    if (!onBattlefield(S, id)) return null;
    const c = S.cards[id];
    const i = E.info(S, id);
    const pw = E.power(S, id);
    const tags = cardTags(S, id, ctx.me);
    const creatureish = E.hasType(S, id, "Creature") || !!pw;
    const head = `<div class="cs-head"><h2>${esc(E.displayName(S, id))}</h2>${cost(i?.cost)}</div>
      <p class="cs-type">${esc(typeIt(i))}${c.token ? " (pedina)" : ""}${pw ? `, <b>${pw.p}/${pw.t}</b>${`${pw.p}/${pw.t}` !== pw.base ? ` (stampata ${esc(pw.base)})` : ""}` : ""}
        di ${esc(S.players[c.controller].name)}</p>
      ${tags.length ? `<p class="micro">${esc(tags.join(", "))}</p>` : ""}`;
    let body = "";
    if (tab === "stato") {
      body = `<div class="sheet-grid">
        <button class="btn btn-object" data-x="tap">${c.tapped ? "Stappa" : "Tappa"}</button>
        ${toggleBtn("nountap", !!c.noUntap, "Non si stappa al prossimo turno: togli", "Non si stappa al prossimo turno")}
        ${c.attacking ? `<button class="btn" data-x="unattack">Togli dall'attacco</button>
          ${toggleBtn("blocked", !!c.blocked, "Bloccata: togli", "Segna come bloccata")}` : ""}
        ${S.players.length > 1 ? `<button class="btn" data-x="control">Dai il controllo ${esc(aName(S.players[1 - c.controller].name))}</button>` : ""}
        ${toggleBtn("sacend", !!c.sacAtEnd, "Se ne va a fine turno: togli", "Se ne va a fine turno (sacrificata)")}
        ${toggleBtn("exend", !!c.exileAtEnd, "In esilio a fine turno: togli", "In esilio a fine turno, poi si rilancia")}
      </div>`;
    } else if (tab === "segnalini") {
      const have = Object.keys(c.counters).filter((k) => c.counters[k] > 0);
      const rows = [...new Set([...(creatureish ? ["P1P1", "M1M1"] : []), ...have])];
      const free = COUNTER_KINDS.filter((k) => !rows.includes(k));
      body = `<div class="hrows">${rows.map((k) => stepper(cntName(k), c.counters[k] || 0, `cnt-:${k}`, `cnt+:${k}`)).join("") || '<p class="muted">Nessun segnalino.</p>'}</div>
        <h3 class="sheet-h">Aggiungi un segnalino</h3>
        <div class="chips">${free.map((k) => `<button class="chip" data-cnt="${k}">${esc(cntName(k))}</button>`).join("")}</div>
        <p class="micro">I segnalini parola chiave (volare, tocco letale…) danno l'abilità finché ci sono. Lo stordimento si toglie al posto di stappare.</p>`;
    } else if (tab === "forza") {
      const printed = (E.infoReal(S, id) || {}).pt || "";
      body = creatureish ? `${durationSeg(eot)}
        <div class="pt-grid">${[[1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 2], [-2, -2]].map(([a, b]) => `<button class="btn" data-x="pt:${a}:${b}">${a >= 0 ? "+" : "−"}${Math.abs(a)}/${b >= 0 ? "+" : "−"}${Math.abs(b)}</button>`).join("")}</div>
        <form class="inline-form" data-f="base"><label class="field"><span>Forza e costituzione base</span>
          <input type="text" name="pt" maxlength="7" placeholder="es. 0/1" value="${esc(c.basePt || "")}"></label>
          <button class="btn" type="submit">Imposta</button></form>
        ${c.becomes ? `<button class="btn" data-x="unbecome">Non è più una creatura</button>` : ""}
        <button class="btn" data-x="clear">Togli tutte le modifiche</button>
        <p class="micro">Forza e costituzione base: «diventa 0/1», «ha forza e costituzione base 4/4». Segnalini e bonus si sommano sopra.</p>`
        : `<p class="muted">Non è una creatura.</p>
        ${durationSeg(eot)}
        <form class="inline-form" data-f="becomes"><label class="field"><span>Diventa una creatura (veicolo, terra animata…)</span>
          <input type="text" name="pt" maxlength="7" value="${esc(printed || "2/2")}"></label>
          <button class="btn btn-object" type="submit">Diventa creatura</button></form>`;
    } else if (tab === "abilita") {
      const k = E.keywords(S, id);
      body = `${durationSeg(eot)}
        <div class="chips">${KEYWORDS.map((kw) => `<button class="chip ${k.has(kw) ? "on" : ""}" data-kw="${esc(kw)}" aria-pressed="${k.has(kw)}">${esc(kwName(kw))}</button>`).join("")}</div>
        <p class="micro">Tocca per dare o togliere l'abilità ${eot ? "fino a fine turno" : "per sempre"}.</p>`;
    } else if (tab === "forma") {
      const held = E.linkedExiles(S, id);
      const back = E.hasBack(S, id);
      body = `<div class="sheet-grid">
        ${c.faceDown ? `<button class="btn btn-object" data-x="faceup">Gira a faccia in su${c.controller === ctx.me || !ctx.net ? `: è ${esc(E.realName(S, id))}` : ""}</button>`
          : `<button class="btn" data-x="facedown">Gira a faccia in giù (2/2)</button>`}
        ${back && !c.faceDown ? `<button class="btn btn-object" data-x="transform">Trasforma: diventa ${esc(backName(S, id))}</button>` : ""}
        ${toggleBtn("prepared", !!c.prepared, "Preparata: togli", "Segna come preparata")}
        ${c.prepared ? `<button class="btn" data-x="castprep">Lancia la copia della magia</button>` : ""}
      </div>
      <h3 class="sheet-h">Legami</h3>
      <div class="sheet-grid">
        ${c.attachedTo && S.cards[c.attachedTo] ? `<button class="btn" data-x="detach">Sgancia da ${esc(E.shortName(S, c.attachedTo))}</button>`
          : `<button class="btn" data-x="attach">Aggancia a una carta…</button>`}
        <button class="btn" data-x="linkexile">Esilia una carta finché questa resta in campo…</button>
      </div>
      ${held.length ? `<p class="micro">Tiene in esilio: ${esc(held.map((x) => E.displayName(S, x)).join(", "))}. Tornano in campo quando questa se ne va.</p>` : ""}`;
    } else if (tab === "sposta") {
      body = `<div class="sheet-grid">
        <button class="btn" data-x="mv:graveyard">${c.token ? "Rimuovi la pedina" : "Al cimitero"}</button>
        <button class="btn" data-x="sac">Sacrifica</button>
        <button class="btn" data-x="mv:exile">In esilio</button>
        <button class="btn" data-x="flicker">Esce e rientra subito</button>
        ${c.token ? "" : `<button class="btn" data-x="mv:hand">In mano ${esc(aName(S.players[c.owner].name))}</button>
          <button class="btn" data-x="mv:top">In cima al grimorio</button>
          <button class="btn" data-x="mv:bottom">In fondo al grimorio</button>`}
        <button class="btn" data-x="copy">Crea una pedina copia</button>
      </div>`;
    }
    return `<div class="card-sheet host-sheet">${head}${tabsHtml(CARD_TABS, tab)}<div class="htab-body">${body}</div></div>`;
  };

  const act = (fn) => ctx.commit(fn);
  liveSheet("Modifica la carta", render, async (b, redraw, sh) => {
    if (b.dataset.tab) { tab = b.dataset.tab; redraw(); return; }
    if (b.dataset.eot) { eot = b.dataset.eot === "1"; redraw(); return; }
    if (b.dataset.kw) {
      const kw = b.dataset.kw;
      const has = E.keywords(ctx.S, id).has(kw);
      act((st) => E.setKeyword(st, id, kw, !has, eot, who));
      redraw();
      return;
    }
    if (b.dataset.cnt) { const k = b.dataset.cnt; act((st) => E.setCounter(st, id, k, (st.cards[id]?.counters[k] || 0) + 1, who)); redraw(); return; }
    const x = b.dataset.x;
    const S = ctx.S;
    const c = S.cards[id];
    if (!c) { sh.close(); return; }
    if (x.startsWith("cnt")) {
      const [op, k] = x.split(":");
      act((st) => E.setCounter(st, id, k, (st.cards[id]?.counters[k] || 0) + (op === "cnt+" ? 1 : -1), who));
    } else if (x.startsWith("pt:")) {
      const [, a, d] = x.split(":").map(Number);
      act((st) => E.modPT(st, id, a, d, eot, who));
    } else if (x.startsWith("mv:")) {
      const z = x.slice(3);
      sh.close();
      act((st) => {
        if (z === "top" || z === "bottom") E.moveCard(st, id, "library", { pos: z, reason: `Host: ${E.displayName(st, id)} va ${z === "top" ? "in cima" : "in fondo"} al grimorio` });
        else E.moveCard(st, id, z);
      });
      return;
    } else {
      switch (x) {
        case "tap": act((st) => E.setTapped(st, id, !st.cards[id].tapped)); break;
        case "nountap": act((st) => E.setNoUntap(st, id, st.cards[id].noUntap ? 0 : 1, who)); break;
        case "unattack": act((st) => {
          const k = st.cards[id];
          k.attacking = false; k.blocked = false;
          if (st.combat) st.combat.attackers = st.combat.attackers.filter((y) => y !== id);
          E.note(st, who, `${E.displayName(st, id)} non attacca più.`);
        }); break;
        case "blocked": act((st) => { st.cards[id].blocked = !st.cards[id].blocked; E.note(st, who, `${E.displayName(st, id)} ${st.cards[id].blocked ? "è bloccata" : "non è bloccata"}.`); }); break;
        case "control": act((st) => E.giveControl(st, id, 1 - st.cards[id].controller, who)); break;
        case "sacend": act((st) => E.setEndOfTurn(st, id, "sac", !st.cards[id].sacAtEnd, who)); break;
        case "exend": act((st) => E.setEndOfTurn(st, id, "exile", !st.cards[id].exileAtEnd, who)); break;
        case "unbecome": act((st) => E.becomeCreature(st, id, null, eot, who)); break;
        case "clear": act((st) => E.clearMods(st, id, who)); break;
        case "facedown": act((st) => E.setFaceDown(st, id, true, who)); break;
        case "faceup": act((st) => E.setFaceDown(st, id, false, who)); break;
        case "transform": act((st) => E.transform(st, id, who)); break;
        case "prepared": act((st) => E.setPrepared(st, id, !st.cards[id].prepared, who)); break;
        case "castprep": act((st) => E.castPrepared(st, id)); break;
        case "detach": act((st) => E.attach(st, id, null, who)); break;
        case "attach": {
          // un foglio alla volta: chiudo questo, scelgo la carta, poi lo riapro
          const ids = S.players.flatMap((P) => P.battlefield).filter((y) => y !== id);
          sh.close();
          const got = await ctx.pickCards(`Aggancia ${E.displayName(S, id)} a…`, ids, { max: 1, min: 1, okLabel: "Aggancia" });
          if (got && got.length) act((st) => E.attach(st, id, got[0], who));
          hostCardSheet(ctx, id, { tab: "forma" });
          return;
        }
        case "linkexile": {
          const ids = S.players.flatMap((P) => P.battlefield).filter((y) => y !== id);
          sh.close();
          const got = await ctx.pickCards(`Esilia finché ${E.displayName(S, id)} resta in campo`, ids, { max: 1, min: 1, okLabel: "Esilia" });
          if (got && got.length) act((st) => E.linkExile(st, got[0], id, who));
          hostCardSheet(ctx, id, { tab: "forma" });
          return;
        }
        case "sac": sh.close(); act((st) => { const ctl = st.cards[id].controller; E.moveCard(st, id, "graveyard", { sacrificed: true, reason: `${st.players[ctl].name} sacrifica ${E.displayName(st, id)}` }); }); return;
        case "flicker": sh.close(); act((st) => {
          const owner = st.cards[id].owner;
          const name = E.displayName(st, id);
          const token = !!st.cards[id].token;
          E.moveCard(st, id, "exile", { reason: `${name} esce dal campo` });
          if (!token && st.cards[id]) E.enterBattlefield(st, id, { controller: owner, how: `${name} rientra in campo.` });
        }); return;
        case "copy": sh.close(); ctx.tokenCopy(id); return;
        default: return;
      }
    }
    redraw();
  }, {
    onSubmit: (f, redraw) => {
      const pt = normPT(f.pt && f.pt.value);
      if (f.dataset.f === "base") {
        if (f.pt.value.trim() && !pt) { toast("Scrivi forza/costituzione così: 2/3."); return; }
        ctx.commit((st) => E.setBasePT(st, id, pt, who));
      }
      if (f.dataset.f === "becomes") {
        if (!pt) { toast("Scrivi forza/costituzione così: 2/3."); return; }
        ctx.commit((st) => E.becomeCreature(st, id, pt, eot, who));
      }
      redraw();
    },
  });
}

function backName(s, id) {
  const c = s.cards[id];
  const base = E.getDecks()[c.owner].cards[c.name];
  const f = c.back ? base.faces[0] : base.faces[1];
  return (f && (f.it || f.name)) || "l'altra faccia";
}

export function normPT(v) {
  const m = String(v || "").trim().replace(/\s+/g, "").match(/^([+-]?\d{1,2}|\*)\/([+-]?\d{1,2}|\*)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// ---- foglio di un giocatore -------------------------------------------------------------------
export function hostPlayerSheet(ctx, p) {
  const who = ctx.who;
  const render = () => {
    const S = ctx.S;
    const P = S.players[p];
    const hidden = ctx.net ? p !== ctx.me : p !== S.viewer;
    return `<div class="host-sheet">
      <h2>${esc(P.name)}</h2>
      <h3 class="sheet-h">Vite</h3>
      <p class="life-big num">${P.life}</p>
      <div class="life-steps"><button class="btn btn-big" data-x="life:-5">−5</button><button class="btn btn-big" data-x="life:-1">−1</button>
        <button class="btn btn-big" data-x="life:1">+1</button><button class="btn btn-big" data-x="life:5">+5</button></div>
      <form class="inline-form" data-f="life"><label class="field"><span>Metti le vite a</span><input name="v" type="number" inputmode="numeric" value="${P.life}"></label>
        <button class="btn" type="submit">Imposta</button></form>
      <p class="micro">Correzione dell'host: non conta come guadagnare o perdere vita.</p>
      <h3 class="sheet-h">Veleno</h3>
      ${stepper("segnalini veleno", P.poison || 0, "poison:-1", "poison:1")}
      <p class="micro">Con 10 segnalini veleno si perde la partita.</p>
      <h3 class="sheet-h">Velocità</h3>
      <div class="seg five">${[0, 1, 2, 3, 4].map((v) => `<button class="segb" data-x="speed:${v}" aria-pressed="${(P.speed || 0) === v}">${v}</button>`).join("")}</div>
      <p class="micro">Sale di 1 al massimo una volta per turno, quando un avversario perde vita nel tuo turno. 4 è il massimo.</p>
      <h3 class="sheet-h">Emblemi</h3>
      <ul class="emblems">${(P.emblems || []).map((e) => `<li><span>${esc(e.text)}</span><button class="btn small-btn" data-x="unemblem:${esc(e.id)}">Togli</button></li>`).join("") || '<li class="muted">Nessun emblema.</li>'}</ul>
      <form class="inline-form" data-f="emblem"><label class="field"><span>Nuovo emblema</span><input type="text" name="t" maxlength="200" placeholder="es. Le creature che controlli hanno +1/+1"></label>
        <button class="btn" type="submit">Aggiungi</button></form>
      <h3 class="sheet-h">Mano e grimorio</h3>
      <div class="sheet-grid">
        <button class="btn" data-x="draw">Pesca una carta</button>
        <button class="btn" data-x="mill">Macina una carta</button>
        <button class="btn" data-x="shuffle">Mescola il grimorio</button>
        ${hidden ? `<button class="btn" data-x="randdisc">Scarta a caso</button>
          <button class="btn" data-x="reveal">Rivela la mano e scegline una</button>` : `<button class="btn" data-x="hand">Apri la mano</button>`}
      </div>
      <h3 class="sheet-h">La prima carta del grimorio</h3>
      <div class="sheet-grid">
        <button class="btn" data-x="impulse:0">In esilio, si gioca in questo turno</button>
        <button class="btn" data-x="impulse:2">In esilio, si gioca fino al prossimo turno</button>
        <button class="btn" data-x="manifest">In campo a faccia in giù (2/2)</button>
      </div>
      <h3 class="sheet-h">Turni</h3>
      <div class="sheet-grid">
        <button class="btn" data-x="extra">Un turno in più${P.extraTurns ? ` (ora ${P.extraTurns})` : ""}</button>
      </div></div>`;
  };
  liveSheet(`Giocatore: ${ctx.S.players[p].name}`, render, async (b, redraw, sh) => {
    const x = b.dataset.x;
    if (!x) return;
    const [k, v] = x.split(":");
    const S = ctx.S;
    const P = S.players[p];
    if (k === "life") ctx.commit((st) => E.setLife(st, p, st.players[p].life + Number(v), who));
    else if (k === "poison") ctx.commit((st) => E.changePoison(st, p, Number(v), who));
    else if (k === "speed") ctx.commit((st) => E.setSpeed(st, p, Number(v), who));
    else if (k === "unemblem") ctx.commit((st) => E.removeEmblem(st, p, v, who));
    else if (k === "draw") ctx.commit((st) => E.drawN(st, p, 1));
    else if (k === "mill") ctx.commit((st) => { const id = st.players[p].library[0]; if (id) E.moveCard(st, id, "graveyard", { reason: `${st.players[p].name} mette ${E.displayName(st, id)} dal grimorio al cimitero` }); });
    else if (k === "shuffle") ctx.commit((st) => E.shuffleLibrary(st, p));
    else if (k === "extra") ctx.commit((st) => E.addExtraTurn(st, p, who));
    else if (k === "impulse") ctx.commit((st) => { if (!E.exileTopPlayable(st, p, Number(v), who)) toast("Il grimorio è vuoto."); });
    else if (k === "manifest") ctx.commit((st) => { const id = st.players[p].library[0]; if (id) E.putFaceDown(st, id, { controller: p, how: `${who === "host" ? "Host: " : ""}la prima carta del grimorio di ${st.players[p].name} va in campo a faccia in giù (2/2).` }); });
    else if (k === "randdisc") {
      if (!P.hand.length) { toast(`${P.name} non ha carte in mano.`); return; }
      const pickId = P.hand[Math.floor(Math.random() * P.hand.length)];
      ctx.commit((st) => { if (st.players[p].hand.includes(pickId)) E.moveCard(st, pickId, "graveyard", { reason: `${st.players[p].name} scarta a caso ${E.displayName(st, pickId)}` }); });
    } else if (k === "reveal") {
      if (!P.hand.length) { toast(`${P.name} non ha carte in mano.`); return; }
      const names = P.hand.map((id) => E.displayName(S, id)).join(", ");
      ctx.commit((st) => E.logPublic(st, p, `${st.players[p].name} rivela la mano: ${names}.`, "reveal"));
      sh.close();
      const got = await ctx.pickCards(`Mano di ${P.name}`, P.hand.slice(), { note: "Scegli la carta da scartare, o chiudi.", max: 1, min: 0, okLabel: "Scarta" });
      if (got && got.length) ctx.commit((st) => { if (st.players[p].hand.includes(got[0])) E.moveCard(st, got[0], "graveyard", { reason: `${st.players[p].name} scarta ${E.displayName(st, got[0])}` }); });
      hostPlayerSheet(ctx, p);
      return;
    } else if (k === "hand") { sh.close(); ctx.openHand(); return; }
    redraw();
  }, {
    onSubmit: (f, redraw) => {
      if (f.dataset.f === "life") {
        const v = Number(f.v.value);
        if (!Number.isFinite(v) || f.v.value === "") { toast("Scrivi un numero."); return; }
        ctx.commit((st) => E.setLife(st, p, v, who));
      }
      if (f.dataset.f === "emblem") {
        const t = f.t.value.trim();
        if (!t) { toast("Scrivi il testo dell'emblema."); return; }
        ctx.commit((st) => E.addEmblem(st, p, t, who));
      }
      redraw();
    },
  });
}

// ---- zone (cimitero, esilio, grimorio, mano) ---------------------------------------------------
export function hostZoneSheet(ctx, p, z) {
  const S = ctx.S;
  const P = S.players[p];
  const who = ctx.who;
  const hidden = ctx.net ? p !== ctx.me : p !== S.viewer;
  if (z === "library" || (z === "hand" && hidden)) { hostPlayerSheet(ctx, p); return; }
  if (z === "hand") { ctx.openHand(); return; }
  const label = z === "graveyard" ? "Cimitero" : "Esilio";
  const ids = P[z].slice().reverse();
  const sh = openSheet(`<div class="host-sheet"><h2>${label} di ${esc(P.name)} <span class="muted num">${ids.length}</span></h2>
    <p class="micro">Tocca una carta per spostarla.${z === "exile" ? " Le carte «giocabili» si vedono nella mano di chi può giocarle." : ""}</p>
    <div class="hand-grid">${ids.map((id) => `<div class="hz-wrap">${ctx.handCard(id, { act: "hz" })}${z === "exile" && S.cards[id].playable ? '<span class="hz-tag">giocabile</span>' : ""}${S.cards[id].linkedTo ? '<span class="hz-tag">torna</span>' : ""}</div>`).join("") || '<p class="muted">Vuoto.</p>'}</div></div>`, { label });
  sh.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act=hz]");
    if (!b) return;
    e.stopPropagation();
    const id = b.dataset.id;
    sh.close();
    const st0 = ctx.S;
    const c = st0.cards[id];
    const other = st0.players.length > 1 ? 1 - c.owner : null;
    const opts = [
      { value: "hand", label: `In mano ${aName(st0.players[c.owner].name)}` },
      { value: "bf", label: `In campo (di ${st0.players[c.owner].name})` },
      ...(other != null ? [{ value: "bfo", label: `In campo sotto il controllo di ${st0.players[other].name}` }] : []),
      { value: "bftap", label: "In campo tappata" },
      ...(E.hasBack(st0, id) ? [{ value: "bfback", label: "In campo dall'altra faccia" }] : []),
      { value: "bfdown", label: "In campo a faccia in giù (2/2)" },
      { value: "cast", label: (ctx.me ?? c.owner) === c.owner ? "Lanciala da qui" : `Lanciala: la lancia ${st0.players[ctx.me].name}` },
      { value: "top", label: "In cima al grimorio" },
      { value: "bottom", label: "In fondo al grimorio" },
      z === "graveyard" ? { value: "exile", label: "In esilio" } : { value: "grave", label: "Al cimitero" },
    ];
    if (z === "exile") {
      opts.push({ value: "pl0", label: "Si può giocare fino a fine turno" }, { value: "pl2", label: "Si può giocare fino alla fine del prossimo turno" },
        { value: "plinf", label: "Si può giocare finché resta in esilio" });
      if (c.playable) opts.push({ value: "plno", label: "Non si può più giocare" });
    }
    const i = E.info(st0, id);
    const ans = await ctx.pick(E.displayName(st0, id), opts, i ? (i.text_it || i.text || "").slice(0, 300) : "");
    if (!ans) return;
    const caster = ctx.me ?? c.owner;
    ctx.commit((st) => {
      if (!st.cards[id]) return;
      const owner = st.cards[id].owner;
      const name = E.displayName(st, id);
      const from = z === "graveyard" ? "dal cimitero" : "dall'esilio";
      const H = who === "host" ? "Host: " : "";
      if (ans === "hand") E.moveCard(st, id, "hand", { reason: `${H}${name} torna ${from} in mano ${aName(st.players[owner].name)}` });
      if (ans === "bf" || ans === "bftap") E.enterBattlefield(st, id, { controller: owner, tapped: ans === "bftap", how: `${H}${name} va in campo ${from}${ans === "bftap" ? ", tappata" : ""}.` });
      if (ans === "bfo") E.enterBattlefield(st, id, { controller: 1 - owner, how: `${H}${name} va in campo ${from} sotto il controllo di ${st.players[1 - owner].name}.` });
      if (ans === "bfback") { st.cards[id].back = true; E.enterBattlefield(st, id, { controller: owner, how: `${H}${E.displayName(st, id)} va in campo ${from}, dall'altra faccia.` }); }
      if (ans === "bfdown") E.putFaceDown(st, id, { controller: owner, how: `${H}una carta va in campo ${from} a faccia in giù (2/2).` });
      if (ans === "cast") E.cast(st, id, { controller: caster });
      if (ans === "top" || ans === "bottom") E.moveCard(st, id, "library", { pos: ans, reason: `${H}${name} va ${ans === "top" ? "in cima" : "in fondo"} al grimorio` });
      if (ans === "exile") E.moveCard(st, id, "exile");
      if (ans === "grave") E.moveCard(st, id, "graveyard");
      if (ans === "pl0") E.setPlayable(st, id, 0, who);
      if (ans === "pl2") E.setPlayable(st, id, 2, who);
      if (ans === "plinf") E.setPlayable(st, id, null, who);
      if (ans === "plno") E.setPlayable(st, id, false, who);
    });
  });
}

// ---- pedine ------------------------------------------------------------------------------------
// pedine che creano le carte dei mazzi in gioco (dagli script)
export function deckTokens() {
  const seen = new Map();
  for (const d of E.getDecks()) {
    for (const sc of Object.values(d.scripts || {})) {
      const scan = (effs) => (effs || []).forEach((e) => { if (e.token) seen.set(E.tokenLabel(e.token), e.token); });
      (sc.triggers || []).forEach((t) => scan(t.do));
      (sc.abilities || []).forEach((a) => scan(a.do));
    }
  }
  return [...seen.entries()].map(([label, def]) => ({ label, def }));
}

export function tokenSheet(ctx) {
  const S0 = ctx.S;
  const opts = { forP: S0.viewer ?? 0, n: 1, tapped: false, attacking: false, sacAtEnd: false };
  const fromDecks = deckTokens();
  const deckLabels = new Set(fromDecks.map((x) => x.label));
  const catalog = TOKEN_CATALOG.map((g) => ({ group: g.group, items: g.items.filter((d) => !deckLabels.has(E.tokenLabel(d))) }))
    .filter((g) => g.items.length);
  const all = [...fromDecks.map((x) => x.def), ...catalog.flatMap((g) => g.items)];
  const customKw = new Set();
  const itemBtn = (def, k) => `<button class="btn tok-btn" data-k="${k}"><span>${esc(E.tokenLabel(def))}</span>${def.note ? `<small>${esc(def.note)}</small>` : ""}</button>`;
  const render = () => {
    const S = ctx.S;
    const many = S.players.length > 1;
    let k = 0;
    const deckPart = fromDecks.length ? `<h3 class="sheet-h">Dalle carte dei vostri mazzi</h3><div class="tok-list">${fromDecks.map((x) => itemBtn(x.def, k++)).join("")}</div>` : "";
    const catPart = catalog.map((g) => `<h3 class="sheet-h">${esc(g.group)}</h3><div class="tok-list">${g.items.map((d) => itemBtn(d, k++)).join("")}</div>`).join("");
    return `<div class="host-sheet"><h2>Crea una pedina</h2>
      <div class="tok-opts">
        ${many ? `<div class="seg two">${S.players.map((P, i) => `<button class="segb" data-sp="for:${i}" aria-pressed="${opts.forP === i}">Per ${esc(P.name)}</button>`).join("")}</div>` : ""}
        ${stepper("quante", opts.n, "n-", "n+")}
        <div class="chips">
          <button class="chip ${opts.tapped ? "on" : ""}" data-sp="tapped" aria-pressed="${opts.tapped}">Tappate</button>
          ${S.combat ? `<button class="chip ${opts.attacking ? "on" : ""}" data-sp="attacking" aria-pressed="${opts.attacking}">Attaccanti</button>` : ""}
          <button class="chip ${opts.sacAtEnd ? "on" : ""}" data-sp="sacAtEnd" aria-pressed="${opts.sacAtEnd}">Se ne vanno a fine turno</button>
        </div>
      </div>
      ${deckPart}${catPart}
      <h3 class="sheet-h">Un'altra pedina</h3>
      <form class="stack-form" data-f="custom">
        <div class="calc-row">
          <label class="field"><span>Nome</span><input type="text" name="name" value="Spirito" maxlength="30"></label>
          <label class="field"><span>Forza/costituzione</span><input type="text" name="pt" value="1/1" maxlength="7"></label>
        </div>
        <label class="check"><input type="checkbox" name="art"> È un artefatto</label>
        <div class="chips">${KEYWORDS.slice(0, 11).map((kw) => `<button type="button" class="chip ${customKw.has(kw) ? "on" : ""}" data-kw="${esc(kw)}" aria-pressed="${customKw.has(kw)}">${esc(kwName(kw))}</button>`).join("")}</div>
        <label class="field"><span>Testo (facoltativo)</span><input type="text" name="text" maxlength="160" placeholder="es. Quando muore, guadagni 1 vita"></label>
        <button class="btn btn-object btn-big" type="submit">Crea</button>
      </form></div>`;
  };
  const make = (def) => {
    const o = { ...opts, ...(def.opts || {}) };
    const forP = o.forP;
    const n = Math.max(1, Math.min(20, o.n));
    if (def.special === "jace") { ctx.commit((st) => E.empowerJace(st, forP, n)); return; }
    ctx.commit((st) => E.createTokens(st, forP, def, n * (def.count || 1), { tapped: o.tapped, attacking: o.attacking && !!st.combat, sacAtEnd: o.sacAtEnd }));
  };
  liveSheet("Crea una pedina", render, (b, redraw, sh) => {
    if (b.dataset.sp) {
      const [k, v] = b.dataset.sp.split(":");
      if (k === "for") opts.forP = Number(v); else opts[k] = !opts[k];
      redraw();
      return;
    }
    if (b.dataset.kw) { const kw = b.dataset.kw; if (customKw.has(kw)) customKw.delete(kw); else customKw.add(kw); redraw(); return; }
    if (b.dataset.x === "n-" || b.dataset.x === "n+") { opts.n = Math.max(1, Math.min(20, opts.n + (b.dataset.x === "n+" ? 1 : -1))); redraw(); return; }
    if (b.dataset.k != null) { sh.close(); make(all[Number(b.dataset.k)]); }
  }, {
    onSubmit: (f, redraw, sh) => {
      const name = f.name.value.trim() || "Pedina";
      const pt = normPT(f.pt.value);
      if (f.pt.value.trim() && !pt) { toast("Scrivi forza/costituzione così: 2/3."); return; }
      sh.close();
      make({ name, name_it: name, pt, types: `${f.art.checked ? "Artifact " : ""}${pt ? "Creature" : ""}`.trim() || "Artifact",
        keywords: [...customKw], text: f.text.value.trim() });
    },
  });
}

// ---- turno ---------------------------------------------------------------------------------------
export function turnSheet(ctx) {
  const who = ctx.who;
  const render = () => {
    const S = ctx.S;
    const A = S.players[S.active];
    const solo = S.players.length === 1;
    const step = S.combat ? "combattimento" : S.step === "end" ? "fine del turno" : "fase principale";
    return `<div class="host-sheet"><h2>Turno ${S.turn}</h2>
      <p class="muted">Tocca ${esc(aName(A.name))}, ${step}.</p>
      <div class="sheet-grid">
        <button class="btn btn-object" data-x="pass">Passa il turno adesso</button>
        ${S.step !== "end" ? `<button class="btn" data-x="endstep">Vai alla fine del turno</button>` : ""}
        ${S.combat ? `<button class="btn" data-x="nocombat">Annulla il combattimento</button>` : ""}
      </div>
      ${S.players.map((P, i) => `<h3 class="sheet-h">${esc(P.name)}${i === S.active ? " (di turno)" : ""}</h3>
        <div class="sheet-grid">
          ${solo || i === S.active ? "" : `<button class="btn" data-x="give:${i}">Dagli il turno</button>`}
          <button class="btn" data-x="restart:${i}">Ricomincia il suo turno</button>
          ${solo ? "" : `<button class="btn" data-x="extra:${i}">Un turno in più${P.extraTurns ? ` (ora ${P.extraTurns})` : ""}</button>`}
        </div>`).join("")}
      <p class="micro" style="margin-top:12px">«Dagli il turno»: tocca a lui da subito, senza stappare né pescare. «Ricomincia»: stappa, mantenimento e pescata da capo.</p>
      </div>`;
  };
  liveSheet("Turno", render, (b, redraw, sh) => {
    const [x, v] = (b.dataset.x || "").split(":");
    const p = Number(v);
    if (x === "pass") { sh.close(); ctx.commit((st) => { st.pending = []; E.note(st, who, `${st.players[st.active].name} passa il turno.`); E.passTurn(st); }); return; }
    if (x === "endstep") { sh.close(); ctx.commit((st) => E.endStep(st)); return; }
    if (x === "nocombat") ctx.commit((st) => E.cancelCombat(st, who));
    if (x === "give") { sh.close(); ctx.commit((st) => E.setActive(st, p, "main", who)); return; }
    if (x === "restart") { sh.close(); ctx.commit((st) => { st.pending = []; E.setActive(st, p, "start", who); }); return; }
    if (x === "extra") ctx.commit((st) => E.addExtraTurn(st, p, who));
    redraw();
  });
}

// ---- pila ----------------------------------------------------------------------------------------
export function hostStackSheet(ctx, sid) {
  const who = ctx.who;
  const render = () => {
    const S = ctx.S;
    const it = E.stackItem(S, sid);
    if (!it) return null;
    const st = S.stack || [];
    const k = st.findIndex((x) => x.sid === sid);
    const top = k === st.length - 1;
    const i = it.kind === "spell" ? E.info(S, it.card) : null;
    return `<div class="card-sheet host-sheet">
      <div class="cs-head"><h2>${esc(E.itemName(S, it))}</h2>${i ? cost(i.cost) : ""}</div>
      <p class="cs-type">${it.kind === "spell" ? esc(typeIt(i)) : it.kind === "copy" ? "Copia di una magia" : "Abilità"}, di ${esc(S.players[it.controller].name)}${top ? ", in cima" : `, ${st.length - k}ª dalla cima`}</p>
      <div class="cs-text">${esc(E.itemText(S, it)).replace(/\n/g, "<br>") || "<em>Nessun testo</em>"}</div>
      <div class="sheet-grid">
        ${top && !S.resolving ? `<button class="btn btn-object" data-x="resolve">Risolvila adesso</button>` : ""}
        <button class="btn" data-x="counter">Contrastala</button>
        ${it.kind === "spell" ? `<button class="btn" data-x="hand">Torna in mano</button>` : ""}
        <button class="btn" data-x="copy">Copiala sulla pila</button>
        ${k < st.length - 1 ? `<button class="btn" data-x="up">Sposta su</button>` : ""}
        ${k > 0 ? `<button class="btn" data-x="down">Sposta giù</button>` : ""}
        ${S.players.length > 1 ? S.players.map((P, p) => `<button class="btn" data-x="prio:${p}">Dai la parola ${esc(aName(P.name))}</button>`).join("") : ""}
      </div></div>`;
  };
  liveSheet("Pila", render, (b, redraw, sh) => {
    const [x, v] = (b.dataset.x || "").split(":");
    const S = ctx.S;
    const it = E.stackItem(S, sid);
    if (!it) { sh.close(); return; }
    if (x === "resolve") { sh.close(); ctx.commit((st) => { if (!st.resolving) { E.note(st, who, `${E.itemName(st, it)} si risolve.`); E.resolveTop(st); } }); return; }
    if (x === "counter") { sh.close(); ctx.commit((st) => E.counterItem(st, sid, who)); return; }
    if (x === "hand") { sh.close(); ctx.commit((st) => E.returnItemToHand(st, sid, who)); return; }
    if (x === "copy") ctx.commit((st) => E.copyToStack(st, { name: E.itemName(st, it), text: E.itemText(st, it), controller: it.controller, who }));
    if (x === "up" || x === "down") ctx.commit((st) => E.moveItem(st, sid, x, who));
    if (x === "prio") ctx.commit((st) => E.givePriority(st, Number(v), who));
    redraw();
  });
}

// ---- menu principale ------------------------------------------------------------------------------
export function hostTools(ctx) {
  const S = ctx.S;
  const net = ctx.net;
  const sh = openSheet(`<div class="host-sheet"><h2>${net ? "Strumenti dell'host" : "Strumenti"}</h2>
    <p class="micro">Tocca una carta, una vita o una zona sul tavolo per cambiarla. Qui c'è il resto. Ogni cosa finisce nel diario e si può annullare.</p>
    <h3 class="sheet-h">Giocatori</h3>
    <div class="sheet-grid">${S.players.map((P, i) => `<button class="btn" data-x="player:${i}">${esc(P.name)}: vite, veleno, emblemi</button>`).join("")}</div>
    <h3 class="sheet-h">Zone</h3>
    <div class="zone-grid">${S.players.map((P, i) => `<div class="zone-col"><span class="micro">${esc(P.name)}</span>
      <button class="btn" data-x="zone:${i}:hand">Mano <b class="num">${P.hand.length}</b></button>
      <button class="btn" data-x="zone:${i}:library">Grimorio <b class="num">${P.library.length}</b></button>
      <button class="btn" data-x="zone:${i}:graveyard">Cimitero <b class="num">${P.graveyard.length}</b></button>
      <button class="btn" data-x="zone:${i}:exile">Esilio <b class="num">${P.exile.length}</b></button></div>`).join("")}</div>
    ${(S.stack || []).length ? `<h3 class="sheet-h">Pila</h3>
    <div class="sheet-grid">${S.stack.slice().reverse().map((it) => `<button class="btn" data-x="stack:${esc(it.sid)}">${esc(E.itemName(S, it))} <span class="muted">(${esc(S.players[it.controller].name)})</span></button>`).join("")}</div>` : ""}
    <h3 class="sheet-h">Tavolo</h3>
    <div class="sheet-grid">
      <button class="btn" data-x="token">Crea una pedina</button>
      <button class="btn" data-x="turn">Turno e fasi</button>
      <button class="btn" data-x="coin">Lancia una moneta</button>
      <button class="btn" data-x="die">Tira un dado</button>
      ${net && S.players.length > 1 ? `<button class="btn" data-x="handover">Passa il ruolo di host ${esc(aName(S.players[1 - (S.host ?? 0)].name))}</button>` : ""}
      <button class="btn" data-x="end">Fine partita: scegli il vincitore</button>
    </div></div>`, { label: "Strumenti" });
  sh.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    const [x, a, z] = b.dataset.x.split(":");
    sh.close();
    if (x === "player") hostPlayerSheet(ctx, Number(a));
    if (x === "stack") hostStackSheet(ctx, a);
    if (x === "zone") hostZoneSheet(ctx, Number(a), z);
    if (x === "token") tokenSheet(ctx);
    if (x === "turn") turnSheet(ctx);
    if (x === "coin") { const r = Math.random() < 0.5 ? "testa" : "croce"; ctx.commit((st) => E.logPublic(st, st.viewer, `Moneta: ${r}.`, "dice")); toast(`Moneta: ${r}.`); }
    if (x === "die") { const r = 1 + Math.floor(Math.random() * 6); ctx.commit((st) => E.logPublic(st, st.viewer, `Dado: ${r}.`, "dice")); toast(`Dado: ${r}.`); }
    if (x === "handover") ctx.commit((st) => { st.host = 1 - (st.host ?? 0); E.logPublic(st, st.host, `Ora l'host è ${st.players[st.host].name}.`, "host"); });
    if (x === "end") ctx.askEnd();
  });
}
