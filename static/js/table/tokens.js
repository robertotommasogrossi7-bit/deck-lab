// Pedine che si vedono nello Standard di oggi (dai mazzi del gauntlet) e cosa sanno fare.
// Formato come gli script delle carte (decklab/SCRIPTS.md): types inglesi, keywords inglesi,
// abilities/triggers con "do". name_it e' il nome che si legge sul tavolo.

const sac = (mana, tap, text_it, effects) => ({
  id: "tk", cost: { mana, tap, sacrifice_self: true, life: 0, loyalty: null, discard: 0 },
  do: effects, text: text_it, text_it, auto: effects.every((e) => !e.note && !e.explore && !e.search),
});

// abilita' delle pedine artefatto: Forge non le scrive negli script, le aggiungiamo qui per nome
export const TOKEN_EXTRAS = {
  Treasure: { text: "{T}, sacrifica: aggiungi un mana di un colore a scelta.",
    abilities: [{ ...sac("", true, "Aggiungi un mana di un colore a scelta.", []), mana: true }] },
  Food: { text: "{2}, {T}, sacrifica: guadagni 3 punti vita.",
    abilities: [sac("2", true, "Guadagni 3 punti vita.", [{ gain_life: 3 }])] },
  Clue: { text: "{2}, sacrifica: pesca una carta.",
    abilities: [sac("2", false, "Pesca una carta.", [{ draw: 1 }])] },
  Map: { text: "{1}, {T}, sacrifica: una creatura che controlli esplora. Solo come stregoneria.",
    abilities: [sac("1", true, "Una creatura che controlli esplora (solo come stregoneria).", [{ explore: "target" }])] },
  Lander: { text: "{2}, {T}, sacrifica: cerca una terra base, mettila in campo tappata, poi mescola.",
    abilities: [sac("2", true, "Cerca una terra base e mettila in campo tappata, poi mescola.", [{ search: { basic_land: true, tapped: true } }])] },
};

export const JACE_TOKEN = {
  name: "Jace", name_it: "Jace", types: "Planeswalker Jace", colors: "U",
  text: "[−1]: Sorveglia 1.\n[−3]: Pesca una carta.",
  abilities: [
    { id: "j1", cost: { loyalty: -1 }, do: [{ surveil: 1 }], text: "Sorveglia 1.", text_it: "Sorveglia 1.", auto: false },
    { id: "j2", cost: { loyalty: -3 }, do: [{ draw: 1 }], text: "Pesca una carta.", text_it: "Pesca una carta.", auto: true },
  ],
};

const pest = {
  id: "t1", when: { event: "attacks", who: "self", controller: "any", types: [] }, if: null, do: [{ gain_life: 1 }],
  text: "Whenever this token attacks, you gain 1 life.", text_it: "Ogniqualvolta questa pedina attacca, guadagni 1 punto vita.", auto: true,
};

// catalogo del menu "Crea una pedina": gruppi, poi pedine. `opts` sono le scelte gia' fatte
// (es. mobilitare: tappate, attaccanti e se ne vanno a fine turno).
export const TOKEN_CATALOG = [
  { group: "Artefatti", items: [
    { name: "Treasure", name_it: "Tesoro", types: "Artifact Treasure" },
    { name: "Food", name_it: "Cibo", types: "Artifact Food" },
    { name: "Clue", name_it: "Indizio", types: "Artifact Clue" },
    { name: "Map", name_it: "Mappa", types: "Artifact Map" },
    { name: "Lander", name_it: "Lander", types: "Artifact Lander" },
  ] },
  { group: "Creature", items: [
    { name: "Warrior", name_it: "Guerriero", pt: "1/1", colors: "R", types: "Creature Warrior",
      opts: { attacking: true, sacAtEnd: true }, note: "mobilitare: tappata, attacca, se ne va a fine turno" },
    { name: "Fish", name_it: "Pesce", pt: "1/1", colors: "U", types: "Creature Fish" },
    { name: "Illusion", name_it: "Illusione", pt: "1/1", colors: "U", types: "Creature Illusion" },
    { name: "Otter", name_it: "Lontra", pt: "1/1", colors: "UR", types: "Creature Otter", keywords: ["Prowess"] },
    { name: "Monk", name_it: "Monaco", pt: "1/1", colors: "W", types: "Creature Monk", keywords: ["Prowess"] },
    { name: "Spirit", name_it: "Spirito", pt: "1/1", colors: "W", types: "Creature Spirit" },
    { name: "Spirit", name_it: "Spirito", pt: "1/1", colors: "W", types: "Creature Spirit", keywords: ["Flying"] },
    { name: "Soldier", name_it: "Soldato", pt: "1/1", colors: "W", types: "Creature Soldier" },
    { name: "Bat", name_it: "Pipistrello", pt: "1/1", colors: "B", types: "Creature Bat", keywords: ["Flying"] },
    { name: "Pest", name_it: "Peste", pt: "1/1", colors: "BG", types: "Creature Pest", triggers: [pest] },
    { name: "Zombie", name_it: "Zombie", pt: "2/2", colors: "B", types: "Creature Zombie" },
    { name: "Treefolk", name_it: "Silvantropo", pt: "3/4", colors: "G", types: "Creature Treefolk", keywords: ["Reach"] },
    { name: "Beast", name_it: "Bestia", pt: "4/4", colors: "G", types: "Creature Beast", keywords: ["Trample"] },
    { name: "Scorpion Dragon", name_it: "Drago Scorpione", pt: "4/4", colors: "R", types: "Creature Scorpion Dragon", keywords: ["Flying", "Haste"] },
    { name: "Dragon", name_it: "Drago", pt: "4/4", colors: "R", types: "Creature Dragon", keywords: ["Flying"],
      text: "Firebending 4 (quando attacca aggiungi {R}{R}{R}{R} fino alla fine del combattimento)." },
    { name: "Dragon", name_it: "Drago", pt: "6/6", colors: "R", types: "Creature Dragon", keywords: ["Flying"] },
  ] },
  { group: "Artefatti creatura", items: [
    { name: "Gnome", name_it: "Gnomo", pt: "1/1", types: "Artifact Creature Gnome" },
    { name: "Robot", name_it: "Robot", pt: "2/2", types: "Artifact Creature Robot" },
    { name: "Doombot", name_it: "Destinobot", pt: "3/3", types: "Artifact Creature Robot Villain" },
    { name: "Construct", name_it: "Costrutto", pt: "0/0", types: "Artifact Creature Construct", dyn: "artifacts" },
  ] },
  { group: "Planeswalker", items: [
    { ...JACE_TOKEN, special: "jace", note: "potenzia Jace: segnalini fedeltà sulla tua pedina Jace (la crea se non c'è)" },
  ] },
];

// parole chiave che l'host puo' dare o togliere (nome inglese del motore)
export const KEYWORDS = ["Flying", "Trample", "Lifelink", "Deathtouch", "Vigilance", "Haste", "First Strike",
  "Double Strike", "Reach", "Menace", "Hexproof", "Indestructible", "Defender", "Ward", "Prowess"];

// segnalini che capitano spesso, oltre a +1/+1 e -1/-1
export const COUNTER_KINDS = ["STUN", "SHIELD", "LOYALTY", "LORE", "CHARGE", "OIL", "FINALITY", "TIME", "QUEST",
  "NET", "FLYING", "TRAMPLE", "DEATHTOUCH", "LIFELINK", "FIRST_STRIKE", "HEXPROOF", "INDESTRUCTIBLE", "REACH",
  "MENACE", "VIGILANCE", "HASTE"];

// segnalini parola chiave: danno la parola chiave finche' ci sono
export const COUNTER_KEYWORD = { FLYING: "Flying", TRAMPLE: "Trample", DEATHTOUCH: "Deathtouch", LIFELINK: "Lifelink",
  FIRST_STRIKE: "First Strike", HEXPROOF: "Hexproof", INDESTRUCTIBLE: "Indestructible", REACH: "Reach",
  MENACE: "Menace", VIGILANCE: "Vigilance", HASTE: "Haste" };
