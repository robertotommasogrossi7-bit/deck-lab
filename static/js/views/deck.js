// Scheda del mazzo: prezzo, controlli, curva, lista. Le altre linguette stanno in lab.js.
import { api, DEMO, ONLINE } from "../api.js";
import {
  cardName, colorsWords, confirmSheet, cost, esc, eur, frameKey, groupOf, GROUPS, icon,
  n1, openSheet, pct, pips, toast, typeIt,
} from "../ui.js";
import { footer } from "./decks.js";

export const VIEW = "hub";

const TABS = [
  ["scheda", "Scheda"], ["numeri", "Numeri"], ["matchup", "Matchup"], ["partite", "Partite"],
];

export async function render(root, { slug, tab }) {
  root.innerHTML = `<div class="page"><p class="muted">Apro il mazzo…</p></div>`;
  const deck = await api.get(`/api/decks/${encodeURIComponent(slug)}`);
  const tabs = deck.kind === "mine" && !ONLINE ? [...TABS, ["modifica", "Modifica"]] : TABS;
  if (!tabs.some(([k]) => k === tab)) tab = "scheda";
  const sub = deck.meta.event ? eventLine(deck.meta.event) : (deck.kind === "mine" ? "Il tuo mazzo" : "");

  root.innerHTML = `<div class="page deck-page">
    <div class="topbar">
      <a class="btn btn-quiet back" href="#/">${icon("back")}Mazzi</a>
      ${DEMO ? "" : `<a class="btn btn-quiet" href="${api.file(`/api/decks/${encodeURIComponent(slug)}/pdf`, "pdf")}" target="_blank" rel="noopener">${icon("doc")}<span>Scheda PDF</span></a>`}
    </div>
    <header class="deck-head">
      <h1>${esc(deck.name)}</h1>
      <p class="deck-sub">${pips(deck.colors)}<span>${esc(colorsWords(deck.colors))}</span>
        <span class="muted">${deck.main_count} carte e ${deck.side_count} in sideboard</span></p>
      ${sub ? `<p class="micro" style="margin-top:6px">${esc(sub)}</p>` : ""}
    </header>
    <nav class="tabs" aria-label="Sezioni del mazzo">
      ${tabs.map(([k, label]) => `<a href="#/mazzo/${encodeURIComponent(slug)}${k === "scheda" ? "" : `/${k}`}"
        class="tab ${k === tab ? "on" : ""}" ${k === tab ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
    <div id="tab-body"></div>
    ${footer()}
  </div>`;

  const body = root.querySelector("#tab-body");
  if (tab === "scheda") return renderScheda(body, deck);
  const lab = await import("./lab.js");
  if (tab === "numeri") return lab.renderNumbers(body, deck);
  if (tab === "matchup") return lab.renderMatchups(body, deck);
  if (tab === "partite") return lab.renderGames(body, deck);
  if (tab === "modifica") return lab.renderEdit(body, deck);
}

function eventLine(ev) {
  // "MTGO Standard Challenge 16 (43 players), 2026-10-22, 1st, McWinSauce"
  const m = ev.match(/^(.*?),\s*(\d{4}-\d{2}-\d{2}),\s*([^,]+),\s*(.+)$/);
  if (!m) return ev;
  const place = m[3].replace(/^(\d+)(st|nd|rd|th)$/, "$1°").replace(/^Top ?(\d+)$/i, "top $1");
  const d = new Date(`${m[2]}T12:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  return `Lista di ${m[4]}, ${place} alla ${m[1].replace(/\s*\(\d+ players\)/, "")} del ${d}`;
}

// ---- scheda ------------------------------------------------------------------------------------
async function renderScheda(body, deck) {
  const slug = encodeURIComponent(deck.slug);
  body.innerHTML = `
    <section class="price-block" id="price"><p class="muted">Prezzi…</p></section>
    <div class="row-actions deck-actions">
      <a class="btn btn-object btn-big" href="#/tavolo/nuova?deck=${slug}">${icon("play")}Gioca con questo mazzo</a>
      ${ONLINE ? "" : deck.kind === "mine"
        ? `<a class="btn btn-big" href="#/mazzo/${slug}/modifica">${icon("edit")}Modifica</a>`
        : `<button class="btn btn-big" data-act="copy">${icon("copy")}Fanne una copia</button>`}
    </div>
    ${deck.issues.length || deck.unknown.length ? issuesBlock(deck) : ""}
    <section class="checks" id="checks" aria-labelledby="h-checks">
      <h2 id="h-checks">Controlli</h2><p class="muted small">Conto le mani… (qualche secondo la prima volta)</p>
    </section>
    <section aria-labelledby="h-curve" class="curve-section">
      <h2 id="h-curve">Curva</h2>
      ${curve(deck)}
    </section>
    <section aria-labelledby="h-list" class="list-section">
      <div class="list-head"><h2 id="h-list">Lista</h2><span class="micro">tocca una carta per leggerla</span></div>
      ${list(deck, "main")}
      <h3 class="side-title">Sideboard <span class="muted num">${deck.side_count}</span></h3>
      ${deck.side.length ? list(deck, "side") : `<p class="muted">Nessuna carta in sideboard.</p>`}
    </section>`;

  body.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-card]");
    if (row) return cardSheet(deck.cards[row.dataset.card], row.dataset.card, priceOf(row.dataset.card));
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "copy") {
      const ok = await confirmSheet("Fai una copia", "La copia finisce tra i tuoi mazzi e la puoi modificare. L'originale resta com'è.", "Crea la copia");
      if (!ok) return;
      const d = await api.post(`/api/decks/${slug}/copy`);
      toast("Copia creata.");
      location.hash = `#/mazzo/${encodeURIComponent(d.slug)}`;
    }
    if (act.dataset.act === "prices") {
      act.disabled = true;
      act.textContent = "Scarico il listino…";
      try {
        const r = await api.post("/api/prices/update");
        toast(`Prezzi aggiornati: ${r.cards} carte.`);
        loadPrice();
      } catch (ex) {
        toast(ex.message, 6000);
        act.disabled = false;
        act.textContent = "Aggiorna i prezzi";
      }
    }
  });

  let price = null;
  const priceOf = (name) => {
    if (!price || !price.rows) return null;
    const r = price.rows.find((x) => x.card === name);
    return r ? r.eur : null;
  };
  const loadPrice = async () => {
    try {
      price = await api.get(`/api/decks/${slug}/price`);
      body.querySelector("#price").innerHTML = priceBlock(price);
      for (const el of body.querySelectorAll("[data-price-of]")) {
        const v = priceOf(el.dataset.priceOf);
        const basic = deck.cards[el.dataset.priceOf]?.is_basic;
        el.textContent = v == null || basic ? "" : eur(v);
      }
    } catch (ex) {
      body.querySelector("#price").innerHTML = `<p class="muted">${esc(ex.message)}</p>`;
    }
  };
  loadPrice();
  api.cached(`/api/decks/${slug}/checks`).then((c) => {
    body.querySelector("#checks").innerHTML = checksBlock(c, deck);
  }).catch((ex) => {
    body.querySelector("#checks").innerHTML = `<h2>Controlli</h2><p class="muted">${esc(ex.message)}</p>`;
  });
}

function priceBlock(p) {
  if (!p.available) {
    return `<div class="price-main"><span class="big-number">—</span></div>
      <p class="muted small">${ONLINE ? "Prezzi non disponibili in questa versione." : "Non ho ancora il listino di Cardmarket su questo PC."}</p>
      ${ONLINE ? "" : `<button class="btn" data-act="prices">${icon("refresh")}Scarica i prezzi</button>`}`;
  }
  const old = !ONLINE && p.age_days != null && p.age_days > 3;
  return `<div class="price-main">
      <span class="big-number">${eur(p.total, 0)}</span>
      <span class="price-split small">il mazzo ${eur(p.main, 0)}<br>la sideboard ${eur(p.side, 0)}</span>
    </div>
    <p class="small muted">Prezzo di tendenza Cardmarket del ${esc(new Date(`${p.retrieved}T12:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "long" }))}.
      Comprandole da più venditori, con le spedizioni, conta ${eur(p.buy_low, 0)}–${eur(p.buy_high, 0)}.
      Le terre base non le conto.${p.missing.length ? ` Senza prezzo: ${esc(p.missing.join(", "))}.` : ""}</p>
    ${old ? `<button class="btn" data-act="prices">${icon("refresh")}Aggiorna i prezzi</button>` : ""}`;
}

function issuesBlock(deck) {
  const items = [
    ...deck.issues.map((i) => `<li class="${i.level === "ERRORE" ? "bad" : "warn"}">${icon("alert")}<span>${esc(i.msg)}</span></li>`),
    ...deck.unknown.map((n) => `<li class="bad">${icon("alert")}<span>Carta sconosciuta: ${esc(n)}</span></li>`),
  ];
  return `<section class="issues" aria-label="Problemi della lista"><ul>${items.join("")}</ul></section>`;
}

function verdict(ok, okText, badText, warn = false) {
  const cls = ok ? "ok" : warn ? "warn" : "bad";
  return `<span class="verdict ${cls}">${icon(ok ? "check" : "alert")}${esc(ok ? okText : badText)}</span>`;
}

const COL_IT = { W: "bianco", U: "blu", B: "nero", R: "rosso", G: "verde" };

function checksBlock(c, deck) {
  const nm = (n) => cardName(deck.cards[n], n);
  const low = c.castable.filter((x) => !x.ok);
  const rows = [];
  rows.push(`<li><div class="check-title">Legale in Standard</div>
    <div>${verdict(c.legal.ok, "Sì", `No: ${c.legal.issues.length} problemi`)}</div></li>`);
  rows.push(`<li><div class="check-title">Terre</div>
    <div>${verdict(c.lands.ok, `${c.lands.count}, giusto`, `${c.lands.count}: la formula ne suggerisce ${n1(c.lands.suggested)}`, true)}
    <p class="micro">La formula di Karsten guarda il costo medio delle magie (${n1(c.lands.avg_mv)}) e ne suggerisce ${n1(c.lands.suggested)}.</p></div></li>`);
  const src = c.sources.filter((s) => s.need);
  if (src.length) {
    rows.push(`<li><div class="check-title">Fonti di colore</div><div class="src-list">
      ${src.map((s) => `<div class="src">${verdict(s.ok, `${COL_IT[s.color]}: ${s.have}`, `${COL_IT[s.color]}: ${s.have}, ne servono ${s.need}`)}
        <p class="micro">Terre che danno il ${COL_IT[s.color]}. Per lanciare ${esc(nm(s.card))} in tempo ne servono ${s.need}.</p></div>`).join("")}
    </div></li>`);
  }
  rows.push(`<li><div class="check-title">Magie al turno giusto</div>
    <div>${verdict(!low.length, "Tutte puntuali", `${low.length} ${low.length === 1 ? "costo in ritardo" : "costi in ritardo"}`, true)}
    <p class="micro">${low.length
      ? `Spesso non hai i colori al turno del costo: ${esc(low.map((x) => x.cards.map(nm).join(", ")).join("; "))}.`
      : "Quando hai abbastanza terre, hai quasi sempre anche i colori giusti."}</p></div></li>`);
  rows.push(`<li><div class="check-title">Mani iniziali</div>
    <div><span class="check-fact">Tieni 7 carte ${pct(c.play.keep["7"])} delle volte</span>
    <p class="micro">Poche terre al quarto turno (2 o meno): ${pct(c.play.screw_t4)}. Troppe al settimo (8 o più viste): ${pct(c.play.flood_t7)}.</p></div></li>`);
  if (c.ai_unplayable.length) {
    rows.push(`<li><div class="check-title">IA di Forge</div><div>
      <span class="verdict warn">${icon("info")}Non sa giocare ${c.ai_unplayable.length} carte</span>
      <p class="micro">${esc(c.ai_unplayable.map(nm).join(", "))}: conta solo se ti alleni contro Forge.</p></div></li>`);
  }
  return `<h2 id="h-checks">Controlli</h2>
    <ul class="check-list">${rows.join("")}</ul>
    <a class="more-link" href="#/mazzo/${encodeURIComponent(deck.slug)}/numeri">Tutti i numeri del mazzo ${icon("next")}</a>`;
}

// ---- curva come pile di carte --------------------------------------------------------------------
function curve(deck) {
  const cols = { W: 0, U: 0, B: 0, R: 0, G: 0, M: 0, C: 0 };
  const bins = [1, 2, 3, 4, 5, 6].map((mv) => ({ mv, n: 0, parts: { ...cols } }));
  let lands = 0;
  for (const { name, qty } of deck.main) {
    const c = deck.cards[name];
    if (!c) continue;
    if (c.is_land) { lands += qty; continue; }
    const b = bins[Math.min(Math.max(c.mv, 1), 6) - 1];
    b.n += qty;
    b.parts[frameKey(c)] += qty;
  }
  const max = Math.max(...bins.map((b) => b.n), 1);
  const shown = bins.filter((b, i) => b.n || i < 4);
  const unit = Math.max(3, Math.min(6, Math.floor(118 / max)));
  const order = ["W", "U", "B", "R", "G", "M", "C"];
  const label = shown.map((b) => `${b.n} da ${b.mv === 6 ? "6 o più" : b.mv}`).join(", ");
  return `<div class="curve" role="img" aria-label="Curva: ${esc(label)}; ${lands} terre">
    ${shown.map((b) => `<div class="curve-col">
      <span class="curve-n num">${b.n || ""}</span>
      <span class="curve-stack" style="--u:${unit}px">${order.flatMap((k) => Array(b.parts[k]).fill(k))
        .map((k) => `<i class="f-${k}"></i>`).join("")}</span>
      <span class="curve-mv">${b.mv === 6 ? "6+" : b.mv}</span></div>`).join("")}
    <div class="curve-lands"><span class="curve-n num">${lands}</span><span class="micro">terre</span></div>
  </div>
  <p class="curve-legend micro">${[...new Set(deck.main.map(({ name }) => frameKey(deck.cards[name])).filter((k) => k !== "L"))]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((k) => `<span><i class="f-${k}"></i>${{ W: "bianche", U: "blu", B: "nere", R: "rosse", G: "verdi", M: "multicolori", C: "incolori" }[k]}</span>`).join("")}</p>`;
}

// ---- lista -----------------------------------------------------------------------------------
function list(deck, zone) {
  const groups = new Map();
  for (const { name, qty } of deck[zone]) {
    const info = deck.cards[name];
    const g = groupOf(info);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ name, qty, info });
  }
  const order = [...GROUPS.map(([, v]) => v), "Altro"];
  return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([g, items]) => {
    items.sort((a, b) => (a.info?.mv ?? 0) - (b.info?.mv ?? 0) || cardName(a.info, a.name).localeCompare(cardName(b.info, b.name)));
    const n = items.reduce((s, x) => s + x.qty, 0);
    return `<div class="card-group"><h3 class="group-title">${g} <span class="muted num">${n}</span></h3>
      <ul class="card-rows">${items.map(({ name, qty, info }) => {
        const it = cardName(info, name);
        return `<li><button class="card-row" data-card="${esc(name)}">
          <span class="qty num">${qty}</span>
          <span class="frame-dot f-${frameKey(info)}" aria-hidden="true"></span>
          <span class="cr-name"><span>${esc(it)}</span>${it !== name ? `<span class="cr-en">${esc(name)}</span>` : ""}</span>
          <span class="cr-cost">${cost(info?.cost)}</span>
          <span class="cr-price num" data-price-of="${esc(name)}"></span>
        </button></li>`;
      }).join("")}</ul></div>`;
  }).join("");
}

export function cardSheet(info, name, price) {
  if (!info) {
    openSheet(`<h2>${esc(name)}</h2><p class="muted">Carta sconosciuta a Forge: controlla come è scritto il nome.</p>`);
    return;
  }
  const it = cardName(info, name);
  const text = info.text_it || info.text;
  const stats = [info.pt ? `Forza e costituzione ${info.pt}` : "", info.loyalty ? `Fedeltà ${info.loyalty}` : ""].filter(Boolean);
  openSheet(`<div class="card-sheet">
    <div class="cs-head"><h2>${esc(it)}</h2>${cost(info.cost)}</div>
    ${it !== info.name ? `<p class="micro">${esc(info.name)}</p>` : ""}
    <p class="cs-type">${esc(typeIt(info))}${info.subtypes?.length && !info.type_it ? ` — ${esc(info.subtypes.join(" "))}` : ""}</p>
    <div class="cs-text">${esc(text).replace(/\n/g, "<br>")}</div>
    ${info.text_it ? "" : `<p class="micro">Testo in inglese: la traduzione italiana di questa carta non c'è ancora.</p>`}
    ${stats.length ? `<p class="cs-stats">${esc(stats.join(". "))}</p>` : ""}
    ${price != null ? `<p class="micro">Cardmarket: ${eur(price)} l'una.</p>` : ""}
    ${info.faces?.length ? `<details class="cs-faces"><summary>Altre facce</summary>${info.faces.slice(1).map((f) => `<p><strong>${esc(f.it || f.name)}</strong> ${cost(f.cost)}<br>${esc(f.text).replace(/\n/g, "<br>")}</p>`).join("")}</details>` : ""}
  </div>`, { label: it });
}
