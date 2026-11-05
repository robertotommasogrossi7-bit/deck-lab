// Partita a due telefoni. La partita sta sul server a versioni: ogni mossa parte dall'ultima
// versione conosciuta; se nel frattempo l'altro ha mosso, il telefono riprende lo stato nuovo e
// rifa' sopra le sue mosse. Gli avvisi in tempo reale accelerano, il controllo periodico
// garantisce che prima o poi ci si allinei comunque.
import { listen, rooms } from "../backend.js";
import { store } from "../ui.js";

// ---- il mio posto nella stanza (solo su questo telefono) -------------------------------------
export function mySeatIn(code) {
  const n = store.get("net");
  return n && code && n.code === code ? n : null;
}
export function rememberSeat(code, seat, name) { store.set("net", { code, seat, name }); }
export function forgetSeat() { store.set("net", null); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RoomSync {
  // getState/setState: lo stato della vista; replay(fn) rifa' una mossa sullo stato corrente;
  // onRemote(info): e' arrivato uno stato nuovo dall'altro telefono (va ridisegnato)
  constructor({ code, seat, name, getState, setState, replay, onRemote, onStatus, onPresence }) {
    Object.assign(this, { code, seat, name, getState, setState, replay, onRemote, onStatus, onPresence });
    this.version = -1;
    this.pending = [];            // mosse fatte qui e non ancora confermate: [{fn, kind}]
    this.flushing = false;
    this.fetching = false;
    this.stopped = false;
    this.link = null;
    this.timer = null;
    this.online = [];
    this.status = "ok";
    this.onVisible = () => { if (document.visibilityState === "visible") this.check(); };
  }

  async start() {
    const room = await rooms.get(this.code);
    if (!room) throw new Error("Stanza non trovata.");
    this.version = room.version;
    this.seats = room.seats;
    if (room.state) this.setState(room.state);
    this.link = await listen(this.code, { seat: this.seat, name: this.name }, {
      onVersion: (p) => { if ((p.v ?? -1) > this.version) this.check(p); },
      onPresence: (seats) => { this.online = seats; if (this.onPresence) this.onPresence(seats); },
    });
    document.addEventListener("visibilitychange", this.onVisible);
    const tick = async () => {
      if (this.stopped) return;
      if (document.visibilityState === "visible") await this.check().catch(() => {});
      this.timer = setTimeout(tick, 2500);
    };
    this.timer = setTimeout(tick, 2500);
    return room;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.link) this.link.close();
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    if (this.onStatus) this.onStatus(s);
  }

  // c'e' una versione piu' nuova? allora la prendo (se non ho mosse in viaggio)
  async check(hint = null) {
    if (this.stopped || this.flushing || this.pending.length || this.fetching) return;
    let v;
    try { v = hint && hint.v != null ? hint.v : await rooms.version(this.code); } catch { this.setStatus("offline"); return; }
    this.setStatus("ok");
    if (v > this.version) await this.pull(hint);
  }

  async pull(hint = null) {
    this.fetching = true;
    try {
      const room = await rooms.get(this.code);
      if (!room || room.version <= this.version || this.pending.length) return;
      this.version = room.version;
      this.seats = room.seats;
      if (room.state) {
        this.setState(room.state);
        if (this.onRemote) this.onRemote({ undo: hint && hint.undo, by: hint && hint.by, seats: room.seats });
      }
    } catch { this.setStatus("offline"); } finally { this.fetching = false; }
  }

  // una mossa gia' fatta sullo stato locale: la mando
  push(fn, kind = "move") {
    this.pending.push({ fn, kind });
    this.flush();
  }

  async flush() {
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    let wait = 800;
    try {
      while (this.pending.length && !this.stopped) {
        const n = this.pending.length;
        const batch = this.pending.slice(0, n);
        const kind = batch.some((o) => o.kind === "start") ? "start" : batch.some((o) => o.kind === "move") ? "move" : "auto";
        const state = JSON.parse(JSON.stringify(this.getState()));
        let r;
        try {
          r = await rooms.push(this.code, this.version, state, kind, this.seat);
        } catch {
          this.setStatus("offline");
          await sleep(wait);
          wait = Math.min(wait * 2, 8000);
          continue;
        }
        wait = 800;
        if (r && r.ok) {
          this.version = r.version;
          this.pending.splice(0, n);
          this.setStatus("ok");
          if (this.link) this.link.send({ v: r.version, by: this.seat });
          continue;
        }
        if (r && r.conflict) { await this.rebase(); continue; }
        // stanza sparita o stato non valido: mi fermo
        this.pending = [];
        this.setStatus("error");
        break;
      }
    } finally {
      this.flushing = false;
    }
  }

  // l'altro ha mosso mentre mandavo: prendo il suo stato e ci rifaccio sopra le mie mosse
  async rebase() {
    let room = null;
    for (let k = 0; k < 5 && !room; k++) {
      try { room = await rooms.get(this.code); } catch { this.setStatus("offline"); await sleep(800 * (k + 1)); }
    }
    if (!room) return;
    this.version = room.version;
    this.seats = room.seats;
    this.setState(room.state);
    const kept = [];
    for (const op of this.pending) {
      try { this.replay(op.fn); kept.push(op); } catch (e) { console.warn("mossa non piu' valida", e); }
    }
    const dropped = this.pending.length - kept.length;
    this.pending = kept;
    if (this.onRemote) this.onRemote({ rebased: true, dropped, seats: room.seats });
  }

  // annulla l'ultima mossa (di chiunque): lo fa il server, poi riprendo lo stato
  async undo(lastText = "") {
    while (this.flushing || this.pending.length) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(150);
      if (this.stopped) return { ok: false };
    }
    for (let k = 0; k < 3; k++) {
      let r;
      try { r = await rooms.undo(this.code, this.version, this.seat); } catch { this.setStatus("offline"); return { ok: false, error: "offline" }; }
      if (r && r.conflict) { await this.pull(); continue; }
      if (!r || !r.ok) return r || { ok: false };
      const room = await rooms.get(this.code);
      this.version = room.version;
      this.setState(room.state);
      if (this.link) this.link.send({ v: room.version, by: this.seat, undo: lastText });
      return r;
    }
    return { ok: false, error: "busy" };
  }
}
