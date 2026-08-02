import { distanceToPathMeters, haversineMeters } from "./geo";
import { DEMO_CITY } from "./mockData";
import type {
  BikeLaneSegment,
  BikeLaneTier,
  CrashRecord,
  DangerFactorScores,
  DangerZone,
  HighwaySegment,
  LatLng,
  RealRoadSegment,
  RoadKind,
  RoadSafetySegment,
} from "./types";

const SEVERITY_WEIGHT: Record<number, number> = { 1: 1, 2: 2.5, 3: 5 };
const TYPE_WEIGHT: Record<string, number> = {
  collision: 1,
  nearmiss: 0.6,
  hazard: 0.4,
  theft: 0.2,
};

function crashWeight(crash: CrashRecord): number {
  return (SEVERITY_WEIGHT[crash.severity] ?? 1) * (TYPE_WEIGHT[crash.type] ?? 0.5);
}

/** Higher = riskier. `none` intentionally scores worst - see BIKE_LANE_SEARCH_RADIUS_METERS below. */
const BIKE_LANE_TIER_RISK: Record<BikeLaneTier, number> = {
  fullyProtected: 8,
  semiProtected: 35,
  unprotected: 65,
  none: 100,
};

const CRASH_SEARCH_RADIUS_METERS = 260;
const BIKE_LANE_SEARCH_RADIUS_METERS = 130; // beyond this, treat the block as having no meaningful bike lane
// Grid resolution used internally for scoring/clustering - finer than the
// rendered zones, since adjacent risky cells get merged into one bigger
// circle below rather than each cell becoming its own circle.
const GRID_CELL_METERS = 180;
// "No bike lane nearby" alone contributes 0.3 * 100 = 30, and that's true of
// most of any city (bike lanes are the exception, not the rule) - so the
// threshold has to sit well above that baseline, otherwise nearly every
// block without a lane would register as a "danger zone." This keeps zones
// meaningful: only blocks with additional elevated crash/highway risk on
// top of that baseline get surfaced. Safe blocks are simply omitted rather
// than shown in green.
const COMPOSITE_THRESHOLD = 64;
const MIN_ZONE_RADIUS_METERS = 90;
const MAX_ZONE_RADIUS_METERS = 380;

const FACTOR_WEIGHTS = {
  crashDensity: 0.4,
  bikeInfrastructure: 0.3,
  highwayExposure: 0.3,
};

interface GridCell {
  row: number;
  col: number;
  center: LatLng;
  crashDensityRaw: number;
  crashIds: string[];
  bikeInfrastructureRisk: number;
  highwayExposureRisk: number;
}

interface ScoredCell {
  cell: GridCell;
  crashDensity: number;
  bikeInfrastructure: number;
  highwayExposure: number;
  composite: number;
}

function buildGrid(cellSizeMeters: number): { row: number; col: number; center: LatLng }[] {
  const { north, south, east, west } = DEMO_CITY.bounds;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((DEMO_CITY.center.lat * Math.PI) / 180);

  const latStep = cellSizeMeters / metersPerDegLat;
  const lngStep = cellSizeMeters / metersPerDegLng;

  const cells: { row: number; col: number; center: LatLng }[] = [];
  let row = 0;
  for (let lat = south; lat <= north; lat += latStep, row++) {
    let col = 0;
    for (let lng = west; lng <= east; lng += lngStep, col++) {
      cells.push({ row, col, center: { lat, lng } });
    }
  }
  return cells;
}

function scoreCrashDensity(center: LatLng, crashes: CrashRecord[]): { raw: number; ids: string[] } {
  let raw = 0;
  const ids: string[] = [];
  for (const crash of crashes) {
    const d = haversineMeters(center, crash.position);
    if (d <= CRASH_SEARCH_RADIUS_METERS) {
      const proximity = 1 - d / CRASH_SEARCH_RADIUS_METERS;
      raw += crashWeight(crash) * (0.5 + 0.5 * proximity);
      ids.push(crash.id);
    }
  }
  return { raw, ids };
}

function scoreBikeInfrastructure(center: LatLng, segments: BikeLaneSegment[]): number {
  let best = Infinity;
  let bestTier: BikeLaneTier = "none";
  for (const seg of segments) {
    const d = distanceToPathMeters(center, seg.path);
    if (d < best) {
      best = d;
      bestTier = seg.tier;
    }
  }
  if (best > BIKE_LANE_SEARCH_RADIUS_METERS) return BIKE_LANE_TIER_RISK.none;
  return BIKE_LANE_TIER_RISK[bestTier];
}

function scoreHighwayExposure(center: LatLng, segments: HighwaySegment[]): number {
  let worst = 0;
  for (const seg of segments) {
    const d = distanceToPathMeters(center, seg.path);
    const influenceRadius = seg.type === "freeway" ? 500 : 250;
    if (d >= influenceRadius) continue;
    const speedFactor = Math.min(1.2, seg.typicalSpeedMph / 45);
    const proximity = 1 - d / influenceRadius;
    const risk = 100 * proximity * speedFactor;
    worst = Math.max(worst, risk);
  }
  return Math.min(100, worst);
}

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 1e-9);
  return values.map((v) => Math.min(100, (v / max) * 100));
}

// Orthogonal-only adjacency (not diagonal): diagonal touches tend to bridge
// two otherwise-separate hot spots into one giant blob, which defeats the
// point of clustering (distinct problem areas, not the whole danger-prone
// side of town merged into one circle).
const NEIGHBOR_OFFSETS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Groups orthogonally-adjacent grid cells that are all above the danger
 * threshold into a single connected cluster, using a flood fill over a
 * row/col lookup map. This turns a whole risky stretch of blocks into one
 * merged zone instead of many same-size tiles sitting next to each other.
 */
function clusterQualifyingCells(qualifying: ScoredCell[]): ScoredCell[][] {
  const byKey = new Map<string, ScoredCell>();
  for (const s of qualifying) byKey.set(`${s.cell.row},${s.cell.col}`, s);

  const visited = new Set<string>();
  const clusters: ScoredCell[][] = [];

  for (const start of qualifying) {
    const startKey = `${start.cell.row},${start.cell.col}`;
    if (visited.has(startKey)) continue;

    const members: ScoredCell[] = [];
    const stack = [start];
    visited.add(startKey);

    while (stack.length > 0) {
      const current = stack.pop()!;
      members.push(current);
      for (const [dRow, dCol] of NEIGHBOR_OFFSETS) {
        const neighborKey = `${current.cell.row + dRow},${current.cell.col + dCol}`;
        if (visited.has(neighborKey)) continue;
        const neighbor = byKey.get(neighborKey);
        if (!neighbor) continue;
        visited.add(neighborKey);
        stack.push(neighbor);
      }
    }

    clusters.push(members);
  }

  return clusters;
}

/**
 * Turns a cluster of adjacent risky cells into one `DangerZone` circle.
 * The circle's radius reflects two things: how much physical area the
 * cluster spans (centroid to farthest member cell), and how severe its
 * worst cell is (a single very-bad block still renders bigger than a
 * single barely-over-threshold block). Factor scores are averaged across
 * members for a representative breakdown; the overall weight/color uses
 * the cluster's worst cell, since that's the part a cyclist actually needs
 * to be warned about.
 */
function clusterToZone(members: ScoredCell[], seq: number): DangerZone {
  const centroid: LatLng = {
    lat: members.reduce((sum, m) => sum + m.cell.center.lat, 0) / members.length,
    lng: members.reduce((sum, m) => sum + m.cell.center.lng, 0) / members.length,
  };

  const maxComposite = Math.max(...members.map((m) => m.composite));
  const avg = (pick: (m: ScoredCell) => number) =>
    members.reduce((sum, m) => sum + pick(m), 0) / members.length;

  const extentMeters = Math.max(0, ...members.map((m) => haversineMeters(centroid, m.cell.center)));

  // 1x at the danger threshold, up to ~1.9x at the worst possible score.
  const severityT = Math.max(
    0,
    Math.min(1, (maxComposite - COMPOSITE_THRESHOLD) / (100 - COMPOSITE_THRESHOLD))
  );
  const severityMultiplier = 1 + severityT * 0.9;

  const baseRadius = extentMeters + GRID_CELL_METERS * 0.55;
  const radiusMeters = Math.round(
    Math.min(MAX_ZONE_RADIUS_METERS, Math.max(MIN_ZONE_RADIUS_METERS, baseRadius * severityMultiplier))
  );

  const crashIds = Array.from(new Set(members.flatMap((m) => m.cell.crashIds)));

  return {
    id: `zone-${seq}`,
    center: centroid,
    radiusMeters,
    weight: Math.round(maxComposite * 10) / 10,
    factorScores: {
      crashDensity: Math.round(avg((m) => m.crashDensity)),
      bikeInfrastructure: Math.round(avg((m) => m.bikeInfrastructure)),
      highwayExposure: Math.round(avg((m) => m.highwayExposure)),
    },
    crashIds,
  };
}

/**
 * Samples a fine grid ("block"-sized cells) across the demo city, scores
 * each cell on the three safety factors, and groups the cells above the
 * danger threshold into connected clusters (safe blocks are dropped before
 * clustering even starts). Shared by both `computeCompositeDangerZones`
 * (circle-based, used for route-risk scoring) and
 * `computeDangerousRoadSegments` (line-based, used for the map) so the two
 * always agree on which areas are actually dangerous.
 */
function computeQualifyingClusters(
  crashes: CrashRecord[],
  bikeLanes: BikeLaneSegment[],
  highways: HighwaySegment[]
): ScoredCell[][] {
  const gridPoints = buildGrid(GRID_CELL_METERS);

  const cells: GridCell[] = gridPoints.map(({ row, col, center }) => {
    const { raw, ids } = scoreCrashDensity(center, crashes);
    return {
      row,
      col,
      center,
      crashDensityRaw: raw,
      crashIds: ids,
      bikeInfrastructureRisk: scoreBikeInfrastructure(center, bikeLanes),
      highwayExposureRisk: scoreHighwayExposure(center, highways),
    };
  });

  const normalizedCrashDensity = normalize(cells.map((c) => c.crashDensityRaw));

  const scored: ScoredCell[] = cells.map((cell, i) => {
    const crashDensity = normalizedCrashDensity[i];
    const bikeInfrastructure = cell.bikeInfrastructureRisk;
    const highwayExposure = cell.highwayExposureRisk;
    const composite =
      FACTOR_WEIGHTS.crashDensity * crashDensity +
      FACTOR_WEIGHTS.bikeInfrastructure * bikeInfrastructure +
      FACTOR_WEIGHTS.highwayExposure * highwayExposure;
    return { cell, crashDensity, bikeInfrastructure, highwayExposure, composite };
  });

  const qualifying = scored.filter((s) => s.composite >= COMPOSITE_THRESHOLD);
  return clusterQualifyingCells(qualifying);
}

/**
 * Same underlying grid/clustering as `computeDangerousRoadSegments`, but
 * summarizes each cluster as one circle. Kept for route-risk scoring in
 * `assessRouteRisk`/`suggestAvoidanceWaypoint` (much simpler against a
 * circle + radius than against a set of line segments) - no longer used
 * for the map itself, see `computeDangerousRoadSegments` for that.
 * Returned sorted from most to least dangerous.
 */
export function computeCompositeDangerZones(
  crashes: CrashRecord[],
  bikeLanes: BikeLaneSegment[],
  highways: HighwaySegment[]
): DangerZone[] {
  const clusters = computeQualifyingClusters(crashes, bikeLanes, highways);
  const zones = clusters.map((members, i) => clusterToZone(members, i + 1));

  zones.sort((a, b) => b.weight - a.weight);
  return zones.map((zone, i) => ({ ...zone, id: `zone-${i + 1}` }));
}

interface PointFactorScores {
  crashDensityRaw: number;
  crashDensity: number;
  bikeInfrastructure: number;
  highwayExposure: number;
}

function scorePointRaw(
  point: LatLng,
  crashes: CrashRecord[],
  bikeLanes: BikeLaneSegment[],
  highways: HighwaySegment[]
): PointFactorScores {
  return {
    crashDensityRaw: scoreCrashDensity(point, crashes).raw,
    crashDensity: 0, // filled in once every point's raw value is known, see normalizeCrashDensity below
    bikeInfrastructure: scoreBikeInfrastructure(point, bikeLanes),
    highwayExposure: scoreHighwayExposure(point, highways),
  };
}

function compositeOf(p: PointFactorScores): number {
  return (
    FACTOR_WEIGHTS.crashDensity * p.crashDensity +
    FACTOR_WEIGHTS.bikeInfrastructure * p.bikeInfrastructure +
    FACTOR_WEIGHTS.highwayExposure * p.highwayExposure
  );
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function factorScoresOf(points: PointFactorScores[]): DangerFactorScores {
  return {
    crashDensity: Math.round(average(points.map((p) => p.crashDensity))),
    bikeInfrastructure: Math.round(average(points.map((p) => p.bikeInfrastructure))),
    highwayExposure: Math.round(average(points.map((p) => p.highwayExposure))),
  };
}

// A road's own OSM classification implies a baseline exposure/protection
// level even when it isn't one of our hand-curated MOCK_HIGHWAY_SEGMENTS /
// MOCK_BIKE_LANE_SEGMENTS entries (those only cover a handful of named
// corridors we specifically modeled; the real road network pulled from OSM
// in lib/dataSources/osmRoads.ts covers ~200 named streets, most of which
// have no curated entry to look proximity up against). Without this, e.g.
// "19th Avenue" (a real, fast, multi-lane arterial) would score
// highwayExposure=0 just for not being literally one of our 7 curated
// segments, and any real cycleway with no matching curated tier would score
// bikeInfrastructure=100 ("no lane at all") despite verifiably having a
// dedicated bike lane per OSM. These baselines are floors, not overrides -
// proximity to an actual curated hazard (e.g. running parallel to I-280)
// can still push the score higher.
const KIND_BASELINE_HIGHWAY_EXPOSURE: Record<RoadKind, number> = {
  freeway: 85,
  arterial: 35,
  bikeLane: 0,
};

function scoreRoadPoint(
  point: LatLng,
  kind: RoadKind,
  crashes: CrashRecord[],
  bikeLanes: BikeLaneSegment[],
  highways: HighwaySegment[]
): PointFactorScores {
  const raw = scorePointRaw(point, crashes, bikeLanes, highways);
  const highwayExposure = Math.max(raw.highwayExposure, KIND_BASELINE_HIGHWAY_EXPOSURE[kind]);
  // A confirmed real cycleway has *some* dedicated space for bikes even if
  // it doesn't match one of our curated tiers closely enough to look up -
  // cap its infra risk at "unprotected" rather than "no lane" (100).
  const bikeInfrastructure =
    kind === "bikeLane"
      ? Math.min(raw.bikeInfrastructure, BIKE_LANE_TIER_RISK.unprotected)
      : raw.bikeInfrastructure;
  return { ...raw, highwayExposure, bikeInfrastructure };
}

/**
 * Scores and renders the real San Francisco road network (from
 * `lib/dataSources/osmRoads.ts` - actual OpenStreetMap street geometry, not
 * hand-drawn approximations) as colored line segments, each colored by a
 * composite score sampled along its real path. `crashes`/`bikeLanes`/
 * `highways` remain the *scoring inputs* (crash proximity, curated bike-lane
 * tiers, curated highway/arterial exposure) exactly as before; `roads` is
 * the *set of real streets being scored and drawn*, which is what makes the
 * lines on the map line up with the actual roads Google's basemap renders.
 * Every segment also carries a `kind`, which the map uses to render it at a
 * width matching that road type (freeways widest, then arterials, then bike
 * lanes) independent of its safety score. Crash density is normalized once
 * across every sample point from every road, so scores stay comparable
 * across the whole network. Returned sorted from most to least dangerous.
 */
export function computeRoadNetworkSafety(
  crashes: CrashRecord[],
  bikeLanes: BikeLaneSegment[],
  highways: HighwaySegment[],
  roads: RealRoadSegment[]
): RoadSafetySegment[] {
  const roadScores = roads.map((road) => ({
    road,
    points: road.path.map((point) => scoreRoadPoint(point, road.kind, crashes, bikeLanes, highways)),
  }));

  const allRawCrashDensities = roadScores.flatMap((r) => r.points.map((p) => p.crashDensityRaw));
  const maxRawCrashDensity = Math.max(...allRawCrashDensities, 1e-9);
  for (const { points } of roadScores) {
    for (const p of points) {
      p.crashDensity = Math.min(100, (p.crashDensityRaw / maxRawCrashDensity) * 100);
    }
  }

  const segments: RoadSafetySegment[] = roadScores.map(({ road, points }) => ({
    id: road.id,
    name: road.name,
    kind: road.kind,
    path: road.path,
    score: Math.round(average(points.map(compositeOf)) * 10) / 10,
    factorScores: factorScoresOf(points),
  }));

  segments.sort((a, b) => b.score - a.score);
  return segments;
}

export interface RouteRiskAssessment {
  riskScore: number;
  zonesCrossed: DangerZone[];
}

/**
 * Scores how "dangerous" a route is by summing danger-zone weights for every
 * zone the path passes near, inversely scaled by distance from the zone
 * center (closer to the hazard = more risk contribution).
 */
export function assessRouteRisk(path: LatLng[], zones: DangerZone[]): RouteRiskAssessment {
  let riskScore = 0;
  const zonesCrossed: DangerZone[] = [];

  for (const zone of zones) {
    const dist = distanceToPathMeters(zone.center, path);
    if (dist <= zone.radiusMeters) {
      const proximity = 1 - dist / zone.radiusMeters; // 0..1, 1 = dead center
      riskScore += zone.weight * (0.4 + 0.6 * proximity);
      zonesCrossed.push(zone);
    }
  }

  return { riskScore: Math.round(riskScore * 10) / 10, zonesCrossed };
}

/**
 * Heuristic avoidance waypoint generator: for the worst offending danger
 * zone still on the route, push a waypoint just past the zone's edge, on the
 * side away from where the route currently threads through it. Feeding this
 * waypoint back into the Directions API tends to make it choose a
 * neighboring street instead.
 *
 * This is intentionally a lightweight heuristic suited for a hackathon-scale
 * demo layered on top of Google's black-box router. A production system
 * would instead run routing on a custom street graph with per-edge safety
 * costs (e.g. via OSRM/GraphHopper with a custom weight profile), which
 * avoids this "guess a waypoint and re-query" loop entirely.
 */
export function suggestAvoidanceWaypoint(zone: DangerZone, path: LatLng[]): LatLng {
  let closestPoint = path[0];
  let closestDist = Infinity;
  for (const point of path) {
    const d = haversineMeters(point, zone.center);
    if (d < closestDist) {
      closestDist = d;
      closestPoint = point;
    }
  }

  const dx = closestPoint.lng - zone.center.lng;
  const dy = closestPoint.lat - zone.center.lat;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1e-9;

  const clearance = zone.radiusMeters + 180;
  const dirLat = mag > 1e-9 ? dy / mag : 0.7;
  const dirLng = mag > 1e-9 ? dx / mag : 0.7;

  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((zone.center.lat * Math.PI) / 180);

  return {
    lat: zone.center.lat + (dirLat * clearance) / metersPerDegLat,
    lng: zone.center.lng + (dirLng * clearance) / metersPerDegLng,
  };
}
