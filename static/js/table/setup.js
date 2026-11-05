// Preparazione della partita: modalita', giocatori, mazzi, bustine, chi inizia.
import { api, DEMO, ONLINE } from "../api.js";
import { esc, icon, store, toast } from "../ui.js";
import { newGame, setDecks } from "./engine.js";

export const VIEW = "hub";

export const SLEEVES = [
  ["nero", "Nere"], ["rosso", "Rosse"], ["blu", "Blu"], ["bianco", "Bianche"], ["verde", "Verdi"],
  ["viola", "Viola"], ["giallo", "Gialle"],
];

export async function render(root, { query }) {
  root.innerHTML = `<div class="page"><p class="muted">Preparo il tavolo…</p></div>`;
  const { decks } = await api.get("/api/decks");
  const ok = decks.filter((d) => !d.error);
  const prefs = store.get("setup", {});
  const pre = query.get("deck");
  const d1 = pre && ok.some((d) => d.slug === pre) ? pre : prefs.d1 || (ok[0] && ok[0].slug);
  const d2 = prefs.d2 && prefs.d2 !== d1 ? prefs.d2 : (ok.find((d) => d.slug !== d1) || {}).slug;
  const NETOK = ONLINE && !DEMO;
  const modes = NETOK ? ["net", "duo", "solo"] : ["duo", "solo"];
  const want = query.get("mode") || prefs.mode;
  const mode = modes.includes(want) ? want : modes[0];

  const options = (sel) => {
    const g = (kind, label) => {
      const list = ok.filter((d) => d.kind === kind);
      return list.length ? `<optgroup label="${label}">${list.map((d) => `<option value="${esc(d.slug)}" ${d.slug === sel ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</optgroup>` : "";
    };
    return g("mine", "I tuoi") + g("gauntlet", "Il metagame");
  };
  const sleeves = (name, sel) => `<div class="sleeve-pick" role="radiogroup" aria-label="Colore delle bustine">
    ${SLEEVES.map(([k, label]) => `<label class="sw sl-${k}"><input type="radio" name="${name}" value="${k}" ${k === sel ? "checked" : ""}>
      <span class="sw-card" aria-hidden="true"></span><span class="sr-only">${label}</span></label>`).join("")}</div>`;

  root.innerHTML = `<div class="page narrow setup">
    <div class="topbar"><a class="btn btn-quiet back" href="#/">${icon("back")}Mazzi</a></div>
    <h1>Nuova partita</h1>
    <form id="setup" class="stack-form">
      <fieldset class="mode-pick">
        <legend class="sr-only">Modalità</legend>
        ${NETOK ? `<label class="mode"><input type="radio" name="mode" value="net" ${mode === "net" ? "checked" : ""}>
          <span class="mode-body"><strong>Due telefoni</strong><span class="small muted">Ognuno sul suo telefono, anche a distanza: crei una stanza e mandi il link all'amico.</span></span></label>` : ""}
        <label class="mode"><input type="radio" name="mode" value="duo" ${mode === "duo" ? "checked" : ""}>
          <span class="mode-body"><strong>${ONLINE ? "Un telefono in due" : "Con un amico"}</strong><span class="small muted">Un telefono in due: la mano si vede solo quando tocca a te.</span></span></label>
        <label class="mode"><input type="radio" name="mode" value="solo" ${mode === "solo" ? "checked" : ""}>
          <span class="mode-body"><strong>Prova di velocità</strong><span class="small muted">Da solo, contro un avversario che non fa niente: in quanti turni gli togli 20 vite?</span></span></label>
      </fieldset>

      <section class="player-box zone">
        <h2>Giocatore 1</h2>
        <label class="field"><span>Nome</span><input type="text" name="n1" maxlength="20" value="${esc(prefs.n1 || "Bob")}"></label>
        <label class="field"><span>Mazzo</span><select name="d1">${options(d1)}</select></label>
        <div class="field"><span>Bustine</span>${sleeves("s1", prefs.s1 || "nero")}</div>
      </section>

      <section class="player-box zone" id="p2box">
        <h2>Giocatore 2</h2>
        <label class="field"><span>Nome</span><input type="text" name="n2" maxlength="20" value="${esc(prefs.n2 || "Amico")}"></label>
        <label class="field"><span>Mazzo</span><select name="d2">${options(d2)}</select></label>
        <div class="field"><span>Bustine</span>${sleeves("s2", prefs.s2 || "rosso")}</div>
      </section>

      <fieldset class="first-pick" id="firstbox">
        <legend>Chi inizia</legend>
        <div class="seg">
          <label><input type="radio" name="first" value="coin" checked><span>${icon("coin")}Moneta</span></label>
          <label><input type="radio" name="first" value="0"><span id="f1label">${esc(prefs.n1 || "Bob")}</span></label>
          <label><input type="radio" name="first" value="1"><span id="f2label">${esc(prefs.n2 || "Amico")}</span></label>
        </div>
      </fieldset>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-object btn-big" type="submit" id="go">${icon("play")}Inizia la partita</button>
    </form>
    ${NETOK ? `<section class="deck-section">
      <h2>Hai un codice?</h2>
      <form class="join-code" id="joinf">
        <label class="field"><span>Codice della stanza</span><input type="text" name="code" maxlength="4" autocomplete="off" autocapitalize="characters" pattern="[A-Za-z]{4}" placeholder="ABCD"></label>
        <button class="btn btn-big" type="submit">Entra</button>
      </form>
    </section>` : ""}
  </div>`;

  const form = root.querySelector("#setup");
  const sync = () => {
    const solo = form.mode.value === "solo";
    const net = form.mode.value === "net";
    root.querySelector("#p2box").hidden = solo || net;
    root.querySelector("#firstbox").hidden = solo || net;
    root.querySelector("#go").innerHTML = net ? `${icon("play")}Crea la stanza` : `${icon("play")}Inizia la partita`;
    root.querySelector("#f1label").textContent = form.n1.value || "Giocatore 1";
    root.querySelector("#f2label").textContent = form.n2.value || "Giocatore 2";
  };
  form.addEventListener("input", sync);
  sync();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = form.querySelector(".form-error");
    err.hidden = true;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (form.mode.value === "net") { await createRoom(form); return; }
      const solo = form.mode.value === "solo";
      const n1 = form.n1.value.trim() || "Giocatore 1";
      const n2 = form.n2.value.trim() || "Giocatore 2";
      store.set("setup", { mode: form.mode.value, n1, n2, d1: form.d1.value, d2: form.d2.value, s1: form.s1.value, s2: form.s2.value });
      const slugs = solo ? [form.d1.value] : [form.d1.value, form.d2.value];
      const decks = await Promise.all(slugs.map((s) => api.get(`/api/decks/${encodeURIComponent(s)}/table`)));
      for (const d of decks) {
        if (!d.main.length) throw new Error(`Il mazzo ${d.name} è vuoto.`);
      }
      let first = 0;
      if (!solo) {
        if (form.first.value === "coin") {
          first = Math.random() < 0.5 ? 0 : 1;
          toast(`Moneta: inizia ${first === 0 ? n1 : n2}.`, 3500);
        } else first = Number(form.first.value);
      }
      setDecks(decks);
      const players = [{ name: n1, sleeve: form.s1.value }];
      if (!solo) players.push({ name: n2, sleeve: form.s2.value });
      const state = newGame({ mode: solo ? "solo" : "duo", players, first });
      const view = await import("./view.js");
      view.startNew(state, decks);
      location.hash = "#/tavolo";
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  const joinf = root.querySelector("#joinf");
  if (joinf) {
    joinf.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = joinf.code.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) { toast("Il codice ha 4 lettere."); return; }
      location.hash = `#/stanza/${code}`;
    });
  }
}

// due telefoni: creo la stanza con il mio posto, poi l'amico entra con il link
async function createRoom(form) {
  const name = form.n1.value.trim() || "Giocatore 1";
  store.set("setup", { ...store.get("setup", {}), mode: "net", n1: name, d1: form.d1.value, s1: form.s1.value });
  const { rooms } = await import("../backend.js");
  const { rememberSeat } = await import("./net.js");
  const r = await rooms.create({ name, deck: form.d1.value, sleeve: form.s1.value });
  if (!r || !r.ok) throw new Error("Non riesco a creare la stanza.");
  rememberSeat(r.code, 0, name);
  location.hash = `#/stanza/${r.code}`;
}
