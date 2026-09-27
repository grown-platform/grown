import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BASE_URL,
  STORAGE_STATE,
  createDeck,
  createDoc,
  createSheet,
  saveSheet,
  trashDeck,
  trashDoc,
  trashSheet,
} from "./helpers";

// Cross-user authorization checks against a running stack, with a second,
// real signed-in user. The user ("authz-stranger") is created in the LOCAL
// dev Zitadel with the bootstrap PAT (skipped when the PAT isn't there), and
// signs in through the normal OIDC flow on :8080, whose callback provisions
// them into their own personal org. The Go suite (internal/server/authz_*)
// covers the full matrix; this checks the same boundaries end to end.

const LOGIN_URL = "http://workspace.localtest.me:8080"; // OIDC callback host
const ZITADEL_URL = process.env.GROWN_ZITADEL_URL ?? "http://localhost:8081";
const PAT_FILE =
  process.env.GROWN_ZITADEL_PAT_FILE ??
  path.join(
    process.env.GROWN_LOCAL_DATA ?? path.join(os.homedir(), ".grown-local"),
    "root/deploy/zitadel/data/bootstrap-pat.txt",
  );
const STRANGER = "authz-stranger";
const PASSWORD = "DevPassword!1";
// bcrypt-12 of DevPassword!1, as deploy/zitadel/create-oidc-app.sh uses.
const PASSWORD_HASH =
  "$2a$12$JfZJYQiQGc1UYEC4.al/Ne6OAFOdLxpzlByX5R./DwiFM/.EhQuze";
const STRANGER_STATE = path.join(
  path.dirname(STORAGE_STATE),
  "authz-stranger.json",
);

async function ensureZitadelUser(pat: string) {
  const api = await pwRequest.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${pat}` },
  });
  try {
    const found = await api.post(`${ZITADEL_URL}/v2/users`, {
      data: {
        queries: [
          {
            userNameQuery: {
              userName: STRANGER,
              method: "TEXT_QUERY_METHOD_EQUALS",
            },
          },
        ],
      },
    });
    expect(found.ok()).toBeTruthy();
    if (((await found.json()).result ?? []).length > 0) return;
    const org = await (
      await api.get(`${ZITADEL_URL}/management/v1/orgs/me`)
    ).json();
    const created = await api.post(
      `${ZITADEL_URL}/management/v1/users/human/_import`,
      {
        headers: { "x-zitadel-orgid": org.org.id },
        data: {
          userName: STRANGER,
          profile: {
            firstName: "Authz",
            lastName: "Stranger",
            displayName: "Authz Stranger",
          },
          email: {
            email: `${STRANGER}@grown.localtest.me`,
            isEmailVerified: true,
          },
          hashedPassword: { value: PASSWORD_HASH },
          passwordChangeRequired: false,
        },
      },
    );
    expect(created.ok(), await created.text()).toBeTruthy();
  } finally {
    await api.dispose();
  }
}

async function signIn(browser: Browser) {
  // A clean context: the project's storageState carries the admin's Zitadel
  // session, which would sign the admin straight back in.
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto(`${LOGIN_URL}/api/v1/auth/login`);
  await expect(page).toHaveURL(/localhost:8081/);
  await page
    .locator('input[name="loginName"], input[id="loginName"]')
    .fill(STRANGER);
  await page.locator('button[type="submit"]').first().click();
  await page
    .locator('input[name="password"], input[id="password"]')
    .fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/workspace\.localtest\.me:8080\/?/, {
    timeout: 30_000,
  });
  await ctx.storageState({ path: STRANGER_STATE });
  await ctx.close();
}

let admin: APIRequestContext;
let stranger: APIRequestContext;
let anon: APIRequestContext;
let strangerID = "";
let sheetID = "";
let docID = "";
let deckID = "";
const SECRET = "authz-e2e-secret";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  if (!fs.existsSync(PAT_FILE)) {
    test.skip(true, `no local Zitadel PAT at ${PAT_FILE}`);
    return;
  }
  await ensureZitadelUser(fs.readFileSync(PAT_FILE, "utf8").trim());
  await signIn(browser);
  admin = await pwRequest.newContext({ storageState: STORAGE_STATE });
  stranger = await pwRequest.newContext({ storageState: STRANGER_STATE });
  anon = await pwRequest.newContext({
    storageState: { cookies: [], origins: [] },
  });

  const me = await (await admin.get(`${BASE_URL}/api/v1/whoami`)).json();
  const them = await (await stranger.get(`${BASE_URL}/api/v1/whoami`)).json();
  strangerID = them.user.id;
  test.skip(
    me.org.id === them.org.id,
    "the second user landed in the admin's org (GROWN_PERSONAL_ORGS off)",
  );

  sheetID = await createSheet(admin, "authz e2e sheet");
  await saveSheet(admin, sheetID, [
    {
      id: "s1",
      name: "Sheet1",
      celldata: [
        { r: 0, c: 0, v: { v: 3 } },
        { r: 0, c: 1, v: { f: "=A1*2" } },
        { r: 0, c: 2, v: { v: SECRET } },
      ],
    },
  ]);
  docID = await createDoc(admin, "authz e2e doc");
  deckID = await createDeck(admin, "authz e2e deck");
});

test.afterAll(async () => {
  if (!admin) return;
  if (sheetID) await trashSheet(admin, sheetID);
  if (docID) await trashDoc(admin, docID);
  if (deckID) await trashDeck(admin, deckID);
  await Promise.all([admin.dispose(), stranger?.dispose(), anon?.dispose()]);
});

test("anonymous requests are refused", async () => {
  const cases: Array<[string, string, unknown?]> = [
    ["POST", `/api/v1/sheets/d/${sheetID}/recalc`, { data: "[]" }],
    ["GET", `/api/v1/sheets/d/${sheetID}/deps?cell=B1`],
    ["POST", `/api/v1/sheets/d/${sheetID}/structure`, { op: {} }],
    ["GET", `/api/v1/versions/sheets/${sheetID}`],
    ["POST", `/api/v1/slides/d/${deckID}/mentions`, { user_ids: [] }],
    ["GET", "/api/v1/convert/capabilities"],
    ["POST", "/api/v1/docs/import?from=md", "# hi"],
  ];
  for (const [method, p, data] of cases) {
    const res = await anon.fetch(`${BASE_URL}${p}`, { method, data });
    expect(res.status(), `${method} ${p}`).toBe(401);
  }
  // Protection reads without access look like a missing document.
  const prot = await anon.get(`${BASE_URL}/api/v1/docs/d/${docID}/protection`);
  expect(prot.status()).toBe(404);
});

test("a user of another org can't reach the documents", async ({ browser }) => {
  const cases: Array<[string, string, unknown?]> = [
    ["GET", `/api/v1/sheets/d/${sheetID}/deps?cell=B1`],
    ["POST", `/api/v1/sheets/d/${sheetID}/recalc`, { data: "[]" }],
    [
      "POST",
      `/api/v1/sheets/d/${sheetID}/goalseek`,
      { formulaCell: "B1", target: 10, changingCell: "A1" },
    ],
    [
      "POST",
      `/api/v1/sheets/d/${sheetID}/structure`,
      { op: { kind: "insert", axis: "row", sheet: "s1", index: 0, count: 1 } },
    ],
    ["GET", `/api/v1/versions/sheets/${sheetID}`],
    ["POST", `/api/v1/versions/sheets/${sheetID}`, { label: "x" }],
    ["GET", `/api/v1/docs/d/${docID}/protection`],
    ["PUT", `/api/v1/docs/d/${docID}/protection`, { mode: "none" }],
    ["POST", `/api/v1/slides/d/${deckID}/mentions`, { user_ids: [strangerID] }],
    ["GET", `/api/v1/versions/slides/${deckID}`],
  ];
  for (const [method, p, data] of cases) {
    const res = await stranger.fetch(`${BASE_URL}${p}`, { method, data });
    expect(res.status(), `${method} ${p}`).toBe(404);
    expect(await res.text()).not.toContain(SECRET);
  }
  // Nor through the collab socket.
  const ctx = await browser.newContext({ storageState: STRANGER_STATE });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/healthz`);
    const opened = await page.evaluate(
      (url) =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket(url);
          ws.onopen = () => resolve(true);
          ws.onerror = () => resolve(false);
          ws.onclose = () => resolve(false);
        }),
      `${BASE_URL.replace(/^http/, "ws")}/api/v1/sheets/d/${sheetID}/connect`,
    );
    expect(opened).toBe(false);
  } finally {
    await ctx.close();
  }
});

test("a viewer grant reads but can't write", async () => {
  const grant = await admin.post(
    `${BASE_URL}/api/v1/sheets/d/${sheetID}/grants`,
    {
      data: { sheet_id: sheetID, grantee_user_id: strangerID, role: "viewer" },
    },
  );
  expect(grant.ok(), await grant.text()).toBeTruthy();

  const deps = await stranger.get(
    `${BASE_URL}/api/v1/sheets/d/${sheetID}/deps?cell=B1`,
  );
  expect(deps.status()).toBe(200);
  expect((await deps.json()).precedents?.length ?? 0).toBeGreaterThan(0);

  const structure = await stranger.post(
    `${BASE_URL}/api/v1/sheets/d/${sheetID}/structure`,
    {
      data: {
        op: { kind: "insert", axis: "row", sheet: "s1", index: 0, count: 1 },
      },
    },
  );
  expect(structure.status()).toBe(403);

  const list = await stranger.get(
    `${BASE_URL}/api/v1/versions/sheets/${sheetID}`,
  );
  expect(list.status()).toBe(200);
  expect((await list.json()).can_edit).toBe(false);
  const name = await stranger.post(
    `${BASE_URL}/api/v1/versions/sheets/${sheetID}`,
    {
      data: { label: "viewer" },
    },
  );
  expect(name.status()).toBe(403);

  // The owner still edits.
  const own = await admin.post(
    `${BASE_URL}/api/v1/versions/sheets/${sheetID}`,
    {
      data: { label: "owner" },
    },
  );
  expect(own.status()).toBe(200);
});
