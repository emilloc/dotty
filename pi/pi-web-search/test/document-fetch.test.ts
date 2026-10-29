import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  fetchDocument,
  publicAddress,
  publicTarget,
} from "../src/documents/fetch.js";
import {
  createDocumentFixture,
  type DocumentFixture,
} from "./document-fixture.js";

describe("bounded document fetch", () => {
  let fixture: DocumentFixture;
  before(async () => {
    fixture = await createDocumentFixture();
  });
  after(async () => {
    await fixture.close();
  });

  const localDependencies = {
    fetch: globalThis.fetch,
    now: Date.now,
  };

  it("follows bounded HTTP redirects and records source metadata", async () => {
    const result = await fetchDocument(
      `${fixture.baseUrl}/redirect`,
      1_000,
      100_000,
      undefined,
      localDependencies,
    );
    assert.equal(result.error, undefined);
    assert.equal(result.value?.requestedUrl, `${fixture.baseUrl}/redirect`);
    assert.equal(result.value?.finalUrl, `${fixture.baseUrl}/technical`);
    assert.equal(result.value?.statusCode, 200);
    assert.equal(result.value?.etag, '"fixture-v1"');
    assert.ok((result.value?.downloadedBytes ?? 0) > 0);
  });

  it("rejects declared and streamed oversized bodies before unbounded buffering", async () => {
    for (const path of ["/oversize", "/chunked-oversize"]) {
      const result = await fetchDocument(
        `${fixture.baseUrl}${path}`,
        1_000,
        100,
        undefined,
        localDependencies,
      );
      assert.equal(result.error?.code, "fetch_failed");
      assert.match(result.error?.message ?? "", /100-byte download limit/);
    }
  });

  it("enforces the redirect limit", async () => {
    const result = await fetchDocument(
      `${fixture.baseUrl}/redirect-loop`,
      1_000,
      1_000,
      undefined,
      localDependencies,
    );
    assert.equal(result.error?.code, "fetch_failed");
    assert.match(result.error?.message ?? "", /5-redirect limit/);
  });

  it("returns structured timeouts and promptly forwards cancellation", async () => {
    const timeout = await fetchDocument(
      `${fixture.baseUrl}/slow`,
      10,
      1_000,
      undefined,
      localDependencies,
    );
    assert.equal(timeout.error?.code, "timeout");

    const controller = new AbortController();
    const execution = fetchDocument(
      `${fixture.baseUrl}/slow`,
      1_000,
      1_000,
      controller.signal,
      localDependencies,
    );
    controller.abort(new Error("cancelled by fixture test"));
    await assert.rejects(execution, /cancelled by fixture test/);
  });

  it("returns structured HTTP and URL errors", async () => {
    const missing = await fetchDocument(
      `${fixture.baseUrl}/missing`,
      1_000,
      1_000,
      undefined,
      localDependencies,
    );
    assert.equal(missing.error?.code, "fetch_failed");
    assert.equal(missing.error?.retryable, false);

    const unsupported = await fetchDocument(
      "file:///tmp/a",
      1_000,
      1_000,
      undefined,
      localDependencies,
    );
    assert.equal(unsupported.error?.code, "invalid_request");
  });

  it("blocks private, reserved, and non-default-port document targets", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "100.64.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "2001:db8::1",
    ]) {
      assert.equal(publicAddress(address), false, address);
    }
    assert.equal(publicAddress("93.184.216.34"), true);
    assert.equal(publicAddress("2606:2800:220:1:248:1893:25c8:1946"), true);

    await assert.rejects(
      publicTarget(new URL("https://example.com/"), async () => [
        { address: "127.0.0.1", family: 4 },
      ]),
      /non-public network address/,
    );
    await assert.rejects(
      publicTarget(new URL("https://example.com:8443/"), async () => [
        { address: "93.184.216.34", family: 4 },
      ]),
      /default HTTP and HTTPS ports/,
    );

    const blocked = await fetchDocument(
      `${fixture.baseUrl}/technical`,
      1_000,
      100_000,
    );
    assert.equal(blocked.error?.code, "blocked");
  });
});
