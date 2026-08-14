export const POTREE_PUBLIC_ROOT = "static/potree";

export const POTREE_RUNTIME_DIRECTORIES = ["build", "libs"] as const;

/**
 * Dependency order used by the official Potree examples.
 * These files remain classic scripts because the Potree build expects globals.
 */
export const POTREE_STYLESHEETS = [
  "build/potree/potree.css",
  "libs/jquery-ui/jquery-ui.min.css",
  "libs/openlayers3/ol.css",
  "libs/spectrum/spectrum.css",
  "libs/jstree/themes/mixed/style.css",
] as const;

export const POTREE_SCRIPTS = [
  "libs/jquery/jquery-3.1.1.min.js",
  "libs/spectrum/spectrum.js",
  "libs/jquery-ui/jquery-ui.min.js",
  "libs/other/BinaryHeap.js",
  "libs/tween/tween.min.js",
  "libs/d3/d3.js",
  "libs/proj4/proj4.js",
  "libs/openlayers3/ol.js",
  "libs/i18next/i18next.js",
  "libs/jstree/jstree.js",
  "build/potree/potree.js",
  "libs/plasio/js/laslaz.js",
  "libs/sql.js/sql-wasm.js",
  "libs/geopackage/geopackage.js",
] as const;

export const POTREE_THREE_MODULE = "libs/three.js/build/three.module.js";

export const POTREE_REQUIRED_ASSETS = [
  ...POTREE_STYLESHEETS,
  ...POTREE_SCRIPTS,
  POTREE_THREE_MODULE,
  "build/potree/sidebar.html",
  "build/potree/resources/lang/zh/translation.json",
  "build/potree/workers/2.0/DecoderWorker.js",
  "build/potree/workers/2.0/DecoderWorker_brotli.js",
  "build/potree/workers/LASLAZWorker.js",
  "build/potree/workers/laz-perf.wasm",
  "libs/sql.js/sql-wasm.wasm",
] as const;

export function resolvePotreeAssetUrl(relativePath: string, baseUrl: string): string {
  const normalizedPath = relativePath.replace(/^\/+/, "");
  return new URL(`${POTREE_PUBLIC_ROOT}/${normalizedPath}`, baseUrl).toString();
}
