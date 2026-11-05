// Piccoli attrezzi condivisi: testo sicuro, icone, formati italiani, fogli e avvisi.

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

// ---- icone (linea, ereditano il colore) ------------------------------------------------------
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  library: '<rect x="6" y="3.5" width="12" height="16" rx="1.5"/><path d="M4 7v12.5A1.5 1.5 0 0 0 5.5 21H15"/>',
  graveyard: '<path d="M6.5 20.5V10a5.5 5.5 0 0 1 11 0v10.5"/><path d="M4 20.5h16M12 9v6M9.5 11.5h5"/>',
  exile: '<rect x="4" y="6" width="11" height="14" rx="1.5"/><path d="M13 3h8v8M21 3l-8.5 8.5"/>',
  hand: '<rect x="3.5" y="7" width="8" height="12" rx="1.2" transform="rotate(-14 7.5 13)"/><rect x="8" y="5" width="8" height="12" rx="1.2"/><rect x="12.5" y="7" width="8" height="12" rx="1.2" transform="rotate(14 16.5 13)"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  diary: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  draw: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M12 8v7M9 12.5l3 3 3-3"/>',
  attack: '<path d="M5 19L19 5M14 5h5v5"/><path d="M5 14l5 5"/>',
  pass: '<path d="M4 12h12M12 7l5 5-5 5"/><path d="M20 5v14"/>',
  doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4M10 13h5M10 16.5h5"/>',
  chart: '<path d="M4 20h16M7 20v-6M12 20V8M17 20v-9"/>',
  play: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><rect x="9" y="8" width="6" height="8" rx="1"/>',
  score: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M12 3.5v17M5 9h14"/>',
  shuffle: '<path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.2 3.4-2.8M13.1 9.8C13.9 8.2 14.9 7 16.5 7H20"/><path d="M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 4v7h-7"/>',
  token: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M7.5 12h9"/>',
  tap: '<rect x="4" y="7" width="16" height="11" rx="1.5"/><path d="M9 3.5h6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  life: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  die: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.6 8.6h.01M15.4 8.6h.01M12 12h.01M8.6 15.4h.01M15.4 15.4h.01" stroke-width="2.6"/>',
  resume: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  tools: '<path d="M15 3.5a4.5 4.5 0 0 0-4.3 5.9L3.5 16.6l3.9 3.9 7.2-7.2A4.5 4.5 0 0 0 20.5 9l-2.8 2.8-3-.5-.5-3z"/>',
};

export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
}

// ---- numeri e parole --------------------------------------------------------------------------
const nf2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const eur = (x, dec = 2) => (x == null ? "—" : `${(dec ? nf2 : nf0).format(x)} €`);
export const pct = (x, dec = 0) => (x == null ? "—" : `${dec ? nf1.format(x * 100) : nf0.format(x * 100)}%`);
export const n1 = (x) => (x == null ? "—" : nf1.format(x));
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "a Bob", "ad Amico": davanti a un nome che comincia per a si scrive "ad"
export const aName = (name) => `${/^[aàAÀ]/.test(String(name || "")) ? "ad" : "a"} ${name}`;

export function dateIt(iso) {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

export const COLOR_NAME = { W: "bianco", U: "blu", B: "nero", R: "rosso", G: "verde" };

export function pips(colors) {
  if (!colors) return "";
  return `<span class="pips" aria-label="${esc(colorsWords(colors))}">${[...colors]
    .map((c) => `<span class="pip ${c}"></span>`).join("")}</span>`;
}

export function colorsWords(colors) {
  if (!colors) return "incolore";
  const w = [...colors].map((c) => COLOR_NAME[c]);
  return w.length === 1 ? `mono${w[0]}` : w.join("-");
}

// "{2}{W}{B}" -> simboli
export function cost(c) {
  if (!c) return "";
  const parts = c.match(/\{[^}]+\}/g) || [];
  return `<span class="cost" aria-label="costo ${esc(c.replace(/[{}]/g, " ").trim())}">${parts.map((p) => {
    const s = p.slice(1, -1);
    if (/^[WUBRG]$/.test(s)) return `<span class="sym ${s}">${s}</span>`;
    if (/^[WUBRG]\/[WUBRGP]$/.test(s)) {
      const [a, b] = s.split("/");
      return `<span class="sym H" style="--a:var(--c-${a});--b:var(--c-${b === "P" ? "C" : b})">${s.replace("/", "")}</span>`;
    }
    return `<span class="sym">${esc(s)}</span>`;
  }).join("")}</span>`;
}

// ---- carte -----------------------------------------------------------------------------------
export function cardName(info, name) {
  return (info && info.it) || (info && info.name) || name || "";
}

// colore della cornice: W U B R G, M = multicolore, C = incolore, L = terra
export function frameKey(info) {
  if (!info) return "C";
  if (info.is_land) return "L";
  const c = info.colors || "";
  if (c.length > 1) return "M";
  return c || "C";
}

export function typeIt(info) {
  if (!info) return "";
  if (info.type_it) return info.type_it;
  const T = { Creature: "Creatura", Land: "Terra", Instant: "Istantaneo", Sorcery: "Stregoneria",
    Enchantment: "Incantesimo", Artifact: "Artefatto", Planeswalker: "Planeswalker", Battle: "Battaglia",
    Kindred: "Tribale" };
  const S = { Legendary: "Leggendario", Basic: "Base", Snow: "Neve" };
  return [...(info.supertypes || []).map((x) => S[x] || x), ...(info.types || []).map((x) => T[x] || x)].join(" ");
}

export const GROUPS = [
  ["Creature", "Creature"], ["Planeswalker", "Planeswalker"], ["Battle", "Battaglie"],
  ["Instant", "Istantanei"], ["Sorcery", "Stregonerie"], ["Artifact", "Artefatti"],
  ["Enchantment", "Incantesimi"], ["Land", "Terre"],
];

export function groupOf(info) {
  if (!info) return "Altro";
  if (info.is_land) return "Terre";
  for (const [k, v] of GROUPS) if ((info.types || []).includes(k)) return v;
  return "Altro";
}

// ---- memoria del browser (solo comodita': puo' mancare) --------------------------------------
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(`decklab:${key}`); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`decklab:${key}`, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  del(key) { try { localStorage.removeItem(`decklab:${key}`); } catch { /* niente */ } },
};

// ---- avvisi e fogli --------------------------------------------------------------------------
let toastTimer = null;
export function toast(msg, ms = 2600) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Foglio che sale dal basso. Si chiude con la X, toccando fuori, con Esc e con il tasto Indietro
// del telefono (che cosi' non fa uscire dalla partita). Cambiando pagina si chiudono tutti.
const openSheets = [];
let popSkip = 0;
let sheetSeq = 0;
if (typeof window !== "undefined") {      // (i test del motore girano in Node, senza pagina)
  window.addEventListener("popstate", () => {
    if (popSkip) { popSkip--; return; }
    const top = openSheets[openSheets.length - 1];
    if (top) top.close({ fromHistory: true });
  });
  window.addEventListener("hashchange", () => { [...openSheets].reverse().forEach((x) => x.close({ fromHistory: true })); });
}

export function openSheet(html, { onClose, label = "Dettagli" } = {}) {
  const back = document.createElement("div");
  back.className = "sheet-back";
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <button class="btn btn-quiet btn-round close" data-sheet-close aria-label="Chiudi">${icon("close")}</button>
    <div class="sheet-body">${html}</div></div>`;
  const prevFocus = document.activeElement;
  const seq = ++sheetSeq;
  try { history.pushState({ dlSheet: seq }, ""); } catch { /* niente storia: pazienza */ }
  const entry = {};
  const close = ({ fromHistory = false } = {}) => {
    if (!back.isConnected) return;
    back.remove();
    const k = openSheets.indexOf(entry);
    if (k >= 0) openSheets.splice(k, 1);
    document.removeEventListener("keydown", onKey);
    if (!fromHistory && history.state && history.state.dlSheet === seq) { popSkip++; history.back(); }
    if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus();
    if (onClose) onClose();
  };
  entry.close = close;
  openSheets.push(entry);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest("[data-sheet-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  const first = back.querySelector(".sheet-body button, .sheet-body a, .sheet-body input, .sheet-body select");
  (first || back.querySelector(".close")).focus();
  return { el: back.querySelector(".sheet"), body: back.querySelector(".sheet-body"), close };
}

export function confirmSheet(title, text, okLabel, { danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet(`<h2>${esc(title)}</h2><p class="muted" style="margin-top:8px">${esc(text)}</p>
      <div class="row-actions" style="margin-top:18px">
        <button class="btn btn-object btn-big" data-ok>${esc(okLabel)}</button>
        <button class="btn btn-big" data-sheet-close>Annulla</button></div>`,
    { label: title, onClose: () => { if (!done) resolve(false); } });
    s.el.querySelector("[data-ok]").addEventListener("click", () => { done = true; s.close(); resolve(true); });
    if (danger) s.el.querySelector("[data-ok]").classList.add("danger");
  });
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
