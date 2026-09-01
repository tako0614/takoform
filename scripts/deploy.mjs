#!/usr/bin/env node

import process from "node:process";
import {
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
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

export const SCHEMA_ORIGIN_RELEASE_SURFACE = "takoform-schema-origin";
export const DEPLOY_RUNTIME_EXECUTABLE = "/usr/local/bin/node";
const DEPLOY_SURFACES = Object.freeze([
  CORE_RELEASE.surface,
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
      surface: SCHEMA_ORIGIN_RELEASE_SURFACE,
      target: `cloudflare-worker:${SCHEMA_ORIGIN.worker} + route:${SCHEMA_ORIGIN.routePattern}`,
      covers: [
        "package.json",
        "bun.lock",
        "release/schema-origin-policy.md",
        "release/schema-origin-authority.json",
        "release/authority/schema-origin-tool-closure.json",
        "release/authority/schema-origin-writer-closure.json",
        "release/host-api-v1.json",
        "release/public-schema-identities.json",
        "release/authority/core-release-broker.json",
        "release/authority/core-release-continuation-review.pub",
        "release/broker",
        "schema-origin/wrangler.jsonc",
        "schema-origin/public",
        "scripts/records.mjs",
        "scripts/schema-origin-projection.mjs",
        "scripts/schema-origin-deploy.mjs",
        "scripts/schema-tool-closure.mjs",
        "scripts/version-axis.mjs",
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

export function sealedRequirementForInvocation(
  surface,
  options,
  { authenticatedSchemaVerify = false } = {},
) {
  if (surface === CORE_RELEASE.surface) return CORE_SEALED_REQUIREMENTS[options.phase] ?? null;
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

async function dispatchDeploy({
  args,
  repo,
  env = process.env,
  stdout = process.stdout,
  runner,
  tools,
  githubRequest,
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
