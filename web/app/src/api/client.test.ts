import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "./client";

describe("api/client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loginURL returns /api/v1/auth/login", () => {
    expect(client.loginURL()).toBe("/api/v1/auth/login");
  });

  it("whoami returns ok with parsed body on 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: {
            id: "u1",
            org_id: "o1",
            oidc_issuer: "i",
            oidc_subject: "s",
            email: "e@x",
            display_name: "E",
            created_at: "1",
          },
          org: { id: "o1", slug: "default", display_name: "Default" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const r = await client.whoami();
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data.user.email).toBe("e@x");
      expect(r.data.org.slug).toBe("default");
    }
  });

  it("whoami returns unauthenticated on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "no session" }), { status: 401 }),
    );
    const r = await client.whoami();
    expect(r.status).toBe("unauthenticated");
  });

  it("whoami returns error on 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("boom", { status: 500 }),
    );
    const r = await client.whoami();
    expect(r.status).toBe("error");
  });

  it("logout posts to /api/v1/auth/logout and returns ok on 200", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await client.logout();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
