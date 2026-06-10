import type { ParsedContact } from "./vcard";

/**
 * Parse a Google Contacts CSV export into ParsedContact records.
 *
 * Google Contacts exports a CSV whose first row is a header.  The columns of
 * interest are:
 *
 *   Name, Given Name, Family Name, Notes, Group Membership,
 *   E-mail N - Value  (N = 1, 2, 3 …),
 *   Phone N - Value   (N = 1, 2, 3 …),
 *   Organization 1 - Name, Organization 1 - Title
 *
 * Multi-value columns stop as soon as an empty value is encountered.
 * The "Group Membership" column uses " ::: " as a separator and may contain
 * a built-in "* myContacts" entry that is silently dropped.
 */
export function parseGoogleCSV(text: string): ParsedContact[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim());

  const col = (name: string): number => header.indexOf(name);

  // Build a getter: returns cell value (trimmed) or "".
  const get = (row: string[], name: string): string => {
    const idx = col(name);
    if (idx < 0 || idx >= row.length) return "";
    return row[idx].trim();
  };

  const out: ParsedContact[] = [];

  for (const row of rows.slice(1)) {
    const displayName = get(row, "Name");
    const firstName = get(row, "Given Name");
    const lastName = get(row, "Family Name");
    const notes = get(row, "Notes");
    const company = get(row, "Organization 1 - Name");
    const jobTitle = get(row, "Organization 1 - Title");

    const emails: string[] = [];
    const phones: string[] = [];

    // Collect multi-value emails: stop at first empty slot.
    for (let n = 1; n <= 20; n++) {
      const v = get(row, `E-mail ${n} - Value`);
      if (!v) break;
      uniqPush(emails, v);
    }

    // Collect multi-value phones.
    for (let n = 1; n <= 20; n++) {
      const v = get(row, `Phone ${n} - Value`);
      if (!v) break;
      uniqPush(phones, v);
    }

    // Labels from "Group Membership" (Google) or "Labels" (simplified export).
    const labels: string[] = [];
    const gm = get(row, "Group Membership") || get(row, "Labels");
    if (gm) {
      const parts = gm.includes(":::") ? gm.split(":::") : gm.split(",");
      for (const p of parts) {
        // Google prefixes built-in groups with "* " — strip it and skip myContacts.
        const clean = p.trim().replace(/^\* /, "").trim();
        if (!clean || /^my\s*contacts$/i.test(clean)) continue;
        uniqPush(labels, clean);
      }
    }

    // Derive display name if absent.
    let derived = displayName;
    if (!derived) {
      const full = `${firstName} ${lastName}`.trim();
      derived = full || emails[0] || "";
    }

    if (!isMeaningful(derived, firstName, lastName, emails, phones)) continue;

    out.push({
      display_name: derived,
      first_name: firstName,
      last_name: lastName,
      company,
      job_title: jobTitle,
      emails,
      phones,
      labels,
      notes,
    });
  }

  return out;
}

function isMeaningful(
  displayName: string,
  firstName: string,
  lastName: string,
  emails: string[],
  phones: string[],
): boolean {
  return Boolean(
    displayName || firstName || lastName || emails.length || phones.length,
  );
}

function uniqPush(arr: string[], v: string): void {
  const t = v.trim();
  if (t && !arr.some((x) => x.toLowerCase() === t.toLowerCase())) arr.push(t);
}

// ---------------------------------------------------------------------------
// Minimal RFC 4180 CSV parser (handles quoted fields, embedded commas/newlines,
// doubled-quote escaping, CRLF and LF line endings).
// ---------------------------------------------------------------------------
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const ch = text[i];

    if (inQuote) {
      if (ch === '"') {
        // Peek ahead: "" is an escaped quote inside a quoted field.
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i++; // consume second quote
        } else {
          inQuote = false; // closing quote
        }
      } else {
        field += ch;
      }
      continue;
    }

    // Not in a quoted field.
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      // Handle CRLF: peek and consume the \n.
      if (i + 1 < n && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
      continue;
    }
    if (ch === "\n") {
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
      continue;
    }
    field += ch;
  }

  // Flush any remaining field/row.
  cur.push(field);
  if (cur.some((f) => f !== "")) rows.push(cur);

  return rows;
}
