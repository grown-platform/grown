# Spell-check dictionaries

Hunspell dictionaries loaded on demand by the spell worker
(`web/app/src/lib/spell/`). Each language is an affix file (`<tag>.aff`)
and a gzip-compressed word list (`<tag>.dic.gz`, decompressed in the
worker with `DecompressionStream`).

| Files | Language | Source | Licence |
|---|---|---|---|
| `en-US.aff`, `en-US.dic.gz` | English (US); also used for en-CA | SCOWL 2020.12.07 via the `dictionary-en` 4.0.0 npm package (wooorm/dictionaries) | SCOWL / Ispell permissive licence (MIT-like, redistribution allowed with the notice), see `LICENSE-en_US.txt` |
| `en-GB.aff`, `en-GB.dic.gz` | English (UK, "-ise"); also used for en-AU, en-IE, en-NZ | SCOWL 2020.12.07 via `dictionary-en-gb` 3.0.0 | same, see `LICENSE-en_GB.txt` |

The word lists are unmodified (only gzip-compressed). To add a language,
drop `<name>.aff` and `<name>.dic.gz` here, give it a `dictionary` in
`src/lib/spell/languages.ts`, add a row above, and check that its licence
allows redistribution (GPL-only dictionaries such as some German ones do
not fit an MIT project).
