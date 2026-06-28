# Reading Flash Cards — Design

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan

## Summary

A reading-practice flash card game for young children, played with a parent. The
parent shows a card (letter, word, or short phrase), the child reads it aloud, and
the parent taps **Got it!** to record how fast they read it. Each card has buttons
to hear the whole word and to hear it sounded out phoneme-by-phoneme. Content starts
at the alphabet and progresses through a phonics ladder to short phrases. Each child
has their own profile tracking progress and times.

This is the first game in the collection to use audio (browser `speechSynthesis`).

## Goals

- Help pre-readers and early readers practice from letters up to short phrases.
- Let a parent record reading speed per card with a single, reliable button tap.
- Give every card a way to hear the whole word and to hear it sounded out.
- Track multiple children separately, on-device.
- Suggest (never force) moving up a level when a child reads the current one quickly.
- Work fully offline, matching the existing self-contained-HTML game pattern.

## Non-Goals (YAGNI)

- **Voice / speech recognition** to auto-detect when the child reads the word. The
  parent taps the button instead. Explicitly deferred — "we can do voice later."
- Any backend, account, or cross-device sync. All state is local to the device.
- Studio-quality phonics audio. Phoneme sounds come from browser TTS and are
  approximate (see Risks).
- Hard level locking / gating. Levels are always selectable.

## Architecture

A single self-contained HTML file following the existing game convention in
`web/app/public/games/`:

- `web/app/public/games/reading-flash-cards.html` — vanilla JS, inline `<style>`,
  no build step, no external dependencies.
- `web/app/public/games/reading-flash-cards.webmanifest` — PWA manifest matching the
  shape of e.g. `typing-test.webmanifest`.
- `web/app/public/games/icons/reading-flash-cards.svg` — game icon.
- One `arcade(...)` registration line in `web/app/src/pages/games/index.tsx`, with the
  game added to the **Kids** and **Word** category tag lists.

The only platform dependency beyond the existing pattern is `window.speechSynthesis`
for the sound buttons. It is feature-detected: if unavailable, the sound buttons are
disabled and the rest of the game works normally. The game otherwise works fully
offline (it is already covered by the games service worker, `games-sw.js`).

State is persisted in `localStorage` as a single JSON blob, wrapped in try/catch like
the other games (e.g. `math-quiz.html`).

## Screens

The UI is a single mobile-first card panel (max-width column, like `typing-test`)
that swaps between four views:

1. **Who's playing** — list of child profiles, each showing name + current level; an
   "Add child" affordance. Tapping a name selects that child and goes to Level select.
   Long-press / edit affordance to rename or remove a child.
2. **Level select** — the 6 levels listed. Shows the child's current level ("you are
   here"), a checkmark on levels they have read quickly/consistently, and a
   "ready for Level N?" nudge when earned. **Every level is always tappable** — the
   parent is in control; nothing is locked.
3. **Play** — one large card showing the current letter/word/phrase, with:
   - **🔊 word** button — speaks the whole text naturally.
   - **🔉 sounds** button — speaks each phoneme hint with pauses, then the whole word.
   - a live timer that starts when the card is shown.
   - a large **✓ Got it!** button — parent taps when the child reads it correctly;
     records the elapsed time and advances to the next card.
   - **skip** (no time recorded, next card) and **too hard** (records nothing, but
     signals the card was hard — used to soften the level-up nudge).
4. **Session summary** — number of cards read this session, the times, a "fastest
   card" highlight, and the level-up nudge if it was earned during the session.

## Content — the phonics ladder

Six levels, each defined as an editable JS array near the top of the file so word
lists can be extended later without touching game logic:

1. **Letters** — A–Z (uppercase; may show lowercase pairing).
2. **Letter sounds** — A–Z, focusing on the sound each letter makes.
3. **CVC words** — consonant-vowel-consonant: cat, dog, sun, hat, pig, …
4. **Sight words** — high-frequency words: the, and, is, you, to, …
5. **Big words** — longer/multi-syllable: apple, happy, water, …
6. **Short phrases** — I see a cat, the dog can run, …

Each card entry carries:
- `text` — what is displayed and what the **🔊 word** button speaks.
- `sounds` — an ordered list of pronounceable phoneme hints used by the **🔉 sounds**
  button, e.g. `cat → ["kuh", "aa", "tuh"]`. For letter-sound cards this is the
  letter name plus its sound (e.g. `A → "Ay", "/a/ as in apple"`).

Cards within a level are presented in a shuffled order each session; the same card is
not repeated back-to-back.

## Sound engine

Built on `window.speechSynthesis`:

- On first use, pick a child-friendly English voice if one is available
  (prefer `en-*`, prefer a local voice); otherwise use the default.
- **🔊 word**: `speak(text)` at a slightly slowed rate.
- **🔉 sounds**: speak each `sounds` hint in sequence with a short pause between them,
  then speak the whole `text`. Implemented by chaining utterances (each next one fired
  on the previous `onend`, with a small gap) so it works across browsers.
- Guard against overlapping playback: cancel any in-progress speech before starting a
  new request.

## Data model

A single `localStorage` key (e.g. `grown_reading_flash_cards_v1`) holding JSON:

```
{
  "children": [
    {
      "id": "<stable id>",
      "name": "Mia",
      "currentLevel": 3,
      "levels": {
        "1": { "reads": 40, "bestMs": 900,  "recentMs": [1200, 1100, ...] },
        "3": { "reads": 12, "bestMs": 1800, "recentMs": [...] }
      }
    }
  ],
  "lastChildId": "<id>"
}
```

- `recentMs` is a small rolling window (e.g. last ~10 times) per level, used for the
  level-up nudge and the "read quickly" checkmark.
- **Level-up nudge** triggers when the child has read enough cards on the current level
  (e.g. ≥ 8) and their recent times are consistently under a per-level threshold,
  softened by recent "too hard" taps. The nudge only *suggests* the next level; it
  never changes `currentLevel` on its own.
- `currentLevel` advances only when the parent/child actually picks a higher level.

All values are tunable constants defined near the top of the file.

## Error handling & edge cases

- `localStorage` unavailable or throwing → game still runs for the session; nothing
  persists (matches existing games' try/catch approach).
- `speechSynthesis` unavailable → sound buttons disabled, visibly greyed; gameplay
  otherwise unaffected.
- No children yet → "Who's playing" leads with the "Add child" flow.
- Empty/whitespace child name → rejected with a gentle inline prompt.
- Rapid double-taps on **Got it!** → debounced so one card records one time.

## Testing

These are static HTML games with no unit-test harness, so verification is by loading
the file in a browser via CDP and exercising the flows:

- Create a child, switch between two children, rename/remove a child.
- Show a card, confirm the timer runs, tap **Got it!**, confirm a time is recorded and
  the next card appears; confirm **skip** records no time.
- Fire **🔊 word** and **🔉 sounds** and confirm speech is requested (and that the
  sounds button blends hints then the whole word).
- Drive enough fast reads on a level to trigger the level-up nudge.
- Reload the page and confirm child profiles, current level, and times persist.
- Confirm the game appears in the games grid under **Kids** and **Word** and launches.

## Risks

- **Phoneme accuracy:** browser TTS speaks letter *names* well but raw phonemes
  approximately. The `sounds` hints are hand-tuned strings ("kuh", "aa", "tuh") to get
  as close as possible; quality varies by device voice. Acceptable for a first version;
  could later be upgraded to recorded audio clips.
- **Voice availability/quality** differs across devices; the friendly-voice selection
  is best-effort with a graceful default.
