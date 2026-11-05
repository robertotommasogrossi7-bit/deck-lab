# Deck Lab online

Web app per provare i mazzi di Magic Standard con un amico, ognuno sul suo telefono, anche a distanza.
Si apre dal browser e si aggiunge alla schermata Home.

- **App**: questa cartella, pubblicata con GitHub Pages (ramo `main`, cartella `/ (root)`).
- **Partite e stanze a due telefoni**: Supabase, con le tabelle e le funzioni di `supabase/deck_lab.sql`.
- **Dati dei mazzi**: fotografati dal Deck Lab del PC (cartella `Magic`) con `scripts/build_web.py`.

Questa cartella è generata: non si modifica a mano. Per aggiornarla si rilancia, dalla cartella `Magic`:

```
python scripts/build_web.py --out <questa cartella> --supabase-url <URL del progetto> --supabase-key <chiave pubblica>
```

La chiave di Supabase nel file `config.js` è quella pubblica: le tabelle sono chiuse e i telefoni passano
solo dalle funzioni SQL.

Deck Lab è Fan Content non ufficiale permesso dalla Fan Content Policy. Non approvato né sponsorizzato da
Wizards. Parti dei materiali usati sono proprietà di Wizards of the Coast. ©Wizards of the Coast LLC.
