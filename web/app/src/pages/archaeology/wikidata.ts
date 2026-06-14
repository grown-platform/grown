/**
 * Live archaeological-site data from open sources — no backend, no hosting.
 *
 * Sites in the current map view come from the Wikidata Query Service (SPARQL,
 * CORS-enabled): items that are an archaeological site (or a subclass) with
 * coordinates inside the viewport bounding box. Per-site detail (the "what's
 * been found" read-up) comes from the Wikipedia REST summary plus a few
 * structured Wikidata facts. Everything is client-side and cached in-memory.
 */

export interface Site {
  qid: string;
  title: string;
  lat: number;
  lon: number;
  image?: string;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const SPARQL = "https://query.wikidata.org/sparql";

/** Q839954 = "archaeological site". P31/P279* matches it or any subclass. */
function boundsQuery(b: Bounds): string {
  const sw = `Point(${b.west} ${b.south})`;
  const ne = `Point(${b.east} ${b.north})`;
  return `SELECT ?item ?itemLabel ?coord ?image WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "${sw}"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "${ne}"^^geo:wktLiteral .
  }
  ?item wdt:P31/wdt:P279* wd:Q839954 .
  OPTIONAL { ?item wdt:P18 ?image }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,de,es,it". }
} LIMIT 300`;
}

function parsePoint(wkt: string): { lat: number; lon: number } | null {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(wkt);
  return m ? { lon: +m[1], lat: +m[2] } : null;
}

/** Query archaeological sites within a bounding box (in-memory cached by bbox). */
export async function sitesInBounds(b: Bounds): Promise<Site[]> {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(boundsQuery(b))}`;
  const r = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!r.ok) throw new Error(`Wikidata query failed (${r.status})`);
  const j = (await r.json()) as {
    results: {
      bindings: Array<{
        item: { value: string };
        itemLabel?: { value: string };
        coord: { value: string };
        image?: { value: string };
      }>;
    };
  };
  const seen = new Set<string>();
  const out: Site[] = [];
  for (const row of j.results.bindings) {
    const qid = row.item.value.replace("http://www.wikidata.org/entity/", "");
    if (seen.has(qid)) continue;
    const pt = parsePoint(row.coord.value);
    if (!pt) continue;
    seen.add(qid);
    out.push({
      qid,
      title: row.itemLabel?.value || qid,
      lat: pt.lat,
      lon: pt.lon,
      image: row.image?.value,
    });
  }
  return out;
}

export interface SiteDetail {
  title: string;
  extract: string;
  image?: string;
  wikipediaUrl?: string;
  wikidataUrl: string;
  facts: { label: string; value: string }[];
}

/** A few human-readable structured facts for a site (period, country, etc.). */
async function siteFacts(qid: string): Promise<{ facts: SiteDetail["facts"]; enTitle?: string }> {
  // Pull labels for a small set of properties + the enwiki sitelink in one go.
  const q = `SELECT ?typeLabel ?countryLabel ?inception ?cultureLabel ?heritageLabel ?article WHERE {
  OPTIONAL { wd:${qid} wdt:P31 ?type. }
  OPTIONAL { wd:${qid} wdt:P17 ?country. }
  OPTIONAL { wd:${qid} wdt:P571 ?inception. }
  OPTIONAL { wd:${qid} wdt:P2596 ?culture. }
  OPTIONAL { wd:${qid} wdt:P1435 ?heritage. }
  OPTIONAL { ?article schema:about wd:${qid}; schema:isPartOf <https://en.wikipedia.org/>. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 1`;
  try {
    const r = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/sparql-results+json" },
    });
    const j = (await r.json()) as {
      results: { bindings: Array<Record<string, { value: string }>> };
    };
    const b = j.results.bindings[0] || {};
    const facts: SiteDetail["facts"] = [];
    const add = (label: string, key: string) => {
      if (b[key]?.value) facts.push({ label, value: b[key].value });
    };
    add("Type", "typeLabel");
    add("Culture", "cultureLabel");
    add("Country", "countryLabel");
    add("Heritage status", "heritageLabel");
    if (b.inception?.value) {
      const yr = b.inception.value.slice(0, b.inception.value.indexOf("-", 1) > 0 ? b.inception.value.indexOf("-", 1) : 4);
      facts.push({ label: "Inception", value: yr });
    }
    const enTitle = b.article?.value
      ? decodeURIComponent(b.article.value.split("/wiki/")[1] || "").replace(/_/g, " ")
      : undefined;
    return { facts, enTitle };
  } catch {
    return { facts: [] };
  }
}

/** Full read-up for a site: Wikipedia summary + structured facts. */
export async function siteDetail(site: Site): Promise<SiteDetail> {
  const { facts, enTitle } = await siteFacts(site.qid);
  const detail: SiteDetail = {
    title: site.title,
    extract: "",
    image: site.image,
    wikidataUrl: `https://www.wikidata.org/wiki/${site.qid}`,
    facts,
  };
  const title = enTitle || site.title;
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    );
    if (r.ok) {
      const s = (await r.json()) as {
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
        thumbnail?: { source?: string };
        originalimage?: { source?: string };
      };
      detail.extract = s.extract || "";
      detail.wikipediaUrl = s.content_urls?.desktop?.page;
      detail.image = detail.image || s.originalimage?.source || s.thumbnail?.source;
    }
  } catch {
    /* no Wikipedia article — facts + Wikidata link still shown */
  }
  if (!detail.extract) {
    detail.extract =
      "No encyclopedia summary found for this site yet. Open it on Wikidata for the structured record and sources.";
  }
  return detail;
}
