// Service worker della versione online: tiene in memoria l'app e i dati dei mazzi, cosi' si apre
// subito e funziona anche senza rete (partita con un telefono). Supabase non passa da qui.
const VERSION = "202611052018-b77b17ca";
const CACHE = `decklab-${VERSION}`;
const PRECACHE = ["./", "index.html", "config.js", "manifest.webmanifest", "data/api/decks/4c-control/checks.json", "data/api/decks/4c-control/matchups.json", "data/api/decks/4c-control/price.json", "data/api/decks/4c-control/table.json", "data/api/decks/4c-control.json", "data/api/decks/azorius-artifacts/checks.json", "data/api/decks/azorius-artifacts/matchups.json", "data/api/decks/azorius-artifacts/price.json", "data/api/decks/azorius-artifacts/table.json", "data/api/decks/azorius-artifacts.json", "data/api/decks/azorius-control/checks.json", "data/api/decks/azorius-control/matchups.json", "data/api/decks/azorius-control/price.json", "data/api/decks/azorius-control/table.json", "data/api/decks/azorius-control.json", "data/api/decks/boros-dragons/checks.json", "data/api/decks/boros-dragons/matchups.json", "data/api/decks/boros-dragons/price.json", "data/api/decks/boros-dragons/table.json", "data/api/decks/boros-dragons.json", "data/api/decks/dimir-midrange/checks.json", "data/api/decks/dimir-midrange/matchups.json", "data/api/decks/dimir-midrange/price.json", "data/api/decks/dimir-midrange/table.json", "data/api/decks/dimir-midrange.json", "data/api/decks/dimir-reanimator/checks.json", "data/api/decks/dimir-reanimator/matchups.json", "data/api/decks/dimir-reanimator/price.json", "data/api/decks/dimir-reanimator/table.json", "data/api/decks/dimir-reanimator.json", "data/api/decks/dimir-uldaros/checks.json", "data/api/decks/dimir-uldaros/matchups.json", "data/api/decks/dimir-uldaros/price.json", "data/api/decks/dimir-uldaros/table.json", "data/api/decks/dimir-uldaros-ac13/checks.json", "data/api/decks/dimir-uldaros-ac13/matchups.json", "data/api/decks/dimir-uldaros-ac13/price.json", "data/api/decks/dimir-uldaros-ac13/table.json", "data/api/decks/dimir-uldaros-ac13.json", "data/api/decks/dimir-uldaros.json", "data/api/decks/izzet-prowess/checks.json", "data/api/decks/izzet-prowess/matchups.json", "data/api/decks/izzet-prowess/price.json", "data/api/decks/izzet-prowess/table.json", "data/api/decks/izzet-prowess.json", "data/api/decks/izzet-spellementals/checks.json", "data/api/decks/izzet-spellementals/matchups.json", "data/api/decks/izzet-spellementals/price.json", "data/api/decks/izzet-spellementals/table.json", "data/api/decks/izzet-spellementals.json", "data/api/decks/jund-sacrifice/checks.json", "data/api/decks/jund-sacrifice/matchups.json", "data/api/decks/jund-sacrifice/price.json", "data/api/decks/jund-sacrifice/table.json", "data/api/decks/jund-sacrifice.json", "data/api/decks/mono-green-landfall/checks.json", "data/api/decks/mono-green-landfall/matchups.json", "data/api/decks/mono-green-landfall/price.json", "data/api/decks/mono-green-landfall/table.json", "data/api/decks/mono-green-landfall.json", "data/api/decks/orzhov-lifegain/checks.json", "data/api/decks/orzhov-lifegain/matchups.json", "data/api/decks/orzhov-lifegain/price.json", "data/api/decks/orzhov-lifegain/table.json", "data/api/decks/orzhov-lifegain.json", "data/api/decks.json", "data/api/info.json", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "static/css/base.css", "static/css/hub.css", "static/css/table.css", "static/fonts/LICENSE-atkinson.txt", "static/fonts/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2", "static/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2", "static/img/icona.svg", "static/img/tessuto.png", "static/js/api.js", "static/js/backend.js", "static/js/main.js", "static/js/package.json", "static/js/table/effects.js", "static/js/table/engine.js", "static/js/table/host.js", "static/js/table/lobby.js", "static/js/table/net.js", "static/js/table/setup.js", "static/js/table/tokens.js", "static/js/table/view.js", "static/js/ui.js", "static/js/views/deck.js", "static/js/views/decks.js", "static/js/views/games.js", "static/js/views/info.js", "static/js/views/lab.js", "static/vendor/qrcode.mjs", "static/vendor/supabase.LICENSE.txt", "static/vendor/supabase.js"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // un file che manca non deve bloccare l'installazione
    await Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("decklab-")) await caches.delete(k);
    await self.clients.claim();
  })());
});

// pagina e configurazione: prima la rete (aggiornamenti), poi la copia; il resto: prima la copia
const NETWORK_FIRST = /(\/|index\.html|config\.js|manifest\.webmanifest)$/;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (NETWORK_FIRST.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.pathname.includes("/static/") || url.pathname.includes("/data/"))) {
      (await caches.open(CACHE)).put(req, res.clone());
    }
    return res;
  })());
});
