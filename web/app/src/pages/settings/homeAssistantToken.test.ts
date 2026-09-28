import { describe, it, expect } from "vitest";
import { HOME_ASSISTANT_SCOPES, homeAssistantTokenRequest } from "./homeAssistantToken";

describe("Home Assistant token preset", () => {
  it("requests a no-expiry token with exactly the integration's scopes", () => {
    expect(homeAssistantTokenRequest()).toEqual({
      name: "Home Assistant",
      scopes: [
        "calendar:read",
        "calendar:write",
        "tasks:read",
        "tasks:write",
        "notifications:read",
        "notifications:write",
      ],
      expires_in_days: 0,
    });
  });
  it("returns a fresh scopes array each call", () => {
    const a = homeAssistantTokenRequest();
    a.scopes.push("*");
    expect(homeAssistantTokenRequest().scopes).toHaveLength(HOME_ASSISTANT_SCOPES.length);
  });
});
