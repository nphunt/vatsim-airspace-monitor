import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { buildFacilityIndex, type FacilityIndex } from "../core/facilityLookup";
import { dataUrl } from "./paths";
import type { Airspace, AirspaceGroup, BBox, FirRecord } from "./types";

export type BoundaryCollection = FeatureCollection<Polygon | MultiPolygon, { key: string }>;

export interface AirspaceRegistry extends FacilityIndex {
  /** The 22 selector airspaces: CONUS alphabetically by label, then ZAN, ZHN (§7.6). */
  getSelectableAirspaces(): Airspace[];
  /** By key ("KZNY#ocn") or by id, where an id means the domestic feature ("KZNY"). */
  getAirspace(idOrKey: string): Airspace | undefined;
  all: readonly Airspace[];
}

export function ringBbox(ring: number[][]): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon! < minLon) minLon = lon!;
    if (lon! > maxLon) maxLon = lon!;
    if (lat! < minLat) minLat = lat!;
    if (lat! > maxLat) maxLat = lat!;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function unionBbox(boxes: BBox[]): BBox {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

function groupOf(f: FirRecord): AirspaceGroup | undefined {
  if (!f.selectable) return undefined;
  return f.id.startsWith("K") ? "CONUS" : "ALASKA/HAWAII";
}

export function buildAirspaces(
  firs: readonly FirRecord[],
  boundaries: BoundaryCollection,
): AirspaceRegistry {
  const geometryByKey = new Map(boundaries.features.map((f) => [f.properties.key, f.geometry]));

  const all: Airspace[] = firs.map((fir) => {
    const geometry = geometryByKey.get(fir.key);
    if (!geometry) throw new Error(`boundaries.us.geojson has no feature ${fir.key}`);
    const coords = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const polygons: Polygon[] = coords.map((c) => ({ type: "Polygon", coordinates: c }));
    // The outer ring (index 0) bounds each polygon; holes lie inside it.
    const bboxes = coords.map((c) => ringBbox(c[0]!));
    return { ...fir, polygons, bboxes, bbox: unionBbox(bboxes), group: groupOf(fir) };
  });

  const byKey = new Map(all.map((a) => [a.key, a]));
  const groupOrder: AirspaceGroup[] = ["CONUS", "ALASKA/HAWAII"];
  const selectable = all
    .filter((a) => a.selectable)
    .sort(
      (a, b) =>
        groupOrder.indexOf(a.group!) - groupOrder.indexOf(b.group!) ||
        a.label.localeCompare(b.label),
    );

  return {
    ...buildFacilityIndex(all),
    all,
    getSelectableAirspaces: () => [...selectable],
    getAirspace: (idOrKey) =>
      byKey.get(idOrKey) ?? byKey.get(`${idOrKey}#dom`) ?? byKey.get(`${idOrKey}#ocn`),
  };
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Loads the bundled boundary data (§3.2) from public/data. `base` defaults to the app base
 * path; the worker passes the page's absolute base URL.
 */
export async function loadAirspaces(
  opts: { base?: string; fetchImpl?: typeof fetch } = {},
): Promise<AirspaceRegistry> {
  const fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  const [firs, boundaries] = await Promise.all([
    fetchJson<FirRecord[]>(dataUrl("firs.json", opts.base), fetchImpl),
    fetchJson<BoundaryCollection>(dataUrl("boundaries.us.geojson", opts.base), fetchImpl),
  ]);
  return buildAirspaces(firs, boundaries);
}
