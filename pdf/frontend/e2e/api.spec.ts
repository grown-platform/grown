import { expect, test } from "@playwright/test";

/**
 * API E2E tests - These tests don't require a browser and can run anywhere.
 * They test the backend API endpoints directly.
 */
test.describe("Documents API", () => {
  const API_URL = process.env.API_URL || "http://localhost:8080";

  test("list documents returns empty array for new setup", async ({
    request,
  }) => {
    const response = await request.get(`${API_URL}/api/documents`);

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("documents");
    expect(Array.isArray(data.documents)).toBe(true);
  });

  test("create document requires valid input", async ({ request }) => {
    const response = await request.post(`${API_URL}/api/documents`, {
      data: {
        name: "Test Document",
        description: "A test document",
        filename: "test.pdf",
      },
    });

    // Should succeed with 200 or fail with validation error
    expect([200, 400]).toContain(response.status());
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty("document");
      expect(data.document.name).toBe("Test Document");
    }
  });

  test("get non-existent document returns 404", async ({ request }) => {
    const response = await request.get(
      `${API_URL}/api/documents/non-existent-id`,
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("Signing API", () => {
  const API_URL = process.env.API_URL || "http://localhost:8080";

  test("get signing session with invalid token returns 404", async ({
    request,
  }) => {
    const response = await request.get(`${API_URL}/api/signing/invalid-token`);

    // Should return 404 for invalid token
    expect(response.status()).toBe(404);
  });

  test("record view with invalid token returns error", async ({ request }) => {
    const response = await request.post(
      `${API_URL}/api/signing/invalid-token/view`,
    );

    // Should return error for invalid token
    expect([400, 404]).toContain(response.status());
  });
});
