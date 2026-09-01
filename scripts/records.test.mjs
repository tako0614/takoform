import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  schemaOriginWriterClosurePaths,
  validateRepositoryRecords,
  validateSchemaLedgerShape,
  validateSchemaOriginAuthority,
  validateSchemaOriginWriterClosureManifest,
  validateTrustProfile,
} from "./records.mjs";

function repositoryJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Host API v1 and schema-origin records", () => {
  test("the repository closes every active schema byte and retained history hash", async () => {
    expect(await validateRepositoryRecords()).toEqual([]);
  });

  test("the imported active and verify-only schema prefixes are immutable", () => {
    const ledger = repositoryJSON("release/public-schema-identities.json");
    expect(validateSchemaLedgerShape(ledger)).toEqual([]);

    const changed = structuredClone(ledger);
    changed.identities[0].sha256 = `sha256:${"0".repeat(64)}`;
    expect(validateSchemaLedgerShape(changed)).toContain(
      "imported schema identities prefix changed or moved",
    );
  });

  test("schema-origin authority is bound to Host API v1 and one schema ledger", () => {
    const authority = repositoryJSON("release/schema-origin-authority.json");
    expect(validateSchemaOriginAuthority(authority)).toEqual([]);

    const wrongLane = structuredClone(authority);
    wrongLane.hostApi = "forms.takoform.com/v1.1";
    expect(validateSchemaOriginAuthority(wrongLane)).toContain(
      "schema-origin authority must bind the literal Host API v1 closure and schema ledger",
    );

    const wrongClosure = structuredClone(authority);
    wrongClosure.hostApiClosure = "release/other-host-api.json";
    expect(validateSchemaOriginAuthority(wrongClosure)).toContain(
      "schema-origin authority must bind the literal Host API v1 closure and schema ledger",
    );

    const extraAxis = { ...authority, documentReleaseVersion: "1.2" };
    expect(validateSchemaOriginAuthority(extraAxis)).toContain(
      "schema-origin authority has an invalid closed envelope",
    );
  });

  test("schema-origin writer closure names only its exact execution inputs", () => {
    expect(
      validateSchemaOriginWriterClosureManifest({
        format: "takoform.schema-origin-writer-closure@v1",
        paths: [...schemaOriginWriterClosurePaths],
      }),
    ).toEqual([]);
    expect(
      validateSchemaOriginWriterClosureManifest({
        format: "takoform.schema-origin-writer-closure@v1",
        paths: [...schemaOriginWriterClosurePaths, "scripts/extra-writer.mjs"],
      }),
    ).not.toEqual([]);
  });

  test("the generic trust profile remains caller-supplied and offline", () => {
    const profile = repositoryJSON("spec/trust/profile.json");
    expect(validateTrustProfile(profile)).toEqual([]);

    const changed = structuredClone(profile);
    changed.publisherPolicy.officialTrustBypass = true;
    changed.signature.ambientTrustedRoot = true;
    expect(validateTrustProfile(changed)).toEqual(expect.arrayContaining([
      "Core trust profile must set officialTrustBypass to false",
      "Core trust profile must use explicit offline trust inputs without an ambient root",
    ]));
  });
});
