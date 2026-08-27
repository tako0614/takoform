import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  classifySpecificationPublicationSource,
  validateRecordHead,
  validateRepositoryRecords,
  validateRetiredWriterHistory,
  validateSchemaLedgerShape,
  validateSpecificationLedger,
} from "./records.mjs";

const specification = JSON.parse(
  readFileSync(new URL("../release/specification-releases.json", import.meta.url)),
);
const schemas = JSON.parse(
  readFileSync(new URL("../release/public-schema-identities.json", import.meta.url)),
);
const combinedChain = JSON.parse(
  readFileSync(new URL("../release/record-prefix-chain.json", import.meta.url)),
);
const recordHead = readFileSync(
  new URL("../release/record-head.json", import.meta.url),
);
const recordSignature = JSON.parse(
  readFileSync(new URL("../release/record-head.sig.json", import.meta.url)),
);
const recordKey = readFileSync(
  new URL("../release/authority/record-head-ed25519.pub.pem", import.meta.url),
);
const retiredWriter = JSON.parse(
  readFileSync(
    new URL(
      "../docs/extraction/history/w10-retired-specification-writer.json",
      import.meta.url,
    ),
  ),
);

describe("sealed W09 history and platform-neutral schema records", () => {
  test("the pure Core record closure is complete", async () => {
    expect(await validateRepositoryRecords(".")).toEqual([]);
  });

  test("Specification 1.1 is exact history and no numbered successor is accepted", () => {
    expect(validateSpecificationLedger(specification)).toEqual([]);
    const future = structuredClone(specification);
    future.releases.push({ version: "1.2", tag: "specification/1.2" });
    expect(validateSpecificationLedger(future)).toContain(
      "Specification ledger must remain the sealed one-record historical 1.1 receipt",
    );
    const rewritten = structuredClone(specification);
    rewritten.releases[0].tagObject = "0".repeat(40);
    expect(validateSpecificationLedger(rewritten)).toContain(
      "Specification 1.1 immutable receipt changed",
    );
  });

  test("the imported active and verify-only schema prefixes cannot move", () => {
    expect(validateSchemaLedgerShape(schemas)).toEqual([]);
    const rewritten = structuredClone(schemas);
    rewritten.identities[0].sha256 = `sha256:${"0".repeat(64)}`;
    expect(validateSchemaLedgerShape(rewritten)).toContain(
      "imported 31-entry active schema prefix changed or was removed",
    );
    const promoted = structuredClone(schemas);
    promoted.identities.push(promoted.retired.shift());
    expect(validateSchemaLedgerShape(promoted)).toEqual(
      expect.arrayContaining([
        "imported 15-entry verify-only schema prefix changed or was removed",
      ]),
    );
  });

  test("the imported combined head remains independently signed", () => {
    expect(
      validateRecordHead(recordHead, recordSignature, recordKey, combinedChain),
    ).toEqual([]);
    const changed = Buffer.from(recordHead);
    changed[20] ^= 1;
    expect(
      validateRecordHead(changed, recordSignature, recordKey, combinedChain),
    ).not.toEqual([]);
  });

  test("deleted writer bytes remain recoverable from exact P history only", () => {
    expect(validateRetiredWriterHistory(retiredWriter, { root: "." })).toEqual([]);
    const changed = structuredClone(retiredWriter);
    changed.files[0].sha256 = `sha256:${"0".repeat(64)}`;
    expect(
      validateRetiredWriterHistory(changed, { root: ".", verifyGit: false }),
    ).toContain("retired Specification writer history manifest changed");
  });

  test("v2 language is inert only in explicitly classified proposals", () => {
    expect(
      classifySpecificationPublicationSource(
        "spec/proposals/future.md",
        Buffer.from(
          "---\nclassification: non-normative-proposal\n---\n\nPossible `forms.takoform.com/v2`.\n",
        ),
      ),
    ).toBe("non-normative-proposal");
    expect(() =>
      classifySpecificationPublicationSource(
        "spec/host-api/v2.md",
        Buffer.from("Host `forms.takoform.com/v2`.\n"),
      )
    ).toThrow();
  });
});
