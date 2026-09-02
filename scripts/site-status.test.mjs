import { describe, expect, test } from "bun:test";

import {
  SITE_STATUS_FIELDS,
  SITE_STATUS_FORMAT,
  SITE_STATUS_ROUTE,
  SITE_STATUS_SOURCE_PATH,
  deriveSiteStatus,
  renderSiteStatus,
  servedPathForIdentity,
  verifySiteStatus,
} from "./site-status.mjs";

const status = deriveSiteStatus(".");

describe("takoform.com site status", () => {
  test("derives from this repository's records and matches the served copy", () => {
    expect(verifySiteStatus(".")).toEqual([]);
    expect(status.format).toBe(SITE_STATUS_FORMAT);
    expect(SITE_STATUS_ROUTE).toBe("/.well-known/takoform-site.json");
    expect(SITE_STATUS_SOURCE_PATH).toBe(`website/public${SITE_STATUS_ROUTE}`);
  });

  test("keeps the published field order, because a reader diffs two documents", () => {
    expect(Object.keys(status)).toEqual([...SITE_STATUS_FIELDS]);
    expect(Object.keys(JSON.parse(renderSiteStatus(".")))).toEqual([...SITE_STATUS_FIELDS]);
    expect(renderSiteStatus(".").endsWith("}\n")).toBe(true);
  });

  test("states the exact v1 lane and never a Core version derived from it", () => {
    expect(status.hostApi.lane).toBe("forms.takoform.com/v1");
    expect(status.hostApi.discoveryPath).toBe("/.well-known/takoform/v1");
    expect(status.hostApi.apiRoot).toBe("/apis/forms.takoform.com/v1");
    expect(status.core.hostApiEffect).toBe("none");
    expect(status.core.formPublicationEffect).toBe("none");
    expect(JSON.stringify(status)).not.toContain("forms.takoform.com/v1.1");
    expect(JSON.stringify(status)).not.toContain("forms.takoform.com/v2");
  });

  test("pins only the machine bytes of the v1 lane, never the editable prose", () => {
    const paths = status.hostApi.machineSources.map((entry) => entry.path);
    expect(paths).toContain("spec/host-api/operations-v1.json");
    expect(paths.some((path) => path.endsWith(".md"))).toBe(false);
    for (const entry of status.hostApi.machineSources) {
      expect(entry.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
  });

  test("publishes every ledger identity at the path its own $id names", () => {
    expect(status.schemas.identityOrigin).toBe("https://forms.takoform.com");
    expect(status.schemas.identities.length).toBe(
      status.schemas.activeCount + status.schemas.verifyOnlyCount,
    );
    for (const identity of status.schemas.identities) {
      expect(identity.id).toBe(`${status.schemas.identityOrigin}${identity.path}`);
      expect(identity.source.startsWith("spec/schemas/")).toBe(true);
      expect(["active", "verify-only"]).toContain(identity.status);
    }
    const paths = status.schemas.identities.map((identity) => identity.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("refuses an identity whose served path is not the one its $id names", () => {
    expect(() =>
      servedPathForIdentity({
        id: "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
        public: "website/public/schemas/elsewhere/form-ref.schema.json",
      })
    ).toThrow("declares public path");
  });

  test("refuses an identity served from another origin", () => {
    expect(() =>
      servedPathForIdentity({
        id: "https://example.test/schemas/v1/form-ref.schema.json",
        public: "website/public/schemas/v1/form-ref.schema.json",
      })
    ).toThrow("identity origin");
  });

  test("names the absences, because the absences are what readers get wrong", () => {
    expect(status.notPublishedHere).toContain("publisher-form-catalogs-and-rosters");
    expect(status.notPublishedHere).toContain("client-adapter-availability-or-status");
    expect(status.notPublishedHere).toContain("realized-dns-cdn-account-or-credential-state");
  });

  test("reports a drifted served copy instead of silently regenerating it", () => {
    const problems = verifySiteStatus("scripts");
    expect(problems.length).toBeGreaterThan(0);
  });

  test("carries the immutable Specification receipt and the withdrawn identity", () => {
    const [receipt] = status.specification.releases;
    expect(receipt.version).toBe("1.1");
    expect(receipt.tag).toBe("specification/1.1");
    expect(receipt.immutable).toBe(true);
    expect(receipt.hostApiEffect).toBe("none");
    expect(status.specification.withdrawn).toContainEqual({
      version: "1.0",
      status: "withdrawn-retained",
      noReuse: true,
    });
  });

  test("carries the signed record head digest it can verify", () => {
    expect(status.records.kind).toBe("takoform.record-head@v1");
    expect(status.records.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(status.records.signatureAlgorithm).toBe("ed25519");
  });
});
