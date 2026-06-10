import { describe, it, expect } from "vitest";
import { parseGoogleCSV } from "./googlecsv";

// The complete Google Contacts CSV header (47 columns).
const FULL_HEADER =
  "Name,Given Name,Additional Name,Family Name,Yomi Name,Given Name Yomi," +
  "Additional Name Yomi,Family Name Yomi,Name Prefix,Name Suffix,Initials," +
  "Nickname,Short Name,Maiden Name,Birthday,Gender,Location,Billing Information," +
  "Directory Server,Mileage,Occupation,Hobby,Sensitivity,Priority,Subject,Notes," +
  "Language,Photo,Group Membership,E-mail 1 - Type,E-mail 1 - Value," +
  "E-mail 2 - Type,E-mail 2 - Value,E-mail 3 - Type,E-mail 3 - Value," +
  "Phone 1 - Type,Phone 1 - Value,Phone 2 - Type,Phone 2 - Value," +
  "Organization 1 - Type,Organization 1 - Name,Organization 1 - Yomi Name," +
  "Organization 1 - Title,Organization 1 - Department,Organization 1 - Symbol," +
  "Organization 1 - Location,Organization 1 - Job Description";

/**
 * Build a 47-column row string given a sparse map of column-index → value.
 * Cells with commas are quoted automatically.
 */
function buildRow(vals: Record<number, string>): string {
  const cells = Array.from({ length: 47 }, (_, i) => vals[i] ?? "");
  return cells
    .map((v) =>
      v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v,
    )
    .join(",");
}

describe("parseGoogleCSV — full Google header", () => {
  it("parses all meaningful columns from a full-header export row", () => {
    const row = buildRow({
      0: "Ada Lovelace", // Name
      1: "Ada", // Given Name
      3: "Lovelace", // Family Name
      25: "First programmer", // Notes
      28: "* myContacts ::: Work", // Group Membership
      30: "ada@example.com", // E-mail 1 - Value
      32: "ada@work.com", // E-mail 2 - Value
      36: "+1 555 0100", // Phone 1 - Value
      38: "+1 555 0200", // Phone 2 - Value
      40: "Analytical Engines", // Organization 1 - Name
      42: "Mathematician", // Organization 1 - Title
    });
    const contacts = parseGoogleCSV(FULL_HEADER + "\n" + row);

    expect(contacts).toHaveLength(1);
    const c = contacts[0];
    expect(c.display_name).toBe("Ada Lovelace");
    expect(c.first_name).toBe("Ada");
    expect(c.last_name).toBe("Lovelace");
    expect(c.company).toBe("Analytical Engines");
    expect(c.job_title).toBe("Mathematician");
    expect(c.notes).toBe("First programmer");
    expect(c.emails).toEqual(["ada@example.com", "ada@work.com"]);
    expect(c.phones).toEqual(["+1 555 0100", "+1 555 0200"]);
    expect(c.labels).toContain("Work");
    expect(c.labels).not.toContain("myContacts");
  });

  it("strips * myContacts and keeps only real labels", () => {
    const row = buildRow({
      0: "Jane",
      28: "* myContacts ::: Friends ::: VIP",
      30: "jane@x.com",
    });
    const [c] = parseGoogleCSV(FULL_HEADER + "\n" + row);
    expect(c.labels).toEqual(["Friends", "VIP"]);
  });
});

describe("parseGoogleCSV — minimal header", () => {
  const MIN_HEADER =
    "Name,Given Name,Family Name,E-mail 1 - Value,E-mail 2 - Value,E-mail 3 - Value," +
    "Phone 1 - Value,Phone 2 - Value,Organization 1 - Name,Organization 1 - Title,Notes";

  it("parses a single contact from minimal columns", () => {
    // MIN_HEADER columns: Name, Given Name, Family Name, E-mail 1-Value, E-mail 2-Value,
    // E-mail 3-Value, Phone 1-Value, Phone 2-Value, Org 1-Name, Org 1-Title, Notes
    const csv =
      MIN_HEADER +
      "\n" +
      "Alan Turing,Alan,Turing,alan@example.com,,,+44 20 0000,,GCHQ,Cryptanalyst,Bombe inventor";
    const [c] = parseGoogleCSV(csv);
    expect(c.display_name).toBe("Alan Turing");
    expect(c.first_name).toBe("Alan");
    expect(c.last_name).toBe("Turing");
    expect(c.emails).toEqual(["alan@example.com"]);
    expect(c.phones).toEqual(["+44 20 0000"]);
    expect(c.company).toBe("GCHQ");
    expect(c.job_title).toBe("Cryptanalyst");
    expect(c.notes).toBe("Bombe inventor");
  });

  it("parses multiple rows", () => {
    const csv =
      MIN_HEADER +
      "\n" +
      "Ada,Ada,Lovelace,ada@x.com,ada2@x.com,,,,,\n" +
      "Alan,Alan,Turing,alan@x.com,,,,,,,\n";
    const contacts = parseGoogleCSV(csv);
    expect(contacts).toHaveLength(2);
    expect(contacts[0].display_name).toBe("Ada");
    expect(contacts[0].emails).toEqual(["ada@x.com", "ada2@x.com"]);
    expect(contacts[1].display_name).toBe("Alan");
  });

  it("skips entirely blank rows", () => {
    const csv =
      MIN_HEADER + "\n" + ",,,,,,,,,,\n" + "Bob,,Builder,bob@x.com,,,,,,\n";
    const contacts = parseGoogleCSV(csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].display_name).toBe("Bob");
  });

  it("deduplicates emails case-insensitively", () => {
    const csv =
      "Name,E-mail 1 - Value,E-mail 2 - Value,E-mail 3 - Value\n" +
      "Ada,dup@x.com,DUP@X.COM,other@x.com";
    const [c] = parseGoogleCSV(csv);
    expect(c.emails).toHaveLength(2);
    expect(c.emails).toContain("dup@x.com");
    expect(c.emails).toContain("other@x.com");
  });
});

describe("parseGoogleCSV — quoted fields", () => {
  it('handles names with embedded commas ("Smith, John")', () => {
    const csv =
      "Name,Given Name,Family Name,E-mail 1 - Value,Notes\n" +
      '"Smith, John",John,Smith,john@x.com,"Works at Smith, Inc."';
    const [c] = parseGoogleCSV(csv);
    expect(c.display_name).toBe("Smith, John");
    expect(c.notes).toBe("Works at Smith, Inc.");
  });

  it("handles doubled-quote escaping inside quoted fields", () => {
    const csv = 'Name,Notes\n"Ada ""Ada"" L",bio';
    const [c] = parseGoogleCSV(csv);
    expect(c.display_name).toBe('Ada "Ada" L');
  });
});

describe("parseGoogleCSV — derived display name", () => {
  it("derives display name from Given + Family when Name is empty", () => {
    const csv =
      "Name,Given Name,Family Name,E-mail 1 - Value\n,Charles,Babbage,charles@x.com";
    const [c] = parseGoogleCSV(csv);
    expect(c.display_name).toBe("Charles Babbage");
  });

  it("falls back to email when all name fields are empty", () => {
    const csv = "Name,Given Name,Family Name,E-mail 1 - Value\n,,,noname@x.com";
    const [c] = parseGoogleCSV(csv);
    expect(c.display_name).toBe("noname@x.com");
  });
});

describe("parseGoogleCSV — edge cases", () => {
  it("returns empty array for empty string", () => {
    expect(parseGoogleCSV("")).toEqual([]);
  });

  it("returns empty array for header-only CSV", () => {
    expect(
      parseGoogleCSV("Name,Given Name,Family Name,E-mail 1 - Value\n"),
    ).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const csv = "Name,E-mail 1 - Value\r\nAda,ada@x.com\r\n";
    const [c] = parseGoogleCSV(csv);
    expect(c.display_name).toBe("Ada");
    expect(c.emails).toEqual(["ada@x.com"]);
  });
});
