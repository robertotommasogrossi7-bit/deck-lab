// Versione online: partite e stanze a due telefoni su Supabase, oppure sul server di prova in
// locale (config: devBackend). Le funzioni SQL stanno in supabase/deck_lab.sql.

const CFG = globalThis.DECKLAB || {};
const DEV = !!CFG.devBackend;

export class NetError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (!DEV) {
    h.apikey = CFG.supabaseKey;
    if (String(CFG.supabaseKey || "").startsWith("eyJ")) h.Authorization = `Bearer ${CFG.supabaseKey}`;
  }
  return h;
}

export async function rpc(fn, args = {}) {
  if (CFG.demo) throw new NetError("Nella prova nel browser le partite non si salvano: si salvano nell'app vera.", "config");
  if (!DEV && !CFG.supabaseUrl) throw new NetError("Questa versione non è ancora collegata al server delle partite.", "config");
  const base = DEV ? CFG.devBackend : CFG.supabaseUrl;
  let res;
  try {
    res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(), body: JSON.stringify(args) });
  } catch {
    throw new NetError("Senza rete: non raggiungo il server delle partite.", "offline");
  }
  let data = null;
  try { data = await res.json(); } catch { /* vuota */ }
  if (!res.ok) {
    if (res.status >= 500) throw new NetError("Il server delle partite non risponde: forse è in pausa su Supabase.", "down");
    throw new NetError((data && (data.message || data.error)) || `Errore ${res.status}`, "server");
  }
  return data;
}

// ---- partite salvate ------------------------------------------------------------------------
function wilson(k, n) {
  if (!n) return [null, null];
  const z = 1.959963984540054;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.round(((c - r) / d) * 1000) / 1000, Math.round(((c + r) / d) * 1000) / 1000];
}

// come game_stats in decklab/services.py
export function gameStats(deck, rows) {
  const duo = rows.filter((r) => r.mode === "duo" && (r.winner === 1 || r.winner === 2));
  const byOpp = new Map();
  const tot = { won: 0, lost: 0, play_won: 0, play_n: 0, draw_won: 0, draw_n: 0 };
  for (const r of duo) {
    const me = r.p1_deck === deck ? 1 : 2;
    const opp = me === 1 ? r.p2_deck : r.p1_deck;
    const won = r.winner === me;
    const key = opp || "?";
    if (!byOpp.has(key)) byOpp.set(key, { opponent: opp, won: 0, lost: 0 });
    const b = byOpp.get(key);
    b[won ? "won" : "lost"]++;
    tot[won ? "won" : "lost"]++;
    if (r.first_player === 1 || r.first_player === 2) {
      const k = r.first_player === me ? "play" : "draw";
      tot[`${k}_n`]++;
      tot[`${k}_won`] += won ? 1 : 0;
    }
  }
  const turns = rows.filter((r) => r.mode === "solo" && r.p1_deck === deck && r.winner === 1 && r.turns)
    .map((r) => r.turns).sort((a, b) => a - b);
  let speed = null;
  if (turns.length) {
    const dist = {};
    for (const t of turns) dist[t] = (dist[t] || 0) + 1;
    speed = {
      runs: turns.length, avg: Math.round((turns.reduce((a, b) => a + b, 0) / turns.length) * 100) / 100,
      median: turns[Math.floor(turns.length / 2)], best: turns[0],
      by_turn: Object.fromEntries(Object.keys(dist).map(Number).sort((a, b) => a - b).map((t) => [String(t), dist[t]])),
    };
  }
  const byOpponent = [...byOpp.values()].map((b) => {
    const n = b.won + b.lost;
    const [lo, hi] = wilson(b.won, n);
    return { ...b, n, ci_low: lo, ci_high: hi };
  }).sort((a, b) => b.n - a.n);
  return { deck, games: duo.length, ...tot, by_opponent: byOpponent, speed };
}

export const backend = {
  saveGame: (g) => rpc("game_save", { p_game: g }),
  async listGames(deck, limit = 100) {
    return (await rpc("games_list", { p_deck: deck || null, p_limit: limit })) || [];
  },
  async getGame(id) {
    const g = await rpc("game_get", { p_id: id });
    if (!g) throw new Error("Partita non trovata.");
    return g;
  },
  async deckGames(slug) {
    const games = await this.listGames(slug, 5000);
    return { stats: gameStats(slug, games), games: games.slice(0, 50) };
  },
};

// ---- stanze ----------------------------------------------------------------------------------
export const rooms = {
  create: (seat) => rpc("room_create", { p_seat: seat }),
  join: (code, seat) => rpc("room_join", { p_code: code, p_seat: seat }),
  get: (code) => rpc("room_get", { p_code: code }),
  version: (code) => rpc("room_version", { p_code: code }),
  push: (code, base, state, kind, seat) => rpc("room_push", { p_code: code, p_base: base, p_state: state, p_kind: kind, p_seat: seat }),
  undo: (code, base, seat) => rpc("room_undo", { p_code: code, p_base: base, p_seat: seat }),
  setSeat: (code, seat, info) => rpc("room_seat", { p_code: code, p_index: seat, p_seat: info }),
};

// ---- avvisi in tempo reale: "c'e' una versione nuova" e chi e' collegato ----------------------
let sbPromise = null;
function supabaseClient() {
  if (!sbPromise) {
    sbPromise = new Promise((resolve) => {
      const make = () => {
        try {
          resolve(globalThis.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          }));
        } catch { resolve(null); }
      };
      if (globalThis.supabase) { make(); return; }
      const s = document.createElement("script");
      s.src = "static/vendor/supabase.js";
      s.onload = () => (globalThis.supabase ? make() : resolve(null));
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return sbPromise;
}

export async function listen(code, me, { onVersion, onPresence }) {
  if (DEV) {
    const url = `${CFG.devBackend}/dev/events?room=${encodeURIComponent(code)}&seat=${me.seat}&name=${encodeURIComponent(me.name || "")}`;
    const es = new EventSource(url);
    es.addEventListener("v", (e) => { try { onVersion(JSON.parse(e.data)); } catch { /* ignora */ } });
    es.addEventListener("presence", (e) => { try { if (onPresence) onPresence(JSON.parse(e.data)); } catch { /* ignora */ } });
    return {
      send: (payload) => fetch(`${CFG.devBackend}/dev/broadcast`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: code, from: me.seat, payload }),
      }).catch(() => {}),
      close: () => es.close(),
    };
  }
  const client = await supabaseClient();
  if (!client) return { send() {}, close() {} };
  const ch = client.channel(`room:${code}`, { config: { broadcast: { self: false }, presence: { key: String(me.seat) } } });
  ch.on("broadcast", { event: "v" }, ({ payload }) => onVersion(payload || {}));
  ch.on("presence", { event: "sync" }, () => {
    if (onPresence) onPresence(Object.keys(ch.presenceState()).map(Number).filter((x) => !Number.isNaN(x)));
  });
  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") { try { await ch.track({ seat: me.seat, name: me.name }); } catch { /* ignora */ } }
  });
  return {
    send: (payload) => ch.send({ type: "broadcast", event: "v", payload }).catch(() => {}),
    close: () => { try { client.removeChannel(ch); } catch { /* ignora */ } },
  };
}
