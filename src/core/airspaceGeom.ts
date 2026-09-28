import type { Polygon } from "geojson";
import type { Airspace, BBox } from "../data/types";
import { normalizeLonAround } from "./geo";
import type { PredictedPath } from "./path";

/** Grid cell size (deg) for the boundary-edge index. */
const CELL_DEG = 0.5;

/**
 * The selected airspace prepared for prediction (§4.3, §5.5): polygons with longitudes
 * normalized around `centerLon` (so PAZA/KZAK, split at +/-180 in VATSpy, become
 * continuous), a flat edge list, and a uniform grid over the edges. Built once per switch.
 */
export interface PreparedAirspace {
  key: string;
  centerLon: number;
  bbox: BBox;
  /** polygons[p][ring] = flat [lon0, lat0, lon1, lat1, ...]; ring 0 is the outer ring. */
  polygons: Float64Array[][];
  /** Edges as flat [ax, ay, bx, by] (x = lon, y = lat). */
  edges: Float64Array;
  edgeCount: number;
  grid: Map<number, number[]>;
  gridOrigin: [number, number];
  gridCols: number;
}

function cellKey(col: number, row: number, cols: number): number {
  return row * cols + col;
}

export function prepareAirspace(
  airspace: Airspace,
  centerLon = airspace.labelLon,
): PreparedAirspace {
  const polygons: Float64Array[][] = airspace.polygons.map((poly: Polygon) =>
    poly.coordinates.map((ring) => {
      const flat = new Float64Array(ring.length * 2);
      ring.forEach(([lon, lat], i) => {
        flat[i * 2] = normalizeLonAround(lon!, centerLon);
        flat[i * 2 + 1] = lat!;
      });
      return flat;
    }),
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const edgeList: number[] = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const ax = ring[i]!;
        const ay = ring[i + 1]!;
        const bx = ring[i + 2]!;
        const by = ring[i + 3]!;
        if (ax === bx && ay === by) continue;
        edgeList.push(ax, ay, bx, by);
        minX = Math.min(minX, ax, bx);
        maxX = Math.max(maxX, ax, bx);
        minY = Math.min(minY, ay, by);
        maxY = Math.max(maxY, ay, by);
      }
    }
  }
  const edges = Float64Array.from(edgeList);
  const edgeCount = edges.length / 4;

  const originX = Math.floor(minX / CELL_DEG) * CELL_DEG;
  const originY = Math.floor(minY / CELL_DEG) * CELL_DEG;
  const cols = Math.floor((maxX - originX) / CELL_DEG) + 1;
  const grid = new Map<number, number[]>();
  for (let e = 0; e < edgeCount; e++) {
    const ax = edges[e * 4]!;
    const ay = edges[e * 4 + 1]!;
    const bx = edges[e * 4 + 2]!;
    const by = edges[e * 4 + 3]!;
    const c0 = Math.floor((Math.min(ax, bx) - originX) / CELL_DEG);
    const c1 = Math.floor((Math.max(ax, bx) - originX) / CELL_DEG);
    const r0 = Math.floor((Math.min(ay, by) - originY) / CELL_DEG);
    const r1 = Math.floor((Math.max(ay, by) - originY) / CELL_DEG);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = cellKey(c, r, cols);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(e);
      }
    }
  }

  return {
    key: airspace.key,
    centerLon,
    bbox: [minX, minY, maxX, maxY],
    polygons,
    edges,
    edgeCount,
    grid,
    gridOrigin: [originX, originY],
    gridCols: cols,
  };
}

function inRing(ring: Float64Array, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i]!;
    const yi = ring[i + 1]!;
    const xj = ring[j]!;
    const yj = ring[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon on the normalized geometry (lon already normalized). Holes respected. */
export function contains(a: PreparedAirspace, lat: number, lon: number): boolean {
  const [minX, minY, maxX, maxY] = a.bbox;
  if (lon < minX || lon > maxX || lat < minY || lat > maxY) return false;
  for (const poly of a.polygons) {
    if (!inRing(poly[0]!, lon, lat)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (inRing(poly[h]!, lon, lat)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Contains with a raw (un-normalized) longitude. */
export function containsRaw(a: PreparedAirspace, lat: number, lon: number): boolean {
  return contains(a, lat, normalizeLonAround(lon, a.centerLon));
}

/**
 * Distances along `path` where it intersects any boundary edge, ascending. Unclassified:
 * callers decide ENTER/EXIT by probing (§5.5). Only path segments overlapping the
 * airspace bbox are tested, and only against edges in the grid cells they touch.
 */
export function boundaryIntersections(path: PredictedPath, a: PreparedAirspace): number[] {
  const out: number[] = [];
  const [minX, minY, maxX, maxY] = a.bbox;
  const [ox, oy] = a.gridOrigin;
  const stamp = new Int32Array(a.edgeCount).fill(-1);

  for (let i = 0; i + 1 < path.n; i++) {
    const px = path.lon[i]!;
    const py = path.lat[i]!;
    const qx = path.lon[i + 1]!;
    const qy = path.lat[i + 1]!;
    const sx0 = Math.min(px, qx);
    const sx1 = Math.max(px, qx);
    const sy0 = Math.min(py, qy);
    const sy1 = Math.max(py, qy);
    if (sx1 < minX || sx0 > maxX || sy1 < minY || sy0 > maxY) continue;

    const c0 = Math.floor((sx0 - ox) / CELL_DEG);
    const c1 = Math.floor((sx1 - ox) / CELL_DEG);
    const r0 = Math.floor((sy0 - oy) / CELL_DEG);
    const r1 = Math.floor((sy1 - oy) / CELL_DEG);
    const rx = qx - px;
    const ry = qy - py;
    const d0 = path.dist[i]!;
    const d1 = path.dist[i + 1]!;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= a.gridCols) continue;
        const list = a.grid.get(cellKey(c, r, a.gridCols));
        if (!list) continue;
        for (const e of list) {
          if (stamp[e] === i) continue;
          stamp[e] = i;
          const ax = a.edges[e * 4]!;
          const ay = a.edges[e * 4 + 1]!;
          const sx = a.edges[e * 4 + 2]! - ax;
          const sy = a.edges[e * 4 + 3]! - ay;
          const denom = rx * sy - ry * sx;
          if (denom === 0) continue; // parallel / collinear: treated as grazing
          const t = ((ax - px) * sy - (ay - py) * sx) / denom;
          const u = ((ax - px) * ry - (ay - py) * rx) / denom;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          out.push(d0 + (d1 - d0) * t);
        }
      }
    }
  }
  return out.sort((x, y) => x - y);
}
