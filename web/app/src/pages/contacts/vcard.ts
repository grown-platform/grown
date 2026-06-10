import type { Contact, ContactInput } from "./types";

/** A contact parsed from a vCard file. Mirrors the editable ContactInput subset. */
export type ParsedContact = Omit<ContactInput, "starred"> & {
  starred?: boolean;
};

function emptyParsed(): ParsedContact {
  return {
    display_name: "",
    first_name: "",
    last_name: "",
    company: "",
    job_title: "",
    emails: [],
    phones: [],
    labels: [],
    notes: "",
  };
}

// vCard escaping per RFC 6350 §3.4: \n -> newline, and \\ \, \; literal.
function unescapeValue(v: string): string {
  return v.replace(/\\([\\,;nN])/g, (_, ch) =>
    ch === "n" || ch === "N" ? "\n" : ch,
  );
}

/**
 * Split a vCard content line into { name, params, value }.
 * Handles property params (e.g. EMAIL;TYPE=INTERNET:foo@bar) and grouping
 * prefixes (e.g. item1.EMAIL:...). The value is everything after the first
 * unescaped colon.
 */
function parseLine(
  line: string,
): { name: string; params: string[]; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  let name = parts[0] || "";
  // Strip a grouping prefix like "item1.EMAIL".
  const dot = name.lastIndexOf(".");
  if (dot >= 0) name = name.slice(dot + 1);
  return { name: name.trim().toUpperCase(), params: parts.slice(1), value };
}

function uniqPush(arr: string[], v: string) {
  const t = v.trim();
  if (t && !arr.some((x) => x.toLowerCase() === t.toLowerCase())) arr.push(t);
}

/**
 * Parse one or more vCards from raw .vcf text into ParsedContact records.
 * Supports BEGIN:VCARD/END:VCARD blocks with FN, N, EMAIL, TEL, ORG, TITLE,
 * NOTE, and CATEGORIES. Handles RFC line folding (continuation lines that
 * begin with a space or tab) and CRLF/LF line endings.
 */
export function parseVCards(text: string): ParsedContact[] {
  // Unfold folded lines (a CRLF followed by a space/tab continues the prior line).
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");

  const out: ParsedContact[] = [];
  let cur: ParsedContact | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      cur = emptyParsed();
      continue;
    }
    if (upper === "END:VCARD") {
      if (cur) {
        if (!cur.display_name) {
          cur.display_name =
            `${cur.first_name} ${cur.last_name}`.trim() || cur.emails[0] || "";
        }
        out.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const value = unescapeValue(parsed.value);
    switch (parsed.name) {
      case "FN":
        cur.display_name = value.trim();
        break;
      case "N": {
        // N: Family;Given;Additional;Prefix;Suffix
        const [family = "", given = ""] = value.split(";");
        if (given.trim()) cur.first_name = given.trim();
        if (family.trim()) cur.last_name = family.trim();
        break;
      }
      case "EMAIL":
        uniqPush(cur.emails, value);
        break;
      case "TEL":
        uniqPush(cur.phones, value);
        break;
      case "ORG":
        // ORG can be "Company;Department"; take the first component.
        cur.company = value.split(";")[0].trim();
        break;
      case "TITLE":
        cur.job_title = value.trim();
        break;
      case "NOTE":
        cur.notes = cur.notes ? `${cur.notes}\n${value}` : value;
        break;
      case "CATEGORIES":
        value.split(",").forEach((c) => uniqPush(cur!.labels, c));
        break;
      default:
        break;
    }
  }
  return out;
}

/** True if a parsed contact carries enough info to be worth creating. */
export function isMeaningful(c: ParsedContact): boolean {
  return Boolean(
    c.display_name ||
      c.first_name ||
      c.last_name ||
      c.emails.length ||
      c.phones.length,
  );
}

/** Build the create payload for a parsed vCard contact. */
export function toCreateInput(c: ParsedContact): Partial<ContactInput> {
  return {
    display_name: c.display_name,
    first_name: c.first_name,
    last_name: c.last_name,
    company: c.company,
    job_title: c.job_title,
    emails: c.emails,
    phones: c.phones,
    labels: c.labels,
    notes: c.notes,
    starred: c.starred ?? false,
  };
}

// ---- Duplicate detection & merge ----

function normName(c: Contact): string {
  return (c.display_name || `${c.first_name} ${c.last_name}`)
    .trim()
    .toLowerCase();
}

/**
 * A group of contacts considered duplicates of one another, keyed by the
 * signal that matched them (a shared email, or a shared display name).
 */
export interface DuplicateGroup {
  key: string;
  reason: "email" | "name";
  contacts: Contact[];
}

/**
 * Find groups of duplicate contacts. Two contacts are duplicates if they share
 * a case-insensitive email address, OR share a non-empty normalized display
 * name. Groups are merged transitively (A~B, B~C => {A,B,C}). Only groups with
 * 2+ members are returned.
 */
export function findDuplicates(contacts: Contact[]): DuplicateGroup[] {
  // Union-find over contact indices.
  const parent = contacts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  const byEmail = new Map<string, number>();
  const byName = new Map<string, number>();
  contacts.forEach((c, i) => {
    for (const e of c.emails) {
      const k = e.trim().toLowerCase();
      if (!k) continue;
      if (byEmail.has(k)) union(i, byEmail.get(k)!);
      else byEmail.set(k, i);
    }
    const n = normName(c);
    if (n) {
      if (byName.has(n)) union(i, byName.get(n)!);
      else byName.set(n, i);
    }
  });

  const groups = new Map<number, number[]>();
  contacts.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });

  const result: DuplicateGroup[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const cs = idxs.map((i) => contacts[i]);
    // A group is reported as "email" when any two members share an address;
    // otherwise the only thing tying them together is a shared display name.
    const sharesEmail = cs.some((c) =>
      c.emails.some((e) => {
        const k = e.trim().toLowerCase();
        return (
          k &&
          cs.some(
            (o) =>
              o !== c && o.emails.some((oe) => oe.trim().toLowerCase() === k),
          )
        );
      }),
    );
    result.push({
      key: cs[0].id,
      reason: sharesEmail ? "email" : "name",
      contacts: cs,
    });
  }
  return result;
}

/**
 * Merge a group of contacts into a single ContactInput: keeps the primary's
 * scalar fields (falling back to others when blank) and unions emails, phones,
 * and labels. The primary should be the contact you intend to keep/update.
 */
export function mergeContacts(
  primary: Contact,
  others: Contact[],
): ContactInput {
  const all = [primary, ...others];
  const emails: string[] = [];
  const phones: string[] = [];
  const labels: string[] = [];
  for (const c of all) {
    c.emails.forEach((e) => uniqPush(emails, e));
    c.phones.forEach((p) => uniqPush(phones, p));
    c.labels.forEach((l) => uniqPush(labels, l));
  }
  const firstNonEmpty = (pick: (c: Contact) => string): string => {
    for (const c of all) {
      const v = pick(c).trim();
      if (v) return v;
    }
    return "";
  };
  const notes = all
    .map((c) => c.notes.trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    display_name:
      firstNonEmpty((c) => c.display_name) ||
      firstNonEmpty((c) => `${c.first_name} ${c.last_name}`),
    first_name: firstNonEmpty((c) => c.first_name),
    last_name: firstNonEmpty((c) => c.last_name),
    company: firstNonEmpty((c) => c.company),
    job_title: firstNonEmpty((c) => c.job_title),
    emails,
    phones,
    labels,
    notes,
    starred: all.some((c) => c.starred),
  };
}
