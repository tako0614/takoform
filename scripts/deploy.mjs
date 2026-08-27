#!/usr/bin/env node

import process from "node:process";
import {
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SEALED_FORBIDDEN_AMBIENT_ENV,
  prepareSealedProposal,
} from "./sealed-deploy-launcher.mjs";
import {
  finishBrokeredDeploy,
  takeBrokeredDeploy,
} from "./sealed-deploy-bootstrap.mjs";

import {
  CORE_RELEASE,
  ReleaseFailure,
  auditCoreRelease,
  canonicalJSON,
  parseCoreReleaseArgs,
  prepareCoreRelease,
  publishCoreRelease,
  recordPrepareCoreRelease,
  recordPushCoreRelease,
  signCoreReleaseTag,
  verifyPublishedCoreRelease,
} from "./core-release.mjs";
import {
  SCHEMA_ORIGIN,
  SchemaOriginFailure,
  parseSchemaOriginArgs,
  runSchemaOriginDeploy,
} from "./schema-origin-deploy.mjs";
import { createSpecificationReleaseOperations } from "./specification-release-adapter.mjs";
import {
  AUTHORITY_PATH as SPECIFICATION_AUTHORITY_PATH,
  SpecificationReleaseError,
  applySchemaReservation,
  assertMutationAuthority as assertSpecificationMutationAuthority,
  parseSpecificationReleaseArgs,
  prepare as prepareSpecificationRelease,
  prepareReceipt as prepareSpecificationReceipt,
  publish as publishSpecificationRelease,
  recover as recoverSpecificationRelease,
  record as recordSpecificationRelease,
  reserve as reserveSpecificationRelease,
  sealRecordArtifact,
  verify as verifySpecificationRelease,
} from "./specification-release.mjs";

export const SPECIFICATION_RELEASE_SURFACE = "takoform-specification-release";
export const SCHEMA_ORIGIN_RELEASE_SURFACE = "takoform-schema-origin";
export const DEPLOY_RUNTIME_EXECUTABLE = "/usr/local/bin/node";
const DEPLOY_SURFACES = Object.freeze([
  CORE_RELEASE.surface,
  SPECIFICATION_RELEASE_SURFACE,
  SCHEMA_ORIGIN_RELEASE_SURFACE,
]);
const DEPLOY_USAGE = `usage: bun run deploy -- <${DEPLOY_SURFACES.join("|")}> <phase> [exact options]`;

const SEALED_CONTINUATION_POLICY = Object.freeze({
  kind: "takos.sealed-deploy-continuation@v1",
  credentialTransport: "protected-fd",
  capability: Object.freeze({
    scope: Object.freeze(["surface", "phase", "source"]),
    oneUse: true,
    replay: "refuse",
    boundIdentityEvidence: Object.freeze([
      "source.raw-source-tree-sha256",
      "source.review-record-sha256",
      "closure.closure-manifest-sha256",
      "closure.closure-tree-sha256",
      "runtime.runtime-executable-sha256",
      "runtime.runtime-dependency-closure-sha256",
      "launcher.launcher-executable-sha256",
      "launcher.launcher-config-sha256",
      "launcher.launcher-device",
      "launcher.launcher-inode",
      "launcher.launcher-owner-uid",
      "launcher.launcher-owner-gid",
      "launcher.launcher-mode",
    ]),
    authenticity: Object.freeze({
      scheme: "broker-minted-after-pinned-review",
      proposalProducer: "credentialless-unprivileged-facade",
      acceptedCapabilityIssuer:
        "preinstalled-root-or-system-owned-static-trusted-broker",
      reviewIndependence: "reviewer-independent-of-proposal-producer",
      reviewVerification:
        "cryptographic-signature-against-broker-pinned-reviewer-trust-root",
      reviewBindings: Object.freeze([
        "proposal",
        "source",
        "closure",
        "runtime",
        "broker",
        "launcher",
        "invocation",
      ]),
      mintAndConsume: "broker-internal-atomic-one-use",
      credentialReadOrder:
        "after-broker-reseal-and-atomic-capability-consume-before-protected-fd-or-broker-read",
      sourceMinting: "refuse",
      custody: "broker-internal-unexposed",
      issuerBinding: "broker-identity-envelope-sha256",
      nonceBinding: "nonce-sha256",
      envelopeBinding: "capability-envelope-sha256",
      requiredEvidence: Object.freeze([
        "reviewer-public-key-sha256",
        "review-signature-algorithm",
        "review-signature-bytes",
        "signed-review-envelope-sha256",
        "proposal-envelope-sha256",
        "broker-identity-envelope-sha256",
        "broker-executable-sha256",
        "broker-device",
        "broker-inode",
        "broker-owner-uid",
        "broker-owner-gid",
        "broker-mode",
        "broker-static-build-id-sha256",
        "launcher-executable-sha256",
        "launcher-config-sha256",
        "launcher-device",
        "launcher-inode",
        "launcher-owner-uid",
        "launcher-owner-gid",
        "launcher-mode",
        "raw-source-tree-sha256",
        "review-record-sha256",
        "closure-manifest-sha256",
        "closure-tree-sha256",
        "runtime-executable-sha256",
        "runtime-dependency-closure-sha256",
        "invocation-envelope-sha256",
        "nonce-sha256",
        "capability-envelope-sha256",
        "capability-consume-marker-sha256",
      ]),
    }),
  }),
  launcher: Object.freeze({
    ownership: "root-or-system",
    environment: "clean",
    checkout: "broker-resealed-private-closure",
    directRunner: "refuse",
    unsealedRunner: "refuse",
  }),
  closureCustody: Object.freeze({
    producerInputOwnership: "unprivileged-producer",
    brokerReseal: "after-pinned-review-before-capability-consume",
    executionSource: "broker-owned-revalidated-private-copy-only",
    preCredentialChildExecution: "refuse",
    mutation: "refuse",
  }),
  ambientAuthority: Object.freeze({
    policy: "forbidden-unless-exact-pinned-declared-input",
    forbiddenClasses: Object.freeze([
      "runtime-startup-options",
      "runtime-loaders",
      "custom-ca",
      "proxy",
      "shell-startup",
      "git-overrides",
      "key-agent",
    ]),
    exactPinnedDeclaredInputs: Object.freeze([]),
  }),
  identityEvidence: Object.freeze({
    source: Object.freeze([
      "raw-source-tree-sha256",
      "review-record-sha256",
    ]),
    closure: Object.freeze([
      "closure-manifest-sha256",
      "closure-tree-sha256",
    ]),
    runtime: Object.freeze([
      "runtime-executable-sha256",
      "runtime-dependency-closure-sha256",
    ]),
    launcher: Object.freeze([
      "launcher-executable-sha256",
      "launcher-config-sha256",
      "launcher-device",
      "launcher-inode",
      "launcher-owner-uid",
      "launcher-owner-gid",
      "launcher-mode",
    ]),
  }),
});

function sealedContinuationContract() {
  return Object.freeze({
    ...SEALED_CONTINUATION_POLICY,
    credentialClasses: Object.freeze({
      facade: Object.freeze([]),
      capability: Object.freeze([]),
      launcher: Object.freeze([
        "broker-bound-exact-phase-authority-envelope",
      ]),
    }),
  });
}

export const DEPLOY_CONTRACT = Object.freeze({
  kind: "takos.deploy-contract@v2",
  otherProviderScripts: Object.freeze([
    Object.freeze({
      script: "check:schema-origin",
      why: "Runs the pinned schema-origin Wrangler versions upload only with --dry-run into a disposable local output directory; it neither authenticates nor mutates the Worker, version, deployment, route, or domain.",
    }),
  ]),
  surfaces: [
    {
      surface: CORE_RELEASE.surface,
      target:
        "signed-tag:tako0614/takoform/refs/tags/v0.1.0 + asset-free-immutable-github-release:tako0614/takoform/v0.1.0 + proxy.golang.org:github.com/tako0614/takoform@v0.1.0 + sum.golang.org:github.com/tako0614/takoform@v0.1.0 + git-ref:tako0614/takoform/refs/heads/main:release/core-releases.json",
      covers: [
        "internal/buildinfo",
        "cmd/form-package",
        "cmd/generic-conformance",
        "cmd/takoform-trust",
        "release/authority/core-tag-allowed-signers",
        "release/authority/core-release-broker.json",
        "release/authority/core-release-continuation-review.pub",
        "release/broker",
        "release/core-releases.json",
        "release/core-release-policy.md",
        "scripts/core-release.mjs",
        "scripts/deploy.mjs",
        "scripts/sealed-deploy-bootstrap.mjs",
        "scripts/sealed-deploy-launcher.mjs",
        "scripts/sealed-deploy-runner.mjs",
      ],
      requiresScripts: ["check"],
      requiresTools: ["git", "node", "bun", "go", "ssh-keygen"],
      requiresEnv: [],
      sealedContinuation: sealedContinuationContract(),
      phaseAuthorities: {
        prepare: { requiresEnv: [] },
        audit: { requiresEnv: ["GH_TOKEN"] },
        "sign-tag": { requiresEnv: ["TAKOFORM_CORE_TAG_SIGNING_KEY"] },
        publish: { requiresEnv: ["GH_TOKEN"] },
        "record-prepare": { requiresEnv: [] },
        "record-push": { requiresEnv: ["TAKOFORM_CORE_REF_WRITE_TOKEN"] },
        verify: { requiresEnv: [] },
      },
      triggers: ["authority", "published-identity"],
      obligations: {
        provenance:
          "Credentialless Core prepare alone executes source-controlled lifecycle, build, and binary commands and emits the canonical operator-private qualification report. The credentialless unprivileged deploy facade never receives authority: it seals exact detached raw S, the phase invocation, phase-required private inputs, the installed static broker and runtime identities, and a prior source/broker review into a proposal. A later signed independent review binds that exact proposal. Only the preinstalled static broker verifies it, copies and revalidates the exact closure into broker-owned private custody, atomically mints and consumes the one-use capability internally, then reads the exact phase credential envelope from FD 3 and supervises the sealed Node runner from that copy. Audit performs only one authenticated ruleset GET; sign-tag binds A plus qualification/review digests; publish and record-push run no source lifecycle or build commands.",
        "post-conditions":
          "Publication revalidates the exact signed tag object and byte-equal authenticated audit A immediately before the exact object-id tag push and again immediately before the sole asset-free Release POST. Record-prepare and verify freshly verify the signed tag-bound publication-time A, the immutable non-draft non-prerelease Release with assets:[], proxy/direct Sum and GoModSum equality with Origin.Hash S and Origin.Ref refs/tags/v0.1.0, sum.golang.org enabled, all three versioned installs, and each installed command's exact module/version/sum output. They do not query or claim current hidden bypass state.",
        reversal:
          "v0.1.0, its signed annotated tag, immutable asset-free Release, Go module identity, and receipt are append-only. There is no delete, patch, asset upload, retag, overwrite, or recreate path. Recovery is the publish phase's forward-only recover mode and creates only an exact missing tag or Release. A bad public identity is repaired under a later version. A stale record artifact loses its P lease and must be regenerated from fresh public evidence and the new eligible descendant P.",
        "failure-handling":
          "The normal facade rejects all credential, runtime-loader/startup, custom-CA, proxy, shell, Git override, and key-agent ambient authority and cannot mint a capability. The statically linked root/system broker rejects the same ambient classes before it verifies the signed review; it copies, reseals, and revalidates the unprivileged proposal closure and atomically consumes the capability before reading FD 3. Source JS receives only a minimal broker-attested run request for the broker-owned copy, never the capability. Mutation failures name the exact boundary and perform authoritative readback. Publish adopts only exact existing state and never retries a POST in one invocation. Record-push runs only validated absolute Git for artifact validation, exact P-to-R CAS, and authoritative readback/classification.",
        "independent-review":
          "Every authority continuation requires the dedicated Ed25519 reviewer to sign the canonical review v2 envelope in the takoform-sealed-continuation-review-v2 namespace. That signature binds the exact proposal digest and therefore source S, prior source/broker review, sealed closure and inputs, runtime, static broker build/identity, launcher configuration, and invocation. Broker source/build/install evidence is independently reviewed before the root-owned static binary and review public key are installed. Separately, sign-tag requires the Core publication independent-review v2 record bound to S, qualification, and A.",
        "no-overwrite":
          "The seven phases retain their exact authority split: none, GitHub publication, tag SSH key, GitHub publication, none, ref-write token, none. The public contract exposes one aggregate broker envelope class, while the signed proposal and broker enforce the exact single phase-specific key set and reject extras. Audit and publish may use the same GH_TOKEN only in separate one-use proposals. Publish pushes the exact verified tag object id with a zero-object lease and performs one Release POST; recover creates only missing exact state. Record-prepare emits a closed directory artifact without ref authority; record-push seals and recursively validates that directory then uses an exact P lease.",
      },
    },
    {
      surface: SPECIFICATION_RELEASE_SURFACE,
      target:
        "dormant-future-specification-and-schema-release:tako0614/takoform",
      covers: [
        "release/specification-authority.json",
        "release/specification-release-policy.md",
        "release/specification-releases.json",
        "release/authority/core-release-broker.json",
        "release/authority/core-release-continuation-review.pub",
        "release/broker",
        "scripts/specification-release-adapter.mjs",
        "scripts/specification-release.mjs",
        "scripts/deploy.mjs",
        "scripts/sealed-deploy-bootstrap.mjs",
        "scripts/sealed-deploy-launcher.mjs",
        "scripts/sealed-deploy-runner.mjs",
      ],
      requiresScripts: ["check"],
      requiresTools: ["git", "node", "bun", "ssh-keygen"],
      requiresEnv: [],
      sealedContinuation: sealedContinuationContract(),
      phaseAuthorities: {
        reserve: { requiresEnv: [] },
        "apply-reservation": { requiresEnv: [] },
        seal: { requiresEnv: [] },
        prepare: {
          lanes: {
            specification: { requiresEnv: [] },
            schema: {
              requiresEnv: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID"],
            },
            composed: {
              requiresEnv: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID"],
            },
          },
        },
        publish: {
          lanes: {
            specification: {
              requiresEnv: [
                "GH_TOKEN",
                "TAKOFORM_CORE_TAG_SIGNING_KEY",
                "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
              ],
            },
            schema: {
              requiresEnv: [
                "CLOUDFLARE_API_TOKEN",
                "CLOUDFLARE_ACCOUNT_ID",
                "CLOUDFLARE_ZONE_ID",
              ],
            },
            composed: {
              requiresEnv: [
                "GH_TOKEN",
                "TAKOFORM_CORE_TAG_SIGNING_KEY",
                "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
                "CLOUDFLARE_API_TOKEN",
                "CLOUDFLARE_ACCOUNT_ID",
                "CLOUDFLARE_ZONE_ID",
              ],
            },
          },
        },
        recover: {
          lanes: {
            specification: {
              requiresEnv: [
                "GH_TOKEN",
                "TAKOFORM_CORE_TAG_SIGNING_KEY",
                "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
              ],
            },
            schema: {
              requiresEnv: [
                "CLOUDFLARE_API_TOKEN",
                "CLOUDFLARE_ACCOUNT_ID",
                "CLOUDFLARE_ZONE_ID",
              ],
            },
            composed: {
              requiresEnv: [
                "GH_TOKEN",
                "TAKOFORM_CORE_TAG_SIGNING_KEY",
                "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
                "CLOUDFLARE_API_TOKEN",
                "CLOUDFLARE_ACCOUNT_ID",
                "CLOUDFLARE_ZONE_ID",
              ],
            },
          },
        },
        "prepare-receipt": {
          requiresEnv: ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"],
        },
        record: {
          requiresEnv: [
            "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
            "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
          ],
        },
        verify: {
          lanes: {
            specification: {
              requiresEnv: ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"],
            },
            schema: { requiresEnv: [] },
            composed: {
              requiresEnv: ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"],
            },
          },
        },
      },
      triggers: ["irreversible", "authority", "published-identity"],
      obligations: {
        provenance:
          "The reviewed Specification writer, production adapter, policy, authority record, and this owning deploy route are retained as one source-pinned closure. The checked-in prepared-writer-disabled authority blocks every release phase before the adapter or any other release capability is constructed.",
        "post-conditions":
          "After a separately reviewed authority activation, the phase-specific Specification writer verifies the exact schema route, signed annotated tag, immutable asset-free Release, append-only records, and authoritative readback described by release/specification-release-policy.md.",
        reversal:
          "The dormant writer makes no production change. After activation, published Specification, schema, tag, Release, route, and receipt identities are append-only and recovery is forward-only under the retained Specification policy.",
        "failure-handling":
          "While authority is prepared-writer-disabled, reserve, apply-reservation, seal, prepare, publish, recover, prepare-receipt, record, and verify fail before credentials, signer execution, adapter construction, tracked writes, or network activity.",
        "independent-review":
          "Activation and every live publish or recover operation require the independently reviewed records and source-pinned execution closure defined by release/specification-release-policy.md.",
        "pre-mutation-proof":
          "The checked-in prepared-writer-disabled authority is the current fail-closed proof: every phase stops before credentials, adapter construction, or network work. A future activation must first bind the exact schema-origin candidate, staged/cutover readback, predecessor tombstone, authority transition, source closure, tag ruleset audit, and phase-specific dry-run/read-only evidence required by release/specification-release-policy.md; the dormant route cannot substitute a green local check for that proof.",
        "no-overwrite":
          "The deploy entrypoint delegates only exact parsed phases to the reviewed Specification module and adapter; it adds no alternate writer, CI authority, overwrite, deletion, or identity-recreation path.",
      },
    },
    {
      surface: SCHEMA_ORIGIN_RELEASE_SURFACE,
      target: `cloudflare-worker:${SCHEMA_ORIGIN.worker} + route:${SCHEMA_ORIGIN.routePattern}`,
      covers: [
        "package.json",
        "bun.lock",
        "release/schema-origin-policy.md",
        "release/specification-authority.json",
        "release/authority/specification-schema-tool-closure.json",
        "release/authority/core-release-broker.json",
        "release/authority/core-release-continuation-review.pub",
        "release/broker",
        "schema-origin/wrangler.jsonc",
        "schema-origin/public",
        "scripts/schema-origin-projection.mjs",
        "scripts/schema-origin-deploy.mjs",
        "scripts/specification-release-adapter.mjs",
        "scripts/deploy.mjs",
        "scripts/sealed-deploy-bootstrap.mjs",
        "scripts/sealed-deploy-launcher.mjs",
        "scripts/sealed-deploy-runner.mjs",
      ],
      requiresScripts: ["check"],
      requiresTools: ["git", "node", "bun"],
      requiresEnv: [],
      sealedContinuation: sealedContinuationContract(),
      phaseAuthorities: {
        prepare: { requiresEnv: ["CLOUDFLARE_API_TOKEN"] },
        stage: { requiresEnv: ["CLOUDFLARE_API_TOKEN"] },
        cutover: { requiresEnv: ["CLOUDFLARE_API_TOKEN"] },
        "prepare-activation": {
          requiresEnv: ["CLOUDFLARE_API_TOKEN"],
        },
        verify: {
          requiresEnv: [],
          optionalEnv: ["CLOUDFLARE_API_TOKEN"],
        },
        revert: { requiresEnv: ["CLOUDFLARE_API_TOKEN"] },
      },
      triggers: ["irreversible", "authority"],
      obligations: {
        provenance:
          "The clean canonical Core commit, authority and public-schema ledger, schema-origin projection, exact forms.takoform.com/schemas/* route configuration, and the sealed P0-pinned Wrangler tool closure are retained in one candidate before any Cloudflare mutation.",
        "post-conditions":
          "After staging, the exact staged version has no traffic. Cutover reads back forms.takoform.com/schemas/*, the sole 100% deployment, every active and retired schema identity, the unknown 404, the non-schema sentinel, and the unchanged custom-domain closure.",
        reversal:
          "The predecessor tombstone must be read back before the forms.takoform.com/schemas/* route is cut over. Before successor authority becomes active, revert removes only the exact route and proves predecessor fallback; after active authority, recovery is forward-only and never reopens the predecessor writer.",
        "failure-handling":
          "Every mutation reports whether external state was touched and whether evidence is indeterminate; indeterminate evidence requires fresh authoritative readback and operator inspection. The entrypoint performs no blind retry or automatic cleanup.",
        "independent-review":
          "An outside-repository review binds the candidate, source and sealed tool closure, and an independent predecessor tombstone readback is required before route mutation at forms.takoform.com/schemas/*.",
        "pre-mutation-proof":
          "The brokered prepare phase is the read-only production proof. Using the exact Cloudflare account/zone/token envelope, it revalidates canonical Core main and authority, all 31 active and 15 retired schema identities, the public sentinel, exact empty route, predecessor custom domains, absent Worker, pinned Wrangler closure, and a local versions-upload dry run, then emits one closed outside-repository candidate. Stage, cutover, activation, and revert freshly revalidate the exact bound predecessor evidence immediately before their sole mutation.",
        "no-overwrite":
          "The worker, version, deployment, route and schema bytes are create-only identities. Existing route or Worker state, a changed predecessor tombstone, duplicate stage, redirect, mismatch, or /v2 surface blocks the operation rather than overwriting it.",
      },
    },
  ],
});

export function parseDeployInvocation(args) {
  if (!Array.isArray(args)) {
    throw new Error(DEPLOY_USAGE);
  }
  if (args[0] === SCHEMA_ORIGIN_RELEASE_SURFACE) {
    return {
      surface: SCHEMA_ORIGIN_RELEASE_SURFACE,
      options: parseSchemaOriginArgs(args.slice(1)),
    };
  }
  if (args[0] === SPECIFICATION_RELEASE_SURFACE) {
    return {
      surface: SPECIFICATION_RELEASE_SURFACE,
      options: parseSpecificationReleaseArgs(args.slice(1)),
    };
  }
  if (args[0] !== CORE_RELEASE.surface) {
    throw new Error(DEPLOY_USAGE);
  }
  return {
    surface: CORE_RELEASE.surface,
    options: parseCoreReleaseArgs(args.slice(1)),
  };
}

const CORE_SEALED_REQUIREMENTS = Object.freeze({
  audit: Object.freeze({ credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["GH_TOKEN"] }),
  "sign-tag": Object.freeze({ credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["TAKOFORM_CORE_TAG_SIGNING_KEY"] }),
  publish: Object.freeze({ credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["GH_TOKEN"] }),
  "record-push": Object.freeze({ credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["TAKOFORM_CORE_REF_WRITE_TOKEN"] }),
});

const SEALED_INPUT_FLAGS = Object.freeze({
  [CORE_RELEASE.surface]: Object.freeze([
    "--qualification",
    "--ruleset-audit",
    "--review-record",
    "--tag-bundle",
    "--artifact",
  ]),
  [SPECIFICATION_RELEASE_SURFACE]: Object.freeze([
    "--input",
    "--review-record",
    "--sealed-artifact",
  ]),
  [SCHEMA_ORIGIN_RELEASE_SURFACE]: Object.freeze([
    "--candidate",
    "--review-record",
    "--stage-record",
    "--cutover-record",
    "--predecessor-readback",
  ]),
});

const FACADE_FORBIDDEN_ENV = Object.freeze(new Set([
  ...[...SEALED_FORBIDDEN_AMBIENT_ENV].map((name) => name.toUpperCase()),
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_PAT",
  "TAKOFORM_CORE_TAG_SIGNING_KEY",
  "TAKOFORM_CORE_REF_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
  "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_TAG_SIGNING_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "CF_API_TOKEN",
  "CF_API_KEY",
  "CF_API_EMAIL",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "BUN_AUTH_TOKEN",
  "YARN_NPM_AUTH_TOKEN",
  "GOAUTH",
  "NETRC",
  "SSH_AUTH_SOCK",
  "SSH_ASKPASS",
  "SSH_ASKPASS_REQUIRE",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GNUPGHOME",
  "GPG_AGENT_INFO",
  "GPG_TTY",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "OPENSSL_CONF",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "BUN_OPTIONS",
  "BUN_INSTALL",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "BASH_ENV",
  "ENV",
  "CDPATH",
  "SHELLOPTS",
]));

function forbiddenFacadeEnvironmentClass(name) {
  const upper = name.toUpperCase();
  if (FACADE_FORBIDDEN_ENV.has(upper)) return "exact";
  if (/(?:^|_)(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIALS?|API_KEY|ACCESS_KEY)(?:$|_)/u.test(upper)) return "credential";
  if (/^(?:BUN|DENO|NODE)_OPTIONS$/u.test(upper)) return "runtime-startup-options";
  if (/^(?:(?:BUN|DENO|NODE)_(?:LOADER|LOADERS|PATH|PRELOAD)|GLIBC_TUNABLES|LD_.*|DYLD_.*|__XPC_DYLD_.*)$/u.test(upper)) return "runtime-loaders";
  if (/(?:^|_)(?:CA_BUNDLE|CAFILE|CERT_DIR|CERT_FILE|EXTRA_CA_CERTS)$/u.test(upper)) return "custom-ca";
  if (/(?:^|_)(?:ALL|HTTP|HTTPS|NO)_PROXY$/u.test(upper)) return "proxy";
  if (/^(?:BASH_FUNC_.+|BASHOPTS|BASH_ENV|CDPATH|COMSPEC|ENV|PROMPT_COMMAND|SHELL|SHELLOPTS|ZDOTDIR)$/u.test(upper)) return "shell-startup";
  if (/^GIT_/u.test(upper)) return "git-overrides";
  if (/^(?:GPG_AGENT_INFO|SSH_AGENT_PID|SSH_ASKPASS(?:_REQUIRE)?|SSH_AUTH_SOCK|SUDO_ASKPASS)$/u.test(upper)) return "key-agent";
  return null;
}

function specificationSealedRequirement(options) {
  const lane = options.lane;
  if (options.phase === "prepare" && ["schema", "composed"].includes(lane)) {
    return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID"] };
  }
  if (["publish", "recover"].includes(options.phase)) {
    if (lane === "specification") return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["GH_TOKEN", "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"] };
    if (lane === "schema") return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"] };
    return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "GH_TOKEN", "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"] };
  }
  if (options.phase === "prepare-receipt") return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"] };
  if (options.phase === "record") return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"] };
  if (options.phase === "verify" && lane !== "schema") return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"] };
  return null;
}

export function sealedRequirementForInvocation(
  surface,
  options,
  { authenticatedSchemaVerify = false } = {},
) {
  if (surface === CORE_RELEASE.surface) return CORE_SEALED_REQUIREMENTS[options.phase] ?? null;
  if (surface === SPECIFICATION_RELEASE_SURFACE) return specificationSealedRequirement(options);
  if (surface === SCHEMA_ORIGIN_RELEASE_SURFACE) {
    if (options.phase === "verify" && !authenticatedSchemaVerify) return null;
    return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["CLOUDFLARE_API_TOKEN"] };
  }
  throw new Error("unknown deploy surface");
}

function assertCredentiallessFacadeEnvironment(env) {
  for (const name of Object.keys(env)) {
    if (forbiddenFacadeEnvironmentClass(name) !== null) {
      throw new Error(`credentialless deploy facade rejects ambient authority/injection ${name}`);
    }
  }
}

function assertCredentiallessPhase(requirement, env, surface, phase) {
  if (requirement !== null) {
    throw new Error(`${surface} ${phase} requires the independently installed static broker continuation`);
  }
  assertCredentiallessFacadeEnvironment(env);
}

export function parseSealedPreparationArgs(args) {
  if (!Array.isArray(args) || args.length < 9 || args[0] !== "--prepare-sealed-continuation" || args[2] !== "--source" || args[4] !== "--continuation-review" || args[6] !== "--") {
    throw new Error("usage: bun run deploy -- --prepare-sealed-continuation <private-output-root> --source <reviewed-commit> --continuation-review <private-canonical-source-review> -- <surface> <phase> [exact options]");
  }
  const outputRoot = args[1];
  const source = args[3];
  const continuationReview = args[5];
  if (!outputRoot.startsWith("/") || !/^[0-9a-f]{40}$/u.test(source) || !continuationReview.startsWith("/")) throw new Error("sealed continuation output/source/review is invalid");
  const invocationArgs = args.slice(7);
  const parsed = parseDeployInvocation(invocationArgs);
  const requirement = sealedRequirementForInvocation(parsed.surface, parsed.options, {
    authenticatedSchemaVerify:
      parsed.surface === SCHEMA_ORIGIN_RELEASE_SURFACE &&
      parsed.options.phase === "verify",
  });
  if (requirement === null) throw new Error("credentialless phase does not use a sealed continuation");
  return { outputRoot, source, continuationReview, invocationArgs, parsed, requirement };
}

export function prepareDeployContinuation({ args, repo, brokerExecutable, environment = process.env }) {
  const request = parseSealedPreparationArgs(args);
  assertCredentiallessFacadeEnvironment(environment);
  const result = prepareSealedProposal({
    repository: repo,
    outputRoot: request.outputRoot,
    source: request.source,
    continuationReview: request.continuationReview,
    args: request.invocationArgs,
    credentialEnv: request.requirement.env,
    credentialClass: request.requirement.credentialClass,
    inputFlags: SEALED_INPUT_FLAGS[request.parsed.surface],
    brokerExecutable,
    environment,
  });
  return result;
}

function readSpecificationAuthority(repo) {
  return JSON.parse(
    readFileSync(join(repo, SPECIFICATION_AUTHORITY_PATH), "utf8"),
  );
}

function writeExclusiveArtifact(path, bytes) {
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
}

function signerEnvironment(env) {
  return Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"]
      .filter((name) => typeof env[name] === "string")
      .map((name) => [name, env[name]]),
  );
}

export function assertDeployRuntime(
  executable = process.execPath,
  expected = DEPLOY_RUNTIME_EXECUTABLE,
) {
  let resolved;
  let metadata;
  try {
    resolved = realpathSync(executable);
    metadata = statSync(resolved);
  } catch (error) {
    throw new Error(`owning deploy runtime is unavailable: ${error.message}`);
  }
  const currentUser = process.getuid?.();
  if (
    resolved !== expected ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    (metadata.uid !== 0 && metadata.uid !== currentUser) ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw new Error(
      `owning deploy runtime must be exact private-system Node ${expected}`,
    );
  }
  return Object.freeze({
    executable: resolved,
    owner: metadata.uid,
    mode: metadata.mode & 0o777,
  });
}

export async function runSpecificationDeploy({
  options,
  repo,
  env = process.env,
  operationsFactory = createSpecificationReleaseOperations,
}) {
  const authority = readSpecificationAuthority(repo);
  // This bootstrap guard deliberately precedes every capability construction,
  // including read-only verification. The checked-in prepared authority
  // therefore cannot expose any credential, signer, runner, tracked writer,
  // or network callback for any release phase.
  assertSpecificationMutationAuthority(authority, options.phase);
  if (options.phase === "seal") {
    const sealed = await sealRecordArtifact({
      authority,
      unsignedArtifactRaw: readFileSync(options.input),
      signerCommand: options.signer,
      repositoryRoot: repo,
      environment: signerEnvironment(env),
    });
    writeExclusiveArtifact(options.output, sealed.raw);
    return sealed.document;
  }

  const input = { ...options, authority };
  const operations = operationsFactory({
    phase: options.phase,
    options: input,
    repo,
    env,
  });
  try {
    switch (options.phase) {
      case "reserve": {
        const result = await reserveSpecificationRelease(input, operations);
        if (result.unsignedArtifact !== null) {
          writeExclusiveArtifact(options.output, result.unsignedArtifact.raw);
        }
        return result;
      }
      case "apply-reservation":
        return await applySchemaReservation(
          {
            ...input,
            sealedArtifactRaw: readFileSync(options.sealedArtifact),
          },
          operations,
        );
      case "prepare":
        return await prepareSpecificationRelease(input, operations);
      case "publish":
        return await publishSpecificationRelease(input, operations);
      case "recover":
        return await recoverSpecificationRelease(input, operations);
      case "prepare-receipt": {
        const result = await prepareSpecificationReceipt(input, operations);
        writeExclusiveArtifact(options.output, result.unsignedArtifact.raw);
        return result;
      }
      case "record":
        return await recordSpecificationRelease(
          {
            ...input,
            sealedArtifactRaw: readFileSync(options.sealedArtifact),
          },
          operations,
        );
      case "verify":
        return await verifySpecificationRelease(input, operations);
      default:
        throw new Error("unreachable Specification release phase");
    }
  } finally {
    if (typeof operations.cleanup === "function") operations.cleanup();
  }
}

async function dispatchDeploy({
  args,
  repo,
  env = process.env,
  stdout = process.stdout,
  runner,
  tools,
  githubRequest,
  specificationOperationsFactory,
  operationsFactory,
  schemaOperations,
  schemaDeploy,
  schemaRunner,
  runtimeExecutable = process.execPath,
} = {}) {
  assertDeployRuntime(runtimeExecutable);
  const { surface, options } = parseDeployInvocation(args);
  if (surface === SCHEMA_ORIGIN_RELEASE_SURFACE) {
    const delegate = schemaDeploy ?? schemaRunner ?? runSchemaOriginDeploy;
    const delegation = {
      args: args.slice(1),
      options,
      repo,
      env,
      stdout,
    };
    if (schemaOperations !== undefined) {
      delegation.operations = schemaOperations;
    }
    // The schema owner writes its result exactly once. Do not serialize a
    // second copy here: runSchemaOriginDeploy already owns stdout handling.
    return await delegate(delegation);
  }
  if (surface === SPECIFICATION_RELEASE_SURFACE) {
    const result = await runSpecificationDeploy({
      options,
      repo,
      env,
      operationsFactory:
        specificationOperationsFactory ?? operationsFactory ?? createSpecificationReleaseOperations,
    });
    stdout.write(canonicalJSON(result));
    return result;
  }
  const dependencies = {
    repo,
    env,
    ...(runner === undefined ? {} : { runner }),
    ...(tools === undefined ? {} : { tools }),
    ...(githubRequest === undefined ? {} : { githubRequest }),
  };
  let result;
  switch (options.phase) {
    case "prepare":
      result = prepareCoreRelease(options, dependencies);
      break;
    case "audit":
      result = await auditCoreRelease(options, dependencies);
      break;
    case "sign-tag":
      result = signCoreReleaseTag(options, dependencies);
      break;
    case "publish":
      result = await publishCoreRelease(options, dependencies);
      break;
    case "record-prepare":
      result = await recordPrepareCoreRelease(options, dependencies);
      break;
    case "record-push":
      result = recordPushCoreRelease(options, dependencies);
      break;
    case "verify":
      result = await verifyPublishedCoreRelease(options, dependencies);
      break;
    default:
      throw new Error("unreachable Core release phase");
  }
  stdout.write(canonicalJSON(result));
  return result;
}

export async function runBrokeredDeploy({ attestation } = {}) {
  const brokered = takeBrokeredDeploy(attestation);
  try {
    const { surface, options } = parseDeployInvocation(
      brokered.request.invocation.args,
    );
    const requirement = sealedRequirementForInvocation(surface, options, {
      authenticatedSchemaVerify:
        surface === SCHEMA_ORIGIN_RELEASE_SURFACE &&
        options.phase === "verify",
    });
    if (
      requirement === null ||
      requirement.credentialClass !== brokered.request.credential.class ||
      canonicalJSON([...requirement.env].sort()) !==
        canonicalJSON(brokered.request.credential.names) ||
      canonicalJSON(Object.keys(brokered.env).sort()) !==
        canonicalJSON(brokered.request.credential.names)
    ) {
      throw new Error(
        "broker attestation is not the exact credentialed phase envelope",
      );
    }
    return await dispatchDeploy({
      args: brokered.request.invocation.args,
      repo: brokered.request.source.root,
      env: brokered.env,
      runtimeExecutable: brokered.request.runtime.node.path,
    });
  } finally {
    finishBrokeredDeploy(brokered);
  }
}

export async function runDeploy(options = {}) {
  const env = options.env ?? process.env;
  assertDeployRuntime(options.runtimeExecutable ?? process.execPath);
  const { surface, options: phaseOptions } = parseDeployInvocation(options.args);
  const requirement = sealedRequirementForInvocation(surface, phaseOptions, {
    authenticatedSchemaVerify: false,
  });
  assertCredentiallessPhase(requirement, env, surface, phaseOptions.phase);
  if (Object.hasOwn(options, "sealedContinuation")) {
    throw new Error("source deploy facade rejects caller-supplied sealed continuation objects");
  }
  return await dispatchDeploy({ ...options, env });
}

export function failureJSON(error) {
  const releaseError =
    error instanceof ReleaseFailure ||
    error instanceof SpecificationReleaseError ||
    error instanceof SchemaOriginFailure;
  return {
    status: "blocked",
    phase: releaseError ? error.phase : "argument",
    stage: releaseError ? error.stage : "parse-or-bootstrap",
    repositoryStateTouched:
      releaseError ? error.repositoryStateTouched === true : false,
    repositoryStateIndeterminate:
      releaseError ? error.repositoryStateIndeterminate === true : false,
    externalStateTouched:
      releaseError ? error.externalStateTouched === true : false,
    externalStateIndeterminate:
      releaseError ? error.externalStateIndeterminate === true : false,
    recoveryEvidence:
      releaseError && Array.isArray(error.recoveryEvidence)
        ? error.recoveryEvidence
        : [],
    automaticCleanupAttempted: false,
    blindRetryAllowed: false,
    message: error.message,
  };
}

if (import.meta.main) {
  if (process.argv.length === 3 && process.argv[2] === "--contract") {
    process.stdout.write(canonicalJSON(DEPLOY_CONTRACT));
  } else if (process.argv[2] === "--prepare-sealed-continuation") {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    try {
      process.stdout.write(
        canonicalJSON(
          prepareDeployContinuation({ args: process.argv.slice(2), repo }),
        ),
      );
    } catch (error) {
      process.stderr.write(canonicalJSON(failureJSON(error)));
      process.exitCode = 1;
    }
  } else {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    try {
      await runDeploy({ args: process.argv.slice(2), repo });
    } catch (error) {
      process.stderr.write(canonicalJSON(failureJSON(error)));
      process.exitCode = 1;
    }
  }
}
