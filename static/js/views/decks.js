// Elenco dei mazzi e importazione di una lista.
import { api, DEMO, ONLINE } from "../api.js";
import { esc, eur, icon, pct, pips, colorsWords, toast } from "../ui.js";

export const VIEW = "hub";

export async function render(root, params) {
  if (params.importa) return renderImport(root);
  root.innerHTML = `<div class="page"><p class="muted">Carico i mazzi…</p></div>`;
  const { decks } = await api.get("/api/decks");
  const mine = decks.filter((d) => d.kind === "mine");
  const meta = decks.filter((d) => d.kind === "gauntlet")
    .sort((a, b) => (b.meta_share || 0) - (a.meta_share || 0));

  root.innerHTML = `<div class="page decks">
    <div class="topbar">
      <span class="wordmark">Deck Lab</span>
      <nav class="topnav" aria-label="Sezioni">
        <a class="btn btn-quiet" href="#/partite">${icon("score")}<span>Partite</span></a>
        <a class="btn btn-quiet btn-round" href="#/info" aria-label="Impostazioni e telefono">${icon("settings")}</a>
      </nav>
    </div>

    <h1>I mazzi</h1>
    ${DEMO ? `<p class="demo-note">Prova nel browser: si gioca con «Un telefono in due» o con la prova di velocità. I due telefoni e le partite salvate sono nell'app vera.</p>` : ""}
    <div class="row-actions hero-actions">
      <a class="btn btn-object btn-big" href="#/tavolo/nuova">${icon("play")}Nuova partita</a>
      ${ONLINE ? "" : `<a class="btn btn-big" href="#/importa">${icon("plus")}Importa una lista</a>`}
    </div>
    ${resumeBanner()}

    ${ONLINE && !mine.length ? "" : `<section class="deck-section" aria-labelledby="h-mine">
      <h2 id="h-mine">I tuoi</h2>
      ${mine.length ? `<ul class="deck-list">${mine.map(row).join("")}</ul>` : `<p class="empty">
        Non hai ancora mazzi tuoi. Importa una lista da Arena o Moxfield, oppure apri un mazzo del
        metagame e fanne una copia da modificare.</p>`}
    </section>`}

    <section class="deck-section" aria-labelledby="h-meta">
      <h2 id="h-meta">Il metagame</h2>
      <p class="micro section-note">Le liste che vincono adesso, una per archetipo. La percentuale è la quota
        dei mazzi nei tornei degli ultimi 30 giorni (MTGDecks).</p>
      <ul class="deck-list">${meta.map(row).join("")}</ul>
    </section>
    ${footer()}
  </div>`;
}

function resumeBanner() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("decklab:game") || "null"); } catch { /* niente */ }
  if (!saved || saved.over) return "";
  const p = saved.players || [];
  if (saved.room) {
    return `<a class="resume" href="#/stanza/${esc(saved.room)}">
      <span><strong>Partita in corso nella stanza ${esc(saved.room)}</strong><span class="muted"> ${esc((p[0] || {}).name || "")} contro ${esc((p[1] || {}).name || "")}, turno ${saved.turn || 1}</span></span>
      <span class="resume-go">Riprendi ${icon("next")}</span></a>`;
  }
  const who = p.length === 2 && saved.mode === "duo"
    ? `${esc(p[0].name)} contro ${esc(p[1].name)}` : esc((p[0] || {}).name || "Prova di velocità");
  return `<a class="resume" href="#/tavolo">
    <span><strong>Partita in corso</strong><span class="muted"> ${who}, turno ${saved.turn || 1}</span></span>
    <span class="resume-go">Riprendi ${icon("next")}</span></a>`;
}

function stack(d) {
  const cols = (d.colors || "C").split("");
  const top = cols.length > 1 ? "M" : cols[0];
  return `<span class="deck-stack" aria-hidden="true">
    <span class="s s3"></span><span class="s s2"></span>
    <span class="s s1"><span class="frame f-${top}"></span>${cols.length > 1 ? `<span class="split">${cols.map((c) => `<i class="f-${c}"></i>`).join("")}</span>` : ""}</span>
  </span>`;
}

function row(d) {
  if (d.error) {
    return `<li class="deck-row broken"><span class="deck-name">${esc(d.name)}</span>
      <span class="micro">Non riesco a leggere questo file: ${esc(d.error)}</span></li>`;
  }
  return `<li><a class="deck-row" href="#/mazzo/${encodeURIComponent(d.slug)}">
    ${stack(d)}
    <span class="deck-main">
      <span class="deck-name">${esc(d.name)}</span>
      <span class="deck-sub">${pips(d.colors)}<span>${esc(colorsWords(d.colors))}</span>
        ${d.meta_share != null ? `<span class="deck-share">${pct(d.meta_share, 1)} dei mazzi</span>` : ""}
        ${d.problems ? `<span class="verdict warn">${icon("alert")}${d.problems} da controllare</span>` : ""}</span>
    </span>
    <span class="deck-price num">${d.price != null ? eur(d.price, 0) : ""}</span>
  </a></li>`;
}

export function footer() {
  return `<p class="footer-note">Deck Lab è Fan Content non ufficiale permesso dalla Fan Content Policy.
    Non approvato né sponsorizzato da Wizards. Parti dei materiali usati sono proprietà di
    Wizards of the Coast. ©Wizards of the Coast LLC. Prezzi: listino pubblico Cardmarket.</p>`;
}

// ---- importazione ----------------------------------------------------------------------------
function renderImport(root) {
  root.innerHTML = `<div class="page narrow">
    <div class="topbar"><a class="btn btn-quiet back" href="#/">${icon("back")}Mazzi</a></div>
    <h1>Importa una lista</h1>
    <p class="muted" style="margin-top:8px">Incolla la lista come la copi da Arena, Moxfield,
      MTGGoldfish o un sito di tornei: una carta per riga, con il numero davanti. La sideboard
      va dopo una riga «Sideboard» o dopo una riga vuota.</p>
    <form class="stack-form" id="imp">
      <label class="field"><span>Nome del mazzo</span>
        <input type="text" name="name" required maxlength="80" placeholder="Per esempio: Lifegain con Ajani"></label>
      <label class="field"><span>Lista</span>
        <textarea name="text" required spellcheck="false" placeholder="4 Hinterland Sanctifier&#10;4 Enlightened Confidant&#10;…&#10;&#10;Sideboard&#10;4 Duress"></textarea></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-object btn-big" type="submit">Salva il mazzo</button>
    </form>
  </div>`;
  const form = root.querySelector("#imp");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = form.querySelector(".form-error");
    err.hidden = true;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const d = await api.post("/api/decks", { name: form.name.value, text: form.text.value });
      toast(d.unknown.length ? `Salvato. ${d.unknown.length} carte non riconosciute: controllale.` : "Mazzo salvato.");
      location.hash = `#/mazzo/${encodeURIComponent(d.slug)}`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}
