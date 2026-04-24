export function getStaticAssetHeaders(assetPath: string): Record<string, string> {
  if (assetPath.endsWith("/sw.js") || assetPath === "/sw.js") {
    return {
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    };
  }

  if (assetPath.endsWith(".webmanifest")) {
    return {
      "Content-Type": "application/manifest+json",
    };
  }

  return {};
}
