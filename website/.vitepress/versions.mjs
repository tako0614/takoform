const V2_GUIDE_ROOTS = [
  "/start",
  "/model",
  "/client",
  "/authoring",
  "/use",
  "/host-api",
  "/guides",
  "/glossary",
  "/v2",
];
const V1_ROOTS = ["/v1"];

function routePath(input) {
  const value = String(input ?? "").split(/[?#]/u, 1)[0] ?? "";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\.html$/u, "").replace(/\/{2,}/gu, "/");
}

function inRoute(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function localeAndRoute(input) {
  const route = routePath(input);
  if (route === "/en" || route.startsWith("/en/")) {
    return { locale: "/en", localPath: route.slice(3) || "/" };
  }
  return { locale: "", localPath: route };
}

/** Return the documentation version that owns a route, or null for shared pages. */
export function documentVersion(input) {
  const { localPath } = localeAndRoute(input);

  if (inRoute(localPath, "/spec/host-api/v2")) return "v2";
  if (
    localPath === "/spec" ||
    localPath === "/spec/" ||
    localPath === "/spec/host-api" ||
    localPath === "/spec/host-api/"
  ) return null;
  if (inRoute(localPath, "/spec")) return "v1";
  if (inRoute(localPath, "/conformance") || inRoute(localPath, "/schemas")) return "v1";
  if (V1_ROOTS.some((root) => inRoute(localPath, root))) return "v1";
  if (V2_GUIDE_ROOTS.some((root) => inRoute(localPath, root))) return "v2";
  return null;
}

/**
 * Switch versions without implying that unrelated pages are semantic peers.
 * Preserve the current page only when it already belongs to the destination
 * version; otherwise use that locale's version entry. Fragments and queries
 * are intentionally discarded because heading IDs are not shared contracts.
 */
export function versionTarget(input, targetVersion) {
  if (targetVersion !== "v1" && targetVersion !== "v2") {
    throw new TypeError(`Unsupported documentation version: ${targetVersion}`);
  }
  const { locale, localPath } = localeAndRoute(input);
  return documentVersion(input) === targetVersion
    ? `${locale}${localPath}`
    : `${locale}/${targetVersion}/`;
}
