export type LatLng = { lat: number; lng: number };

export type IncidentType = "collision" | "nearmiss" | "hazard" | "theft";

export type Severity = 1 | 2 | 3;

export interface CrashRecord {
  id: string;
  position: LatLng;
  type: IncidentType;
  /** 1 = minor, 2 = injury, 3 = fatal/severe */
  severity: Severity;
  date: string;
  description: string;
  /** Where this record came from, so mixed real/mock data stays traceable in the UI. */
  source: "mock" | "bikemaps" | "nhtsa" | "city-open-data";
}

/**
 * Bike lane quality tiers, best to worst:
 * - fullyProtected: physical barrier between bikes and car traffic (curb, posts, parking-protected)
 * - semiProtected: partial separation (e.g. painted buffer, occasional flex posts)
 * - unprotected: paint-only bike lane, no separation from traffic
 * - none: no bike lane at all, cyclists share the general travel lane
 */
export type BikeLaneTier = "fullyProtected" | "semiProtected" | "unprotected" | "none";

export interface BikeLaneSegment {
  id: string;
  name: string;
  path: LatLng[];
  tier: BikeLaneTier;
}

export type HighwaySegmentType = "freeway" | "arterial";

export interface HighwaySegment {
  id: string;
  name: string;
  path: LatLng[];
  type: HighwaySegmentType;
  /** Rough posted/typical speed, mph - used to scale exposure risk for arterials. */
  typicalSpeedMph: number;
}

/** The three safety factors that combine into a composite danger score, each normalized 0-100 (higher = worse/riskier). */
export interface DangerFactorScores {
  crashDensity: number;
  bikeInfrastructure: number;
  highwayExposure: number;
}

export interface DangerZone {
  id: string;
  center: LatLng;
  /** Influence radius in meters - a circular approximation of a block-sized unsafe area. */
  radiusMeters: number;
  /** Composite weight (higher = worse), combining the three factor scores with fixed weights. */
  weight: number;
  factorScores: DangerFactorScores;
  crashIds: string[];
}

/**
 * What kind of road a `RoadSafetySegment` represents - drives the rendered
 * line thickness ("the size of the road") independently of its safety
 * score (which drives color). Matches our named mock road entities.
 */
export type RoadKind = "bikeLane" | "arterial" | "freeway";

/**
 * A road-like line segment rendered on the map and colored by how safe
 * that stretch is. Every road is included (not just dangerous ones), so
 * together they paint a full green-to-red picture of the whole city, like
 * a traffic layer but for safety instead of congestion.
 */
export interface RoadSafetySegment {
  id: string;
  name?: string;
  kind: RoadKind;
  path: LatLng[];
  /** Composite score for this specific stretch (0-100, higher = worse). */
  score: number;
  factorScores: DangerFactorScores;
}

/**
 * A real, named street with actual OpenStreetMap road-centerline geometry
 * (see `lib/dataSources/osmRoads.ts` / `scripts/fetchSfRoads.mjs`) - used as
 * the input to `computeRoadNetworkSafety` so the rendered `RoadSafetySegment`
 * paths sit exactly on top of the real roads Google's basemap draws, instead
 * of on hand-picked approximate coordinates.
 */
export interface RealRoadSegment {
  id: string;
  name: string;
  kind: RoadKind;
  path: LatLng[];
}

export type MapLayerId =
  | "neighborhoodSafety"
  | "bikeInfrastructure"
  | "highwayExposure"
  | "overallSafety";

/** One turn-by-turn direction, e.g. "Turn right onto Valencia St" for 0.3 mi. */
export interface RouteStep {
  instructions: string;
  distanceMeters: number;
  durationSeconds: number;
}

/** A named, real bike lane the route runs along for a meaningful stretch. */
export interface BikeLaneUsage {
  name: string;
  tier: BikeLaneTier;
}

/** One of the specific, named dangerous areas fed into the danger model (see `lib/mockData.ts`) - used to report which of them a route did/didn't avoid, by name rather than an opaque zone id. */
export interface NamedDangerLocation {
  name: string;
  center: LatLng;
}

export interface RouteRiskResult {
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  riskScore: number;
  zonesCrossed: DangerZone[];
  steps: RouteStep[];
  /** Real, named protected/semi-protected bike lanes this route runs along for a meaningful stretch - empty for `fastest` unless it happens to already use one. */
  bikeLanesUsed?: BikeLaneUsage[];
  /** Named dangerous areas (see `KNOWN_DANGEROUS_LOCATIONS`/`NAMED_DANGEROUS_LOCATIONS` in `lib/mockData.ts`) that Google's default route runs through but this route doesn't - only meaningful for `balancedSafe`/`safest`, always empty for `fastest`. */
  neighborhoodsAvoided?: string[];
}

/**
 * The three route choices offered to the user, from least to most
 * safety-optimized:
 * - fastest: Google's own default bike route, untouched.
 * - balancedSafe ("Overall best safe route"): detours around the worst
 *   danger zones still on the route, but stops once risk is reasonably low
 *   or after a bounded number of detours - a middle ground that doesn't
 *   chase every last zone at the cost of a much longer trip.
 * - safest ("Absolute safest route"): keeps detouring, continuing from
 *   wherever balancedSafe left off, until literally no danger zone is
 *   crossed (or it truly can't do any better) - safety above all else,
 *   whatever the distance/time cost.
 */
export type RouteOptionKind = "fastest" | "balancedSafe" | "safest";

export interface RouteOptions {
  fastest: RouteRiskResult;
  balancedSafe: RouteRiskResult;
  safest: RouteRiskResult;
}
