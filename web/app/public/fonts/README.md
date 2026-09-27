# Font bundle (CC7)

Open fonts served locally so Docs, Sheets and Slides render the same on
every machine, and so documents written with Microsoft's fonts render with
metrically compatible substitutes. `src/lib/fonts.ts` declares the
@font-face rules (the browser downloads a face only when text uses it) and
the fallback table (Calibri → Carlito, Cambria → Caladea, Arial → Liberation
Sans, Times New Roman → Liberation Serif, Courier New → Liberation Mono, …).

Each family ships woff2 files for the latin and latin-ext subsets in
regular, bold, italic and bold italic (Noto Sans Mono has no italic):
about 2.4 MB in total. Files come unmodified from the Fontsource 5.3.0
npm packages (`@fontsource/<slug>`), which subset the upstream fonts.

| Directory | Family | Upstream | Licence |
|---|---|---|---|
| `noto-sans/` | Noto Sans | notofonts/latin-greek-cyrillic | SIL OFL 1.1 |
| `noto-serif/` | Noto Serif | notofonts/latin-greek-cyrillic | SIL OFL 1.1 |
| `noto-sans-mono/` | Noto Sans Mono | notofonts/latin-greek-cyrillic | SIL OFL 1.1 |
| `carlito/` | Carlito (metric-compatible with Calibri) | googlefonts/carlito | SIL OFL 1.1 |
| `caladea/` | Caladea (metric-compatible with Cambria) | huertatipografica/Caladea | SIL OFL 1.1 |
| `arimo/` | Arimo (Arial / Liberation Sans metrics) | googlefonts/arimo | SIL OFL 1.1 |
| `tinos/` | Tinos (Times New Roman / Liberation Serif metrics) | googlefonts/tinos | SIL OFL 1.1 |
| `cousine/` | Cousine (Courier New / Liberation Mono metrics) | googlefonts/cousine | SIL OFL 1.1 |

Liberation Sans, Serif and Mono 2.x are derived from Arimo, Tinos and
Cousine; the names "Liberation Sans/Serif/Mono" are declared as aliases of
those files (a locally installed Liberation font is preferred). Each
directory's `LICENSE.txt` is the full licence text with the copyright
notices. The OFL allows bundling and redistribution with software; the
fonts may not be sold on their own.
