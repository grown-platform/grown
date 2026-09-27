// Docs M13 extensions (spell check, language, view toggles, drop cap),
// kept in one list so extensions.ts only gains a single entry.
import { LangMark } from "./language";
import { SpellCheck } from "./spellcheck";
import { NonPrinting } from "./viewModes";
import { DropCap } from "./dropCap";

export const M13_EXTENSIONS = [LangMark, SpellCheck, NonPrinting, DropCap];
