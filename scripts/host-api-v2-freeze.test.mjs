import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  EXACT_HOST_API,
  EXPECTED_NORMATIVE_PROSE,
  FREEZE_KIND,
  FREEZE_PATH,
  verifyV2Freeze,
} from "./host-api-v2-freeze.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function write(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function createFixture({ committedFreeze = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "takoform-host-api-v2-freeze-"));
  temporaryRoots.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "freeze-test@example.invalid");
  git(root, "config", "user.name", "Freeze Test");
  write(root, ".gitignore", "\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "--quiet", "-m", "fixture root");

  for (const path of EXPECTED_NORMATIVE_PROSE)
    write(root, path, `# ${path}\n\nNormative Host API v2 contract.\n`);
  write(root, "spec/host-api/v2/examples.md", "# Mutable nonnormative examples\n");
  write(root, "spec/host-api/v2/migration.md", "# Mutable nonnormative migration\n");
  write(root, "website/theme.md", "# Mutable presentation\n");
  const manifest = {
    kind: FREEZE_KIND,
    api: EXACT_HOST_API,
    normativeProse: EXPECTED_NORMATIVE_PROSE.map((path) => ({
      path,
      sha256: digest(readFileSync(join(root, path))),
    })),
  };
  write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  if (committedFreeze) {
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "first Host API v2 normative freeze");
  }
  return { root, manifest };
}

describe("Host API v2 normative freeze", () => {
  test("rejects JSON null both before and after a first-add anchor", () => {
    const { root } = createFixture();
    write(root, FREEZE_PATH, "null\n");
    expect(verifyV2Freeze(root, { mode: "bootstrap" }).status).toBe("INVALID");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "invalid null manifest");
    expect(verifyV2Freeze(root, { requireFrozen: true }).status).toBe("INVALID");
  });

  test("pins only the three normative API v2 prose documents", () => {
    expect(EXPECTED_NORMATIVE_PROSE).toEqual([
      "spec/host-api/v2/README.md",
      "spec/host-api/v2/http.md",
      "spec/host-api/v2/forms.md",
    ]);
    expect(EXPECTED_NORMATIVE_PROSE).not.toContain("spec/host-api/v2/examples.md");
    expect(EXPECTED_NORMATIVE_PROSE).not.toContain("spec/host-api/v2/migration.md");
    expect(EXPECTED_NORMATIVE_PROSE.some((path) => /schema|package|trust/u.test(path))).toBe(false);
  });

  test("reports an absent manifest as unfrozen unless frozen status is required", () => {
    const { root } = createFixture();
    rmSync(join(root, FREEZE_PATH));

    expect(verifyV2Freeze(root)).toEqual({
      status: "UNFROZEN",
      problems: [],
      firstAddCommit: null,
    });
    const required = verifyV2Freeze(root, { requireFrozen: true });
    expect(required.status).toBe("INVALID");
    expect(required.problems.join("\n")).toContain("requires a frozen Host API v2 closure");
  });

  test("bootstrap validates a candidate without writing or claiming it is frozen", () => {
    const { root } = createFixture();
    const manifestBefore = readFileSync(join(root, FREEZE_PATH));
    const result = verifyV2Freeze(root, { mode: "bootstrap" });

    expect(result).toEqual({
      status: "BOOTSTRAP_CANDIDATE",
      problems: [],
      firstAddCommit: null,
    });
    expect(readFileSync(join(root, FREEZE_PATH))).toEqual(manifestBefore);
  });

  test("bootstrap catches source digest drift and a relisted closure", () => {
    const { root, manifest } = createFixture();
    write(root, EXPECTED_NORMATIVE_PROSE[0], "changed before freeze\n");
    expect(verifyV2Freeze(root, { mode: "bootstrap" }).problems.join("\n"))
      .toContain(`${EXPECTED_NORMATIVE_PROSE[0]} differs from its frozen sha256`);

    manifest.normativeProse[0] = {
      path: "spec/host-api/v2/examples.md",
      sha256: digest(readFileSync(join(root, "spec/host-api/v2/examples.md"))),
    };
    write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(verifyV2Freeze(root, { mode: "bootstrap" }).problems.join("\n"))
      .toContain("normativeProse paths or order differ from the intended Host API v2 closure");
  });

  test("first-add commit anchors manifest and prose, while examples and presentation stay mutable", () => {
    const { root } = createFixture({ committedFreeze: true });
    const firstAdd = git(root, "log", "-1", "--format=%H", "--", FREEZE_PATH);
    expect(verifyV2Freeze(root)).toEqual({
      status: "FROZEN",
      problems: [],
      firstAddCommit: firstAdd,
    });

    write(root, "spec/host-api/v2/examples.md", "# Revised example\n");
    write(root, "spec/host-api/v2/migration.md", "# Revised migration\n");
    write(root, "website/theme.md", "# Revised theme\n");
    expect(verifyV2Freeze(root).problems).toEqual([]);
  });

  test("recomputing a changed normative digest cannot rewrite frozen prose", () => {
    const { root, manifest } = createFixture({ committedFreeze: true });
    const changed = "# Changed normative contract\n";
    write(root, EXPECTED_NORMATIVE_PROSE[1], changed);
    manifest.normativeProse[1].sha256 = digest(changed);
    write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

    const problems = verifyV2Freeze(root).problems.join("\n");
    expect(problems).toContain(`${FREEZE_PATH} differs from its first-add commit`);
    expect(problems).toContain(
      `${EXPECTED_NORMATIVE_PROSE[1]} differs from its first-add commit`,
    );
  });

  test("does not let a Git replacement object rewrite first-add provenance", () => {
    const { root, manifest } = createFixture({ committedFreeze: true });
    const firstAdd = git(root, "log", "-1", "--format=%H", "--", FREEZE_PATH);
    const changedPath = EXPECTED_NORMATIVE_PROSE[0];
    const changed = "# Alternate parentless freeze tree\n";
    write(root, changedPath, changed);
    manifest.normativeProse[0].sha256 = digest(changed);
    write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    git(root, "add", changedPath, FREEZE_PATH);
    const replacementTree = git(root, "write-tree");
    const replacementCommit = git(
      root,
      "commit-tree",
      replacementTree,
      "-m",
      "replacement parentless freeze tree",
    );
    git(root, "replace", firstAdd, replacementCommit);

    const result = verifyV2Freeze(root);
    expect(result.status).toBe("INVALID");
    expect(result.problems.join("\n")).toContain(
      `${changedPath} differs from its first-add commit ${firstAdd}`,
    );
  });

  test("refuses a legacy graft file instead of trusting rewritten history", () => {
    const { root } = createFixture({ committedFreeze: true });
    write(root, ".git/info/grafts", "# legacy history override\n");

    const result = verifyV2Freeze(root);
    expect(result.status).toBe("INVALID");
    expect(result.problems.join("\n")).toContain(
      "legacy Git graft file exists; cannot prove first-add history",
    );
  });

  test("rejects requireFrozen in bootstrap mode", () => {
    const { root } = createFixture();
    expect(() => verifyV2Freeze(root, { mode: "bootstrap", requireFrozen: true }))
      .toThrow("requireFrozen cannot be used with bootstrap mode");
  });

  test("rejects removal and deletion/re-addition of an anchored manifest", () => {
    const removed = createFixture({ committedFreeze: true });
    rmSync(join(removed.root, FREEZE_PATH));
    const missing = verifyV2Freeze(removed.root);
    expect(missing.status).toBe("INVALID");
    expect(missing.problems.join("\n")).toContain("was first added at");

    const readded = createFixture({ committedFreeze: true });
    git(readded.root, "rm", "--quiet", FREEZE_PATH);
    git(readded.root, "commit", "--quiet", "-m", "remove freeze manifest");
    write(readded.root, FREEZE_PATH, `${JSON.stringify(readded.manifest, null, 2)}\n`);
    git(readded.root, "add", FREEZE_PATH);
    git(readded.root, "commit", "--quiet", "-m", "re-add freeze manifest");
    const problems = verifyV2Freeze(readded.root).problems.join("\n");
    expect(problems).toContain("was deleted in Git history");
  });

  test("rejects an unanchored manifest in check mode and refuses bootstrap after first add", () => {
    const { root } = createFixture();
    expect(verifyV2Freeze(root).problems.join("\n")).toContain("has no first-add commit");
    git(root, "add", FREEZE_PATH);
    git(root, "commit", "--quiet", "-m", "first add manifest");
    expect(verifyV2Freeze(root, { mode: "bootstrap" }).problems.join("\n"))
      .toContain("bootstrap is forbidden after the freeze manifest entered Git history");
  });

  test("rejects shallow history because the first-add commit cannot be proven", () => {
    const { root } = createFixture({ committedFreeze: true });
    const head = git(root, "rev-parse", "HEAD");
    write(root, ".git/shallow", `${head}\n`);

    const result = verifyV2Freeze(root);
    expect(result.status).toBe("INVALID");
    expect(result.problems.join("\n")).toContain(
      "cannot prove the first-add commit from a shallow Git history",
    );
  });
});
