// Chiamate ai dati. Sul PC: il server di casa. Nella versione online: i file del sito (mazzi,
// prezzi, controlli) e Supabase (partite). Gli errori arrivano gia' in italiano.

export const ONLINE = !!(globalThis.DECKLAB && globalThis.DECKLAB.online);
// prova nel browser (pagina privata su Claude): un telefono solo, niente server delle partite
export const DEMO = !!(globalThis.DECKLAB && globalThis.DECKLAB.demo);

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Il PC non risponde. Controlla che Deck Lab sia acceso e che il telefono sia sulla stessa Wi-Fi.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* risposta vuota */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `Errore ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : "Richiesta non valida.");
  }
  return data;
}

// "/api/decks/x/price" -> "data/api/decks/x/price.json" (relativo alla pagina)
export function staticUrl(path, ext = "json") {
  return `data${path.split("?")[0]}.${ext}`;
}

async function getStatic(path) {
  let res;
  try { res = await fetch(staticUrl(path)); } catch {
    throw new Error("Non riesco a caricare i dati: controlla la connessione.");
  }
  if (res.status === 404) throw new Error("Non trovato: forse il mazzo non è nella versione online.");
  if (!res.ok) throw new Error(`Errore ${res.status} nel caricare i dati.`);
  return res.json();
}

async function online(method, path, body) {
  const [p, qs] = path.split("?");
  const q = new URLSearchParams(qs || "");
  if (method === "GET") {
    let m;
    if (p === "/api/games" || (m = p.match(/^\/api\/games\/(\d+)$/)) || (m = p.match(/^\/api\/decks\/([^/]+)\/games$/))) {
      const { backend } = await import("./backend.js");
      if (p === "/api/games") return { games: await backend.listGames(q.get("deck"), Number(q.get("limit") || 100)) };
      if (p.startsWith("/api/games/")) return backend.getGame(Number(m[1]));
      return backend.deckGames(decodeURIComponent(m[1]));
    }
    return getStatic(p);
  }
  if (method === "POST" && p === "/api/games") {
    const { backend } = await import("./backend.js");
    return backend.saveGame(body);
  }
  throw new Error("Nella versione online questa funzione non c'è ancora: si usa sul PC di casa.");
}

const route = (method, path, body) => (ONLINE ? online(method, path, body) : call(method, path, body));
const cache = new Map();

export const api = {
  get: (p) => route("GET", p),
  post: (p, b) => route("POST", p, b || {}),
  put: (p, b) => route("PUT", p, b || {}),
  del: (p) => route("DELETE", p),
  // per le risposte lente e stabili (controlli del mazzo, matchup): una volta per sessione
  async cached(p) {
    if (!cache.has(p)) cache.set(p, route("GET", p).catch((e) => { cache.delete(p); throw e; }));
    return cache.get(p);
  },
  forget(prefix) { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); },
  // indirizzo di un file da aprire (la scheda PDF)
  file(p, ext) { return ONLINE ? staticUrl(p, ext) : p; },
};
