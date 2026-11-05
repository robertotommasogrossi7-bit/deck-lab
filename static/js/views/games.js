// Partite salvate: elenco e diario di una partita.
import { api, ONLINE } from "../api.js";
import { esc, icon } from "../ui.js";
import { deckNames, gameRow } from "./lab.js";
import { footer } from "./decks.js";

export const VIEW = "hub";

export async function render(root, { id }) {
  root.innerHTML = `<div class="page"><p class="muted">Carico le partite…</p></div>`;
  const names = await deckNames();
  const dn = (s) => names[s] || s || "?";
  if (id) return renderOne(root, id, dn);
  const { games } = await api.get("/api/games?limit=200");
  const duo = games.filter((g) => g.mode === "duo");
  const solo = games.filter((g) => g.mode === "solo");
  root.innerHTML = `<div class="page">
    <div class="topbar"><a class="btn btn-quiet back" href="#/">${icon("back")}Mazzi</a></div>
    <h1>Partite</h1>
    <p class="muted" style="margin-top:6px">${ONLINE ? "Tutte le partite finite al tavolo, salvate online: le vede chi usa questa app." : "Tutte le partite finite al tavolo, salvate nel database del PC."}</p>
    <section class="deck-section"><h2>Con gli amici <span class="muted num">${duo.length}</span></h2>
      ${duo.length ? `<ul class="game-list">${duo.map((g) => gameRow(g, dn)).join("")}</ul>` : `<p class="empty">Ancora nessuna. <a href="#/tavolo/nuova">Inizia una partita</a>.</p>`}</section>
    <section class="deck-section"><h2>Prove di velocità <span class="muted num">${solo.length}</span></h2>
      ${solo.length ? `<ul class="game-list">${solo.map((g) => gameRow(g, dn)).join("")}</ul>` : `<p class="empty">Ancora nessuna.</p>`}</section>
    ${footer()}
  </div>`;
}

async function renderOne(root, id, dn) {
  const g = await api.get(`/api/games/${id}`);
  const byTurn = new Map();
  for (const l of g.log || []) {
    if (!byTurn.has(l.turn)) byTurn.set(l.turn, []);
    byTurn.get(l.turn).push(l);
  }
  const solo = g.mode === "solo";
  const title = solo ? `${dn(g.p1_deck)} da solo` : `${g.p1_name} contro ${g.p2_name}`;
  const res = solo ? (g.winner === 1 ? `Avversario finto a zero al turno ${g.turns}.` : "Prova interrotta.")
    : g.winner ? `Ha vinto ${g.winner === 1 ? g.p1_name : g.p2_name}${g.turns ? ` al turno ${g.turns}` : ""}.` : "Nessun vincitore.";
  root.innerHTML = `<div class="page narrow">
    <div class="topbar"><a class="btn btn-quiet back" href="#/partite">${icon("back")}Partite</a></div>
    <h1>${esc(title)}</h1>
    <p class="muted" style="margin-top:6px">${esc(res)}${solo ? "" : ` ${esc(g.p1_name)} con ${esc(dn(g.p1_deck))}, ${esc(g.p2_name)} con ${esc(dn(g.p2_deck))}.`}</p>
    <p class="micro" style="margin-top:4px">${esc(new Date(String(g.ended_at).replace(" ", "T")).toLocaleString("it-IT"))}</p>
    <div class="diary" style="margin-top:20px">${[...byTurn.entries()].map(([t, ls]) => `<section><h3>Turno ${t}</h3><ol>${ls.map((l) => `<li class="k-${esc(l.kind)}">${esc(l.text)}</li>`).join("")}</ol></section>`).join("")}</div>
  </div>`;
}
