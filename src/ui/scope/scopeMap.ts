import type { Airspace, Tier } from "../../data/types";
import { makeProjection, project, type Projection } from "./projection";

// SCOPE map layer (§7.5): every bundled boundary projected once per selected airspace
// (the projection is centered on it), so pan/zoom only transforms, never re-projects.

/** Boundaries farther than this from the center are left out (far side of the region). */
export const MAP_RADIUS_NM = 3000;

export interface MapFeature {
  key: string;
  label: string;
  name: string;
  tier: Tier;
  /** Projected rings, flat [x0, y0, x1, y1, ...] in nm. */
  rings: Float32Array[];
  /** [minX, minY, maxX, maxY] over all rings, nm. */
  bbox: [number, number, number, number];
  labelX: number;
  labelY: number;
}

export interface ScopeMap {
  selectedKey: string;
  projection: Projection;
  /** The selected airspace (drawn brighter, on top). */
  selected: MapFeature;
  /** Everything else within MAP_RADIUS_NM, excluding split sub-areas (§3.2). */
  others: MapFeature[];
}

function projectFeature(pr: Projection, a: Airspace): MapFeature {
  const rings: Float32Array[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of a.polygons) {
    for (const ring of poly.coordinates) {
      const flat = new Float32Array(ring.length * 2);
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(pr, lat!, lon!);
        flat[i * 2] = x;
        flat[i * 2 + 1] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
      rings.push(flat);
    }
  }
  const [labelX, labelY] = project(pr, a.labelLat, a.labelLon);
  return {
    key: a.key,
    label: a.label,
    name: a.name,
    tier: a.tier,
    rings,
    bbox: [minX, minY, maxX, maxY],
    labelX,
    labelY,
  };
}

/** Nearest distance (nm) from the projection center to a bbox; 0 if it contains it. */
function bboxDistance([minX, minY, maxX, maxY]: MapFeature["bbox"]): number {
  const dx = Math.max(minX, 0, -maxX);
  const dy = Math.max(minY, 0, -maxY);
  return Math.hypot(dx, dy);
}

export function buildScopeMap(selected: Airspace, all: readonly Airspace[]): ScopeMap {
  const projection = makeProjection(selected.labelLat, selected.labelLon);
  const others: MapFeature[] = [];
  for (const a of all) {
    if (a.key === selected.key || a.tier === "excluded") continue;
    const f = projectFeature(projection, a);
    if (bboxDistance(f.bbox) <= MAP_RADIUS_NM) others.push(f);
  }
  return {
    selectedKey: selected.key,
    projection,
    selected: projectFeature(projection, selected),
    others,
  };
}
