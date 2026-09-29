import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { dataUrl } from "./paths";
import { ringBbox, unionBbox } from "./airspaces";
import type { Tracon } from "./types";

export interface TraconProperties {
  id: string;
  name: string;
  prefixes: string[];
  labelLat: number;
  labelLon: number;
}

export type TraconCollection = FeatureCollection<Polygon | MultiPolygon, TraconProperties>;

export function buildTracons(collection: TraconCollection): Tracon[] {
  return collection.features.map((f) => {
    const p = f.properties;
    const coords = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const bboxes = coords.map((c) => ringBbox(c[0]!));
    return {
      key: `TRACON:${p.id}`,
      id: p.id,
      label: p.id,
      name: p.name,
      prefixes: p.prefixes.map((x) => x.toUpperCase()),
      labelLat: p.labelLat,
      labelLon: p.labelLon,
      polygons: coords.map((c): Polygon => ({ type: "Polygon", coordinates: c })),
      bboxes,
      bbox: unionBbox(bboxes),
    };
  });
}

/**
 * Loads the bundled TRACON boundaries. They are an extra: a failure gives none, so
 * everything else keeps working without approach handoffs.
 */
export async function loadTracons(
  opts: { base?: string; fetchImpl?: typeof fetch } = {},
): Promise<Tracon[]> {
  const fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  try {
    const res = await fetchImpl(dataUrl("tracons.geojson", opts.base));
    if (!res.ok) return [];
    return buildTracons((await res.json()) as TraconCollection);
  } catch {
    return [];
  }
}
