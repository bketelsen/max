export function getStaticAssetHeaders(assetPath: string): Record<string, string> {
  if (assetPath.endsWith(".webmanifest")) {
    return {
      "Content-Type": "application/manifest+json",
    };
  }

  return {};
}
