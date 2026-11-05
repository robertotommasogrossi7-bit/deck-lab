// Avvio e percorsi dell'app (#/..., funziona anche senza server di pagine).
import { esc, icon, store } from "./ui.js";

const routes = [
  [/^#?\/?$/, () => import("./views/decks.js"), () => ({})],
  [/^#\/importa$/, () => import("./views/decks.js"), () => ({ importa: true })],
  [/^#\/mazzo\/([^/]+)(?:\/([a-z]+))?$/, () => import("./views/deck.js"), (m) => ({ slug: decodeURIComponent(m[1]), tab: m[2] || "scheda" })],
  [/^#\/partite$/, () => import("./views/games.js"), () => ({})],
  [/^#\/partita\/(\d+)$/, () => import("./views/games.js"), (m) => ({ id: Number(m[1]) })],
  [/^#\/tavolo\/nuova(?:\?(.*))?$/, () => import("./table/setup.js"), (m) => ({ query: new URLSearchParams(m[1] || "") })],
  [/^#\/tavolo$/, () => import("./table/view.js"), () => ({})],
  [/^#\/stanza\/([A-Za-z]{4})$/, () => import("./table/lobby.js"), (m) => ({ code: m[1] })],
  [/^#\/info$/, () => import("./views/info.js"), () => ({})],
];

const app = document.getElementById("app");
let current = null;
let navSeq = 0;

// Ogni pagina disegna in un contenitore nuovo: se nel frattempo si cambia pagina, quella
// vecchia finisce di disegnare in un contenitore staccato e non sovrascrive la nuova.
async function route() {
  const hash = location.hash || "#/";
  const seq = ++navSeq;
  for (const [re, load, params] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const holder = document.createElement("div");
    holder.className = "view";
    try {
      if (current && current.leave) current.leave();
      document.documentElement.classList.remove("in-table");
      const mod = await load();
      if (seq !== navSeq) return;
      current = mod;
      document.body.dataset.view = mod.VIEW || "";
      app.replaceChildren(holder);
      await mod.render(holder, params(m));
      if (seq === navSeq && !hash.startsWith("#/tavolo")) window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      if (seq !== navSeq) return;
      app.replaceChildren(holder);
      holder.innerHTML = `<div class="page"><div class="topbar"><a class="btn btn-quiet back" href="#/">${icon("back")} Mazzi</a></div>
        <h1>Qualcosa non è andato</h1><p class="muted" style="margin-top:10px">${esc(e.message || e)}</p></div>`;
    }
    return;
  }
  location.hash = "#/";
}

// colore del tappetino scelto nelle impostazioni
const mat = store.get("mat");
if (mat) document.documentElement.dataset.mat = mat;

window.addEventListener("hashchange", route);
route();

// partite finite mentre il PC era spento: riprova a salvarle
import("./table/view.js").then((v) => v.flushUnsent()).catch(() => {});
