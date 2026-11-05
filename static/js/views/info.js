// Impostazioni: colore del tappetino, indirizzo per il telefono o link dell'app (con QR), crediti.
import { api, ONLINE } from "../api.js";
import { esc, icon, store, toast } from "../ui.js";

export const VIEW = "hub";

const MATS = [["", "Ardesia", "#24425b"], ["verde", "Bosco", "#2b4737"], ["prugna", "Prugna", "#43314f"],
  ["vino", "Vino", "#552b32"], ["grafite", "Grafite", "#33373c"]];

const appUrl = () => `${location.origin}${location.pathname}`;

function phoneSection(info) {
  if (ONLINE) {
    return `<section class="deck-section">
      <h2>Manda l'app a un amico</h2>
      <p class="muted small">Basta il link: si apre nel browser del telefono, anche lontano da te.</p>
      <div class="qr-box">
        <div class="qr" id="qr" aria-hidden="true"></div>
        <p class="qr-addr num">${esc(appUrl())}</p>
      </div>
      <div class="row-actions"><button class="btn btn-object" data-act="share">Manda il link</button></div>
      <h3 class="sheet-h">Metterla nella schermata Home</h3>
      <ul class="credits small">
        <li>iPhone: apri il link con Safari, tocca Condividi, poi «Aggiungi alla schermata Home».</li>
        <li>Android: apri il link con Chrome, tocca il menu ⋮, poi «Aggiungi a schermata Home» o «Installa app».</li>
      </ul>
    </section>`;
  }
  return `<section class="deck-section">
      <h2>Sul telefono</h2>
      <p class="muted small">Il telefono deve essere sulla stessa Wi-Fi del PC. Inquadra il codice con la fotocamera, oppure scrivi l'indirizzo nel browser.</p>
      <div class="qr-box">
        <div class="qr" id="qr" aria-hidden="true"></div>
        <p class="qr-addr num">${esc(info.address || "")}</p>
      </div>
      ${(info.others || []).length ? `<p class="micro">Se il telefono non lo apre, prova: ${info.others.map((u) => `<strong>${esc(u)}</strong>`).join(" oppure ")}. Il PC ha più di una rete (per esempio una VPN).</p>` : ""}
      <p class="micro">Se il telefono non lo apre: la prima volta Windows chiede se far passare Python dal firewall, rispondi «Consenti» per le reti private.</p>
    </section>`;
}

// condividi un link: il foglio del telefono (WhatsApp...) se c'e', altrimenti lo copio
export async function shareLink(url, text) {
  if (navigator.share) {
    try { await navigator.share({ title: "Deck Lab", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copiato: incollalo dove vuoi."); } catch { toast(url, 8000); }
}

export async function render(root) {
  const info = await api.get("/api/info").catch(() => ({}));
  const cur = store.get("mat") || "";
  root.innerHTML = `<div class="page narrow">
    <div class="topbar"><a class="btn btn-quiet back" href="#/">${icon("back")}Mazzi</a></div>
    <h1>Impostazioni</h1>

${phoneSection(info)}

    <section class="deck-section">
      <h2>Colore del tappetino</h2>
      <div class="mat-pick" role="radiogroup" aria-label="Colore del tappetino">
        ${MATS.map(([k, label, hex]) => `<label class="mat-sw"><input type="radio" name="mat" value="${k}" ${k === cur ? "checked" : ""}>
          <span class="mat-chip" style="background-color:${hex}"></span><span>${label}</span></label>`).join("")}
      </div>
    </section>

    <section class="deck-section">
      <h2>Da dove vengono i dati</h2>
      <ul class="credits small">
        <li>Testi e nomi italiani delle carte, legalità: i file di Forge installati sul PC (${esc((info.forge || "").split("|")[0].replace("forge-gui-desktop-", "Forge ").replace("-jar-with-dependencies.jar", ""))}).</li>
        <li>Prezzi: listino pubblico giornaliero di Cardmarket, prezzo di tendenza.</li>
        <li>Matchup e quote del metagame: MTGDecks.net, scaricati il 24 ottobre 2026.</li>
        <li>Numeri del mana: il metodo di Frank Karsten (mulligan, fonti di colore, numero di terre).</li>
        <li>Carattere: Atkinson Hyperlegible Next, del Braille Institute (licenza SIL OFL).</li>
      </ul>
      <p class="footer-note">${esc(info.disclaimer || "")}</p>
    </section>
  </div>`;

  const qrEl = root.querySelector("#qr");
  const qrText = ONLINE ? appUrl() : info.address;
  root.querySelector("[data-act=share]")?.addEventListener("click", () => shareLink(appUrl(), "Deck Lab: per provare i mazzi di Magic insieme."));
  if (qrText) {
    try {
      const { default: qrcode } = await import("../../vendor/qrcode.mjs");
      const qr = qrcode(0, "M");
      qr.addData(qrText);
      qr.make();
      qrEl.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch { qrEl.hidden = true; }
  }
  root.querySelector(".mat-pick").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v) document.documentElement.dataset.mat = v; else delete document.documentElement.dataset.mat;
    store.set("mat", v);
    toast("Tappetino cambiato.");
  });
}
