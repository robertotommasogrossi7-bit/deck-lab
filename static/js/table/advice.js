// Consiglio per il mulligan: terre, magie economiche, colori e chi inizia (linee di Frank Karsten).
// Solo un consiglio: la scelta resta al giocatore.
const COLOR_IT = { W: "bianco", U: "blu", B: "nero", R: "rosso", G: "verde" };
const n = (x, a, b) => `${x} ${x === 1 ? a : b}`;

// hand: [{ is_land, mv, cost, produces }] (le 7 carte pescate), m: mulligan gia' fatti,
// onPlay: inizia lui (con 2 terre conta molto)
export function mulliganAdvice(hand, m = 0, onPlay = false) {
  const size = 7 - m;
  const lands = hand.filter((c) => c && c.is_land);
  let spells = hand.filter((c) => c && !c.is_land).sort((a, b) => (a.mv ?? 0) - (b.mv ?? 0));
  let L = lands.length;
  // mulligan di Londra: si mettono in fondo m carte, prima le terre in piu', poi le magie piu' care
  for (let k = 0; k < m; k++) {
    if (L > Math.ceil(size / 2) || !spells.length) L--;
    else spells = spells.slice(0, -1);
  }
  const S = spells.length;
  const cheap = spells.filter((c) => (c.mv ?? 9) <= 2).length;
  const upTo3 = spells.filter((c) => (c.mv ?? 9) <= 3).length;
  const tail = colorNote(lands, spells);
  if (L === 0) return "Nessuna terra: mulligan.";
  if (size <= 4) return `Con ${size} carte di solito si tiene.${tail}`;
  if (L === 1) {
    return size === 5 && cheap >= 2 ? `Una terra sola e ${n(cheap, "magia economica", "magie economiche")}: rischiosa, decidi tu.`
      : "Una terra sola: mulligan.";
  }
  if (S <= 1) return "Troppe terre, quasi niente da giocare: mulligan.";
  if (L === 2 && size <= 6) return `Tienila: 2 terre su ${size} carte, un altro mulligan costa caro.${tail}`;
  if (L === 2) {
    const ok = onPlay ? cheap >= 2 || (cheap >= 1 && upTo3 >= 2) : cheap >= 1 || upTo3 >= 2;
    if (ok) return `Tienila: 2 terre, ma ${onPlay ? "anche se inizi tu " : "peschi per secondo e "}hai magie che costano poco.${tail}`;
    return onPlay ? `Rischiosa: 2 terre, inizi tu e hai poche magie economiche. Meglio il mulligan.${tail}`
      : `2 terre e magie care: peschi per secondo, si può tenere ma è rischiosa.${tail}`;
  }
  if (L >= 5 && S === 2) return `Tienila: ${n(L, "terra", "terre")} e 2 magie. Capita spesso con tante terre: conta che le 2 magie servano.${tail}`;
  return `Tienila: ${n(L, "terra", "terre")} e ${n(S, "magia", "magie")}.${tail}`;
}

// le magie fino a 3 mana chiedono un colore che nessuna terra in mano fa
function colorNote(lands, spells) {
  if (!lands.length) return "";
  const have = new Set(lands.flatMap((c) => String(c.produces || "").split("")));
  const need = new Set();
  for (const c of spells.filter((x) => (x.mv ?? 9) <= 3)) {
    for (const [, sym] of String(c.cost || "").matchAll(/\{([^}]+)\}/g)) if (/^[WUBRG]$/.test(sym)) need.add(sym);
  }
  const miss = [...need].filter((x) => !have.has(x));
  return miss.length ? ` Attento: nessuna terra fa il ${miss.map((x) => COLOR_IT[x]).join(" o il ")}.` : "";
}
