import { describe, it, expect } from "vitest";
import {
  parseVCards,
  isMeaningful,
  findDuplicates,
  mergeContacts,
  type ParsedContact,
} from "./vcard";
import type { Contact } from "./types";

function contact(p: Partial<Contact>): Contact {
  return {
    id: "",
    org_id: "o",
    owner_id: "u",
    display_name: "",
    first_name: "",
    last_name: "",
    company: "",
    job_title: "",
    emails: [],
    phones: [],
    labels: [],
    notes: "",
    starred: false,
    created_at: "",
    updated_at: "",
    ...p,
  };
}

describe("parseVCards", () => {
  it("parses a single full vCard", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Ada Lovelace",
      "N:Lovelace;Ada;;;",
      "ORG:Analytical Engines;R&D",
      "TITLE:Mathematician",
      "EMAIL;TYPE=INTERNET:ada@example.com",
      "TEL:+1 555 0100",
      "NOTE:First programmer",
      "CATEGORIES:Friends,Math",
      "END:VCARD",
    ].join("\r\n");
    const [c] = parseVCards(vcf);
    expect(c.display_name).toBe("Ada Lovelace");
    expect(c.first_name).toBe("Ada");
    expect(c.last_name).toBe("Lovelace");
    expect(c.company).toBe("Analytical Engines");
    expect(c.job_title).toBe("Mathematician");
    expect(c.emails).toEqual(["ada@example.com"]);
    expect(c.phones).toEqual(["+1 555 0100"]);
    expect(c.notes).toBe("First programmer");
    expect(c.labels).toEqual(["Friends", "Math"]);
  });

  it("parses multiple vCards in one file", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:Alan Turing",
      "EMAIL:alan@example.com",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Grace Hopper",
      "EMAIL:grace@example.com",
      "END:VCARD",
    ].join("\n");
    const list = parseVCards(vcf);
    expect(list.map((c) => c.display_name)).toEqual([
      "Alan Turing",
      "Grace Hopper",
    ]);
  });

  it("derives display name from N when FN is missing", () => {
    const [c] = parseVCards("BEGIN:VCARD\nN:Babbage;Charles;;;\nEND:VCARD");
    expect(c.display_name).toBe("Charles Babbage");
  });

  it("handles multiple emails/phones and dedupes case-insensitively", () => {
    const [c] = parseVCards(
      [
        "BEGIN:VCARD",
        "FN:Multi",
        "EMAIL:a@x.com",
        "EMAIL:A@X.com",
        "EMAIL:b@x.com",
        "TEL;TYPE=CELL:111",
        "TEL;TYPE=HOME:222",
        "END:VCARD",
      ].join("\n"),
    );
    expect(c.emails).toEqual(["a@x.com", "b@x.com"]);
    expect(c.phones).toEqual(["111", "222"]);
  });

  it("unescapes NOTE newlines and strips item-group prefixes", () => {
    const [c] = parseVCards(
      [
        "BEGIN:VCARD",
        "FN:Test",
        "NOTE:line one\\nline two",
        "item1.EMAIL:grouped@x.com",
        "END:VCARD",
      ].join("\n"),
    );
    expect(c.notes).toBe("line one\nline two");
    expect(c.emails).toEqual(["grouped@x.com"]);
  });

  it("unfolds folded continuation lines", () => {
    const vcf =
      "BEGIN:VCARD\r\nFN:Very Long\r\nNOTE:part one \r\n part two\r\nEND:VCARD";
    const [c] = parseVCards(vcf);
    expect(c.notes).toBe("part one part two");
  });

  it("ignores junk outside BEGIN/END", () => {
    expect(parseVCards("hello\nworld")).toEqual([]);
  });

  // ---- Apple Contacts vCard 3.0 specifics ----
  it("handles Apple-style grouped properties (item1.EMAIL, item2.TEL, etc.)", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Grace Hopper",
      "N:Hopper;Grace;;;",
      "ORG:US Navy;",
      "TITLE:Rear Admiral",
      // Apple exports emails with item-group prefixes and extra type params.
      "item1.EMAIL;type=INTERNET;type=HOME;type=pref:grace@home.example.com",
      "item2.EMAIL;type=INTERNET;type=WORK:grace@navy.example.com",
      // Apple-style phone with group prefix.
      "item3.TEL;type=CELL;type=VOICE;type=pref:+1 555 0001",
      "item4.TEL;type=HOME;type=VOICE:+1 555 0002",
      // Apple X- extension that should be gracefully ignored.
      "X-ABUID:12345-ABCD-EF",
      "END:VCARD",
    ].join("\r\n");

    const [c] = parseVCards(vcf);
    expect(c.display_name).toBe("Grace Hopper");
    expect(c.first_name).toBe("Grace");
    expect(c.last_name).toBe("Hopper");
    expect(c.company).toBe("US Navy");
    expect(c.job_title).toBe("Rear Admiral");
    expect(c.emails).toEqual([
      "grace@home.example.com",
      "grace@navy.example.com",
    ]);
    expect(c.phones).toEqual(["+1 555 0001", "+1 555 0002"]);
  });

  it("handles Apple vCard 3.0 with CATEGORIES and NOTE", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Margaret Hamilton",
      "N:Hamilton;Margaret;;;",
      "CATEGORIES:Apollo,MIT",
      "NOTE:Led software team for Apollo 11\\nmission-critical code",
      "item1.EMAIL;type=INTERNET;type=pref:margaret@mit.example.com",
      "X-SOCIALPROFILE;type=twitter;x-user=mhamilton:mhamilton",
      "END:VCARD",
    ].join("\r\n");

    const [c] = parseVCards(vcf);
    expect(c.labels).toEqual(["Apollo", "MIT"]);
    expect(c.notes).toBe(
      "Led software team for Apollo 11\nmission-critical code",
    );
    expect(c.emails).toEqual(["margaret@mit.example.com"]);
  });

  it("handles Apple-exported vCard with multiple BEGIN:VCARD blocks", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Alice",
      "item1.EMAIL:alice@x.com",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Bob",
      "item1.EMAIL:bob@x.com",
      "END:VCARD",
    ].join("\r\n");
    const contacts = parseVCards(vcf);
    expect(contacts).toHaveLength(2);
    expect(contacts[0].display_name).toBe("Alice");
    expect(contacts[0].emails).toEqual(["alice@x.com"]);
    expect(contacts[1].display_name).toBe("Bob");
    expect(contacts[1].emails).toEqual(["bob@x.com"]);
  });
});

describe("isMeaningful", () => {
  const base: ParsedContact = {
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
  it("rejects empty parsed contacts", () => {
    expect(isMeaningful({ ...base })).toBe(false);
    expect(isMeaningful({ ...base, company: "Acme" })).toBe(false);
  });
  it("accepts a contact with a name or email or phone", () => {
    expect(isMeaningful({ ...base, display_name: "X" })).toBe(true);
    expect(isMeaningful({ ...base, emails: ["x@y.com"] })).toBe(true);
    expect(isMeaningful({ ...base, phones: ["123"] })).toBe(true);
  });
});

describe("findDuplicates", () => {
  it("groups contacts sharing an email", () => {
    const cs = [
      contact({ id: "1", display_name: "Ada L.", emails: ["ada@x.com"] }),
      contact({ id: "2", display_name: "Ada Lovelace", emails: ["ADA@x.com"] }),
      contact({ id: "3", display_name: "Bob", emails: ["bob@x.com"] }),
    ];
    const groups = findDuplicates(cs);
    expect(groups).toHaveLength(1);
    expect(groups[0].contacts.map((c) => c.id).sort()).toEqual(["1", "2"]);
    expect(groups[0].reason).toBe("email");
  });

  it("groups contacts sharing a display name", () => {
    const cs = [
      contact({ id: "1", display_name: "John Smith", emails: ["js1@x.com"] }),
      contact({ id: "2", display_name: "john smith", emails: ["js2@x.com"] }),
    ];
    const groups = findDuplicates(cs);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("name");
  });

  it("merges transitively across email and name links", () => {
    const cs = [
      contact({ id: "1", display_name: "A", emails: ["shared@x.com"] }),
      contact({ id: "2", display_name: "A", emails: ["other@x.com"] }),
      contact({ id: "3", display_name: "B", emails: ["shared@x.com"] }),
    ];
    const groups = findDuplicates(cs);
    expect(groups).toHaveLength(1);
    expect(groups[0].contacts).toHaveLength(3);
  });

  it("returns nothing when there are no duplicates", () => {
    const cs = [
      contact({ id: "1", display_name: "A", emails: ["a@x.com"] }),
      contact({ id: "2", display_name: "B", emails: ["b@x.com"] }),
    ];
    expect(findDuplicates(cs)).toEqual([]);
  });
});

describe("mergeContacts", () => {
  it("unions emails/phones/labels and fills scalars from primary first", () => {
    const primary = contact({
      id: "1",
      display_name: "Ada",
      first_name: "Ada",
      emails: ["ada@x.com"],
      phones: ["111"],
      labels: ["A"],
      notes: "note1",
      starred: false,
    });
    const other = contact({
      id: "2",
      display_name: "Ada Lovelace",
      last_name: "Lovelace",
      company: "AE",
      emails: ["ada@x.com", "ada2@x.com"],
      phones: ["222"],
      labels: ["B"],
      notes: "note2",
      starred: true,
    });
    const merged = mergeContacts(primary, [other]);
    expect(merged.display_name).toBe("Ada");
    expect(merged.first_name).toBe("Ada");
    expect(merged.last_name).toBe("Lovelace");
    expect(merged.company).toBe("AE");
    expect(merged.emails).toEqual(["ada@x.com", "ada2@x.com"]);
    expect(merged.phones).toEqual(["111", "222"]);
    expect(merged.labels).toEqual(["A", "B"]);
    expect(merged.notes).toBe("note1\n\nnote2");
    expect(merged.starred).toBe(true);
  });
});
