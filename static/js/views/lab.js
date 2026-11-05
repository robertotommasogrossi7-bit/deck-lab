// Linguette del mazzo: Numeri (goldfish, mani di prova, probabilita'), Matchup reali,
// Partite giocate, Modifica.
import { api } from "../api.js";
import {
  cardName, confirmSheet, cost, dateIt, esc, frameKey, icon, n1, pct, plural, shuffle, toast, typeIt,
} from "../ui.js";

const COL_IT = { W: "bianco", U: "blu", B: "nero", R: "rosso", G: "verde" };

// ================================================================================================
// NUMERI
// ================================================================================================
export async function renderNumbers(body, deck) {
  body.innerHTML = `<p class="muted">Conto ventimila mani in prima e ventimila in seconda…</p>`;
  const c = await api.cached(`/api/decks/${encodeURIComponent(deck.slug)}/checks`);
  const nm = (n) => cardName(deck.cards[n], n);
  const src = c.sources.filter((s) => s.need);
  body.innerHTML = `
    <section class="lab-section" aria-labelledby="h-hands">
      <h2 id="h-hands">Mani iniziali</h2>
      <p class="muted small">Con la regola di Karsten sul mulligan: si guarda solo quante terre ci sono.</p>
      <div class="facts">
        <div class="fact"><span class="big-number">${pct(c.play.keep["7"])}</span><p class="micro">tieni 7 carte quando giochi per primo</p></div>
        <div class="fact"><span class="big-number">${pct(c.draw.keep["7"])}</span><p class="micro">tieni 7 carte quando giochi per secondo</p></div>
      </div>
      <p class="small muted">Scendi a 6 carte il ${pct(c.play.keep["6"])} delle volte, a 5 il ${pct(c.play.keep["5"], 1)}, a 4 il ${pct(c.play.keep["4"], 1)} (giocando per primo).</p>
    </section>

    <section class="lab-section" aria-labelledby="h-drops">
      <h2 id="h-drops">Una terra ogni turno</h2>
      <p class="muted small">Probabilità di avere almeno una terra per turno fino a quel turno (mulligan compresi).</p>
      <div class="table-box"><table class="data-table meter-table">
        <thead><tr><th>Turno</th><th>Giochi per primo</th><th>Per secondo</th></tr></thead>
        <tbody>${[1, 2, 3, 4, 5, 6].map((t) => `<tr><td>${t}</td>
          <td>${meter(c.play.land_drop[String(t)])}</td><td>${meter(c.draw.land_drop[String(t)])}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="facts">
        <div class="fact"><span class="big-number">${pct(c.play.screw_t4)}</span><p class="micro">poche terre: 2 o meno al quarto turno</p></div>
        <div class="fact"><span class="big-number">${pct(c.play.flood_t7)}</span><p class="micro">troppe: 8 o più terre viste al settimo turno</p></div>
      </div>
    </section>

    <section class="lab-section" aria-labelledby="h-src">
      <h2 id="h-src">Terre e colori</h2>
      <p class="small">${c.lands.count} terre${c.lands.mdfc ? ` e ${c.lands.mdfc} carte con il retro terra` : ""}. Costo medio delle magie ${n1(c.lands.avg_mv)}: la formula di Karsten suggerisce <strong>${n1(c.lands.suggested)} terre</strong>${c.lands.cheap.length ? ` (conta anche ${esc(c.lands.cheap.map(nm).join(", "))}, che fa pescare o dà mana a poco)` : ""}.</p>
      ${c.lands.tapped_always || c.lands.tapped_conditional ? `<p class="small muted" style="margin-top:6px">Entrano tappate: ${c.lands.tapped_always} sempre, ${c.lands.tapped_conditional} solo in certi casi.</p>` : ""}
      ${src.length ? `<div class="table-box"><table class="data-table">
        <thead><tr><th>Colore</th><th class="r">Fonti</th><th class="r">Servono</th><th>Per</th></tr></thead>
        <tbody>${src.map((s) => `<tr><td>${COL_IT[s.color]}</td><td class="r">${s.have}</td><td class="r">${s.need}</td>
          <td>${esc(nm(s.card))} <span class="verdict ${s.ok ? "ok" : "bad"}">${icon(s.ok ? "check" : "alert")}${s.ok ? "ok" : `mancano ${s.need - s.have}`}</span></td></tr>`).join("")}</tbody>
      </table></div>
      <p class="micro" style="margin-top:6px">Fonti = terre che danno quel colore. «Servono» è la tabella di Karsten per lanciare la carta più esigente in tempo nove volte su dieci.</p>` : ""}
    </section>

    <section class="lab-section" aria-labelledby="h-cast">
      <h2 id="h-cast">Magie al turno giusto</h2>
      <p class="muted small">Se al turno del suo costo hai abbastanza terre, quante volte hai anche i colori giusti (giocando per primo).</p>
      <div class="table-box"><table class="data-table meter-table">
        <thead><tr><th>Costo</th><th>Probabilità</th><th>Carte</th></tr></thead>
        <tbody>${c.castable.map((x) => `<tr><td>${costSym(x)}</td><td>${meter(x.p, x.target)}${x.ok ? "" : `<span class="verdict warn small">${icon("alert")}sotto il ${pct(x.target)}</span>`}</td>
          <td class="small">${esc(x.cards.map(nm).join(", "))}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

    <section class="lab-section" aria-labelledby="h-sample">
      <h2 id="h-sample">Mano di prova</h2>
      <p class="muted small">Pesca sette carte a caso da questo mazzo, come all'inizio di una partita.</p>
      <div id="sample"></div>
    </section>

    <section class="lab-section" aria-labelledby="h-calc">
      <h2 id="h-calc">Quante possibilità ho di…</h2>
      <div id="calc"></div>
    </section>
    <p class="micro">${esc(c.method)} Simulate ${c.hands.toLocaleString("it-IT")} mani per lato.</p>`;

  sampleHand(body.querySelector("#sample"), deck);
  calculator(body.querySelector("#calc"), deck);
}

function meter(p, target = null) {
  const w = Math.max(0, Math.min(1, p)) * 100;
  return `<span class="meter" role="img" aria-label="${pct(p)}"><span class="meter-track"><span class="meter-fill" style="width:${w}%"></span>${target != null ? `<span class="meter-target" style="left:${target * 100}%"></span>` : ""}</span><span class="meter-val">${pct(p)}</span></span>`;
}

function costSym(x) {
  const generic = x.mv - x.symbols.length;
  return cost(`${generic > 0 ? `{${generic}}` : ""}${[...x.symbols].map((s) => `{${s}}`).join("")}`);
}

// ---- mano di prova -----------------------------------------------------------------------------
function sampleHand(el, deck) {
  const pool = deck.main.flatMap(({ name, qty }) => Array(qty).fill(name));
  let lib = [];
  let hand = [];
  let mulls = 0;
  const deal = () => { lib = shuffle(pool); hand = lib.splice(0, 7); };
  const drawOne = () => { if (lib.length) hand.push(lib.shift()); };
  deal();
  const paint = () => {
    const lands = hand.filter((n) => deck.cards[n]?.is_land).length;
    el.innerHTML = `<p class="small"><strong>${plural(lands, "terra", "terre")}</strong> su ${hand.length} carte${mulls ? `, dopo ${plural(mulls, "mulligan", "mulligan")} (ne metteresti ${mulls} in fondo)` : ""}.</p>
      <div class="hand-row">${hand.map((n) => {
        const i = deck.cards[n];
        return `<span class="mini-card"><span class="face" style="--fc:var(--c-${frameKey(i)})">${esc(cardName(i, n))}${cost(i?.cost)}</span></span>`;
      }).join("")}</div>
      <div class="row-actions">
        <button class="btn" data-h="new">${icon("refresh")}Nuova mano</button>
        <button class="btn" data-h="mull">Mulligan</button>
        <button class="btn" data-h="draw" ${lib.length ? "" : "disabled"}>${icon("draw")}Pesca una carta</button>
      </div>`;
  };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-h]");
    if (!b) return;
    if (b.dataset.h === "new") { mulls = 0; deal(); }
    if (b.dataset.h === "mull") { mulls = Math.min(6, mulls + 1); deal(); }
    if (b.dataset.h === "draw") drawOne();
    paint();
  });
  paint();
}

// ---- calcolatore (ipergeometrica) -------------------------------------------------------------
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
export function atLeast(N, K, n, k) {
  let p = 0;
  for (let x = k; x <= Math.min(K, n); x++) p += (comb(K, x) * comb(N - K, n - x)) / comb(N, n);
  return Math.min(1, Math.max(0, p));
}

function calculator(el, deck) {
  const N = deck.main.reduce((s, x) => s + x.qty, 0);
  const lands = deck.main.filter((x) => deck.cards[x.name]?.is_land).reduce((s, x) => s + x.qty, 0);
  const opts = [
    { v: "__lands", label: `Una terra qualsiasi (${lands})`, k: lands },
    ...deck.main.filter((x) => !deck.cards[x.name]?.is_land)
      .sort((a, b) => cardName(deck.cards[a.name], a.name).localeCompare(cardName(deck.cards[b.name], b.name)))
      .map((x) => ({ v: x.name, label: `${cardName(deck.cards[x.name], x.name)} (${x.qty})`, k: x.qty })),
  ];
  el.innerHTML = `<form class="calc" id="calcf">
    <div class="calc-row">
      <label class="field"><span>Avere almeno</span><select name="k">${[1, 2, 3, 4].map((k) => `<option value="${k}">${k} ${k === 1 ? "copia" : "copie"}</option>`).join("")}</select></label>
      <label class="field"><span>di</span><select name="card">${opts.map((o) => `<option value="${esc(o.v)}">${esc(o.label)}</option>`).join("")}</select></label>
    </div>
    <div class="calc-row">
      <label class="field"><span>Entro il turno</span><select name="t">${[1, 2, 3, 4, 5, 6, 7, 8].map((t) => `<option ${t === 3 ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field"><span>Giocando</span><select name="play"><option value="1">per primo</option><option value="0">per secondo</option></select></label>
    </div>
    <div class="calc-out" aria-live="polite"></div>
  </form>`;
  const f = el.querySelector("#calcf");
  const upd = () => {
    const o = opts.find((x) => x.v === f.card.value) || opts[0];
    const t = Number(f.t.value);
    const seen = 7 + t - (f.play.value === "1" ? 1 : 0);
    const k = Number(f.k.value);
    const p = atLeast(N, o.k, seen, k);
    f.querySelector(".calc-out").innerHTML = `<span class="big-number">${pct(p, p < 0.995 && p > 0.005 ? 1 : 0)}</span>
      <p class="micro">Vedi ${seen} carte del mazzo da ${N} (7 in mano e ${seen - 7} pescate). Il conto non tiene conto dei mulligan né delle carte che fanno pescare.</p>`;
  };
  f.addEventListener("input", upd);
  upd();
}

// ================================================================================================
// MATCHUP
// ================================================================================================
export async function renderMatchups(body, deck) {
  body.innerHTML = `<p class="muted">Carico i matchup…</p>`;
  const m = await api.cached(`/api/decks/${encodeURIComponent(deck.slug)}/matchups`);
  if (!m.reference) {
    body.innerHTML = `<p class="empty">${esc(m.note)}</p>`;
    return;
  }
  const rows = m.rows.filter((r) => !r.mirror);
  const mirror = m.rows.find((r) => r.mirror);
  const from = m.from ? dateIt(m.from) : "";
  const to = m.to ? dateIt(m.to) : "";
  body.innerHTML = `<section class="lab-section">
    <h2>Come va contro gli altri</h2>
    <p class="muted small">Match veri dei tornei (MTGDecks, ${esc(m.reference)}), con sideboard, dal ${esc(from)} al ${esc(to)}.
      Il pallino è la percentuale di match vinti; la barra è dove sta davvero con 95 probabilità su 100: più match, barra più corta.</p>
    ${m.overall ? `<div class="facts"><div class="fact"><span class="big-number">${pct(m.overall.win_rate)}</span><p class="micro">match vinti in totale, ultimi 30 giorni</p></div>
      <div class="fact"><span class="big-number">${pct(m.overall.meta_share, 1)}</span><p class="micro">dei mazzi in torneo sono questo</p></div></div>` : ""}
    <div class="table-box"><table class="data-table mu-table">
      <thead><tr><th>Contro</th><th class="r">Match</th><th class="r">Vinti</th><th class="ci-col"><span class="ci-scale">0%<span>50%</span>100%</span></th></tr></thead>
      <tbody>${rows.map((r, k) => `<tr class="${r.matches < 30 ? "few" : ""}" ${r.matches < 15 && k >= 8 ? "hidden" : ""}>
        <td>${r.opponent_slug ? `<a href="#/mazzo/${encodeURIComponent(r.opponent_slug)}">${esc(r.opponent)}</a>` : esc(r.opponent)}${r.matches < 30 ? '<span class="micro"> pochi dati</span>' : ""}</td>
        <td class="r">${r.matches}</td><td class="r"><strong>${pct(r.win_rate)}</strong></td>
        <td>${ci(r)}</td></tr>`).join("")}</tbody>
    </table></div>
    ${rows.some((r, k) => r.matches < 15 && k >= 8) ? `<button class="btn show-all" data-showall>Mostra anche gli archetipi con meno di 15 match</button>` : ""}
    ${mirror ? `<p class="micro" style="margin-top:8px">Contro sé stesso: ${mirror.matches} match (per forza intorno al 50%).</p>` : ""}
    <p class="micro" style="margin-top:8px">Le partite tra intelligenze artificiali di Forge non sono qui: confrontate con questi dati sbagliavano di 22 punti in media.</p>
  </section>`;
  const more = body.querySelector("[data-showall]");
  if (more) more.addEventListener("click", () => { body.querySelectorAll("tr[hidden]").forEach((tr) => { tr.hidden = false; }); more.remove(); });
}

function ci(r) {
  const lo = (r.ci_low ?? r.win_rate) * 100;
  const hi = (r.ci_high ?? r.win_rate) * 100;
  return `<span class="ci" role="img" aria-label="tra ${Math.round(lo)} e ${Math.round(hi)}%">
    <span class="mid"></span><span class="rng" style="left:${lo}%;width:${Math.max(1, hi - lo)}%"></span>
    <span class="pt" style="left:${r.win_rate * 100}%"></span></span>`;
}

// ================================================================================================
// PARTITE
// ================================================================================================
export async function renderGames(body, deck) {
  body.innerHTML = `<p class="muted">Carico le partite…</p>`;
  const { stats, games } = await api.get(`/api/decks/${encodeURIComponent(deck.slug)}/games`);
  const slug = encodeURIComponent(deck.slug);
  const names = await deckNames();
  const dn = (s) => names[s] || s || "?";
  const n = stats.won + stats.lost;
  body.innerHTML = `
    <div class="row-actions deck-actions">
      <a class="btn btn-object btn-big" href="#/tavolo/nuova?deck=${slug}">${icon("play")}Gioca con un amico</a>
      <a class="btn btn-big" href="#/tavolo/nuova?deck=${slug}&mode=solo">Prova di velocità</a>
    </div>
    <section class="lab-section">
      <h2>Le tue partite</h2>
      ${n ? `<div class="facts">
        <div class="fact"><span class="big-number">${stats.won}–${stats.lost}</span><p class="micro">vinte e perse</p></div>
        <div class="fact"><span class="big-number">${stats.play_n ? `${stats.play_won}/${stats.play_n}` : "—"}</span><p class="micro">vinte giocando per primo</p></div>
        <div class="fact"><span class="big-number">${stats.draw_n ? `${stats.draw_won}/${stats.draw_n}` : "—"}</span><p class="micro">vinte giocando per secondo</p></div>
      </div>
      <div class="table-box"><table class="data-table mu-table">
        <thead><tr><th>Contro</th><th class="r">Vinte</th><th class="r">Perse</th><th class="ci-col"><span class="ci-scale">0%<span>50%</span>100%</span></th></tr></thead>
        <tbody>${stats.by_opponent.map((b) => `<tr><td>${esc(dn(b.opponent))}</td><td class="r">${b.won}</td><td class="r">${b.lost}</td>
          <td>${ci({ win_rate: b.won / b.n, ci_low: b.ci_low, ci_high: b.ci_high })}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="micro" style="margin-top:8px">Con poche partite la barra è lunga: dieci partite dicono poco, ma ti allenano.</p>`
        : `<p class="empty">Nessuna partita ancora con questo mazzo. Quando ne finisci una al tavolo, finisce qui.</p>`}
    </section>
    <p class="micro" style="margin:-18px 0 26px">Per allenarti da solo contro l'intelligenza artificiale di Forge apri GIOCA_FORGE.bat sul PC: le liste del metagame sono già tra i suoi mazzi.</p>
    <section class="lab-section">
      <h2>Prova di velocità</h2>
      ${stats.speed ? speedBlock(stats.speed) : `<p class="empty">Gioca il mazzo da solo contro un avversario che non fa niente: conto in quale turno arriva a zero. È il modo più semplice per sapere quanto è veloce.</p>`}
    </section>
    ${games.length ? `<section class="lab-section"><h2>Ultime partite</h2><ul class="game-list">${games.slice(0, 20).map((g) => gameRow(g, dn)).join("")}</ul></section>` : ""}`;
}

function speedBlock(sp) {
  const max = Math.max(...Object.values(sp.by_turn));
  const turns = Object.keys(sp.by_turn).map(Number);
  const lo = Math.min(...turns);
  const hi = Math.max(...turns);
  const cols = [];
  for (let t = lo; t <= hi; t++) cols.push([t, sp.by_turn[String(t)] || 0]);
  return `<div class="facts">
      <div class="fact"><span class="big-number">${n1(sp.avg)}</span><p class="micro">turno medio in cui l'avversario arriva a zero (${plural(sp.runs, "prova", "prove")})</p></div>
      <div class="fact"><span class="big-number">${sp.best}</span><p class="micro">il turno più veloce</p></div>
    </div>
    <div class="hist" role="img" aria-label="Prove per turno: ${cols.map(([t, v]) => `turno ${t}: ${v}`).join(", ")}">
      ${cols.map(([t, v]) => `<div class="hist-col"><span class="hist-n">${v || ""}</span><span class="hist-bar" style="height:${(v / max) * 100}%"></span><span class="hist-t">${t}</span></div>`).join("")}
    </div><p class="micro">Numero di prove per turno di vittoria.</p>`;
}

let namesCache = null;
async function deckNames() {
  if (namesCache) return namesCache;
  try {
    const { decks } = await api.get("/api/decks");
    namesCache = Object.fromEntries(decks.map((d) => [d.slug, d.name]));
  } catch { namesCache = {}; }
  return namesCache;
}

export function gameRow(g, dn) {
  const solo = g.mode === "solo";
  const res = solo ? (g.winner === 1 ? `a zero al turno ${g.turns}` : "interrotta")
    : g.winner ? `vince ${esc(g.winner === 1 ? g.p1_name : g.p2_name)}` : "senza vincitore";
  const when = g.ended_at ? new Date(g.ended_at.replace(" ", "T")).toLocaleDateString("it-IT", { day: "numeric", month: "short" }) : "";
  return `<li><a class="game-row" href="#/partita/${g.id}">
    <span class="gr-when">${esc(when)}</span>
    <span class="gr-main">${solo ? `<strong>${esc(dn(g.p1_deck))}</strong> da solo` : `<strong>${esc(g.p1_name)}</strong> ${esc(dn(g.p1_deck))} <span class="muted">contro</span> <strong>${esc(g.p2_name)}</strong> ${esc(dn(g.p2_deck))}`}</span>
    <span class="gr-res">${res}</span></a></li>`;
}

export { deckNames };

// ================================================================================================
// MODIFICA (solo i tuoi mazzi)
// ================================================================================================
export function renderEdit(body, deck) {
  body.innerHTML = `<form class="stack-form" id="edit">
    <label class="field"><span>Nome</span><input type="text" name="name" value="${esc(deck.name)}" maxlength="80"></label>
    <label class="field"><span>Lista (una carta per riga; la sideboard dopo «Sideboard»)</span>
      <textarea name="text" spellcheck="false">${esc(deck.text)}</textarea></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="row-actions">
      <button class="btn btn-object btn-big" type="submit">Salva le modifiche</button>
      <button class="btn btn-big" type="button" data-trash>${icon("trash")}Togli dai miei mazzi</button>
    </div>
    <p class="micro">«Togli» sposta il file nella cartella decks\\mine\\_cestino sul PC: non si cancella niente.</p>
  </form>`;
  const f = body.querySelector("#edit");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = f.querySelector(".form-error");
    err.hidden = true;
    try {
      const d = await api.put(`/api/decks/${encodeURIComponent(deck.slug)}`, { name: f.name.value, text: f.text.value });
      api.forget(`/api/decks/${encodeURIComponent(deck.slug)}`);
      toast("Modifiche salvate.");
      location.hash = `#/mazzo/${encodeURIComponent(d.slug)}`;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  f.querySelector("[data-trash]").addEventListener("click", async () => {
    if (!(await confirmSheet("Togli il mazzo", `${deck.name} finisce nel cestino dei mazzi sul PC. Puoi recuperarlo da lì.`, "Togli"))) return;
    await api.del(`/api/decks/${encodeURIComponent(deck.slug)}`);
    toast("Mazzo spostato nel cestino.");
    location.hash = "#/";
  });
}

export { typeIt };
