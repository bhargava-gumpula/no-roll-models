import {
  assessRouteRisk,
  findHighwayApproach,
  suggestAvoidanceWaypoint,
  suggestBikeLaneWaypoint,
  suggestHighwayAvoidanceWaypoint,
  summarizeBikeLanesUsed,
  summarizeNeighborhoodsAvoided,
} from "./danger";
import { hasBacktrackingLoop } from "./geo";
import type {
  BikeLaneSegment,
  DangerZone,
  HighwaySegment,
  LatLng,
  NamedDangerLocation,
  RouteOptions,
  RouteRiskResult,
  RouteStep,
} from "./types";

export interface RawRoute {
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
}

/**
 * Requests a route between two points, optionally through waypoints, and
 * returns its path + distance/duration/turn-by-turn steps. Kept as an
 * injectable function (rather than calling `google.maps.DirectionsService`
 * directly in this file) so `computeRouteOptions`'s detour-loop logic can be
 * unit tested with a fake router, with no dependency on the Google Maps JS
 * SDK being loaded. See `lib/googleDirections.ts` for the real browser
 * implementation.
 */
export type RequestRouteFn = (origin: LatLng, destination: LatLng, waypoints: LatLng[]) => Promise<RawRoute>;

// "Overall best safe route": a middle ground that stops detouring once risk
// is reasonably low, rather than chasing every last zone at the cost of a
// much longer trip.
const MAX_DETOUR_ITERATIONS = 5;
// Below this, a route's remaining risk isn't worth detouring further for -
// the marginal safety gain doesn't outweigh the added distance/complexity
// of one more waypoint. Roughly "brushes past the edge of one moderate
// zone" territory rather than "cuts through the middle of a bad one."
const RISK_STOP_THRESHOLD = 20;

// "Absolute safest route": keeps going - continuing from wherever the
// balanced route left off - until literally no danger zone is crossed
// (riskStopThreshold 0), or it truly can't do any better. A higher total
// iteration budget than the balanced pass since it has a much harder bar to
// clear (zero zones, not just "low enough" risk).
const MAX_ABSOLUTE_SAFEST_ITERATIONS = 10;

function toRiskResult(route: RawRoute, dangerZones: DangerZone[]): RouteRiskResult {
  const { riskScore, zonesCrossed } = assessRouteRisk(route.path, dangerZones);
  return { ...route, riskScore, zonesCrossed };
}

interface DetourLoopResult {
  route: RouteRiskResult;
  waypoints: LatLng[];
}

/**
 * Shared core of both the "balanced" and "absolute safest" passes: repeatedly
 * finds the single highest-weight danger zone still crossed by the current
 * best route, asks `suggestAvoidanceWaypoint` for a point that clears it,
 * and re-requests directions through every waypoint found so far (not just
 * the new one - earlier detours must stay in effect). Keeps a candidate only
 * if it's actually less risky than what came before *and* doesn't introduce
 * a "weird loop" (`hasBacktrackingLoop`) - a there-and-back spur Google's
 * router sometimes tacks on to satisfy an awkwardly-placed waypoint;
 * otherwise stops (this also guards against Google's router folding the
 * waypoint right back through the same danger zone, which would otherwise
 * loop forever). Stops early once risk drops to/below `riskStopThreshold`,
 * no zones are crossed, a detour fails to help (or loops), or
 * `maxIterations` is hit.
 */
async function runDetourLoop(
  requestRoute: RequestRouteFn,
  origin: LatLng,
  destination: LatLng,
  dangerZones: DangerZone[],
  start: DetourLoopResult,
  riskStopThreshold: number,
  maxIterations: number
): Promise<DetourLoopResult> {
  let route = start.route;
  const waypoints = [...start.waypoints];

  for (let i = 0; i < maxIterations; i++) {
    if (route.riskScore <= riskStopThreshold || route.zonesCrossed.length === 0) break;

    const worstZone = [...route.zonesCrossed].sort((a, b) => b.weight - a.weight)[0];
    const waypoint = suggestAvoidanceWaypoint(worstZone, route.path);
    const candidateWaypoints = [...waypoints, waypoint];

    const candidateRaw = await requestRoute(origin, destination, candidateWaypoints);
    const candidate = toRiskResult(candidateRaw, dangerZones);

    if (candidate.riskScore >= route.riskScore || hasBacktrackingLoop(candidate.path)) break;

    waypoints.push(waypoint);
    route = candidate;
  }

  return { route, waypoints };
}

// Bounded, non-risk-driven passes appended after the main zone-avoidance
// detour loop finishes - "avoid the big highways... favor the routes with
// a bike lane." Kept separate from `runDetourLoop` (rather than folded into
// it) so they're purely additive: when `highways`/`bikeLanes` aren't passed
// in (the default), these loops see empty candidate lists and exit
// immediately on their first check, leaving existing zone-only-detour
// behavior (and every test built against it) completely unchanged.
const MAX_HIGHWAY_AVOID_ITERATIONS = 3;
const MAX_BIKE_LANE_NUDGE_ATTEMPTS = 2;
// A bike-lane nudge is a "nice to have," not a safety fix - allow at most a
// modest distance cost to actually get on one, so this can't turn into a
// large, pointless detour just to touch a protected lane far off the way.
const BIKE_LANE_NUDGE_MAX_DISTANCE_INCREASE = 0.2;

/**
 * After the zone-avoidance loop settles, tries to (a) steer away from any
 * highway/arterial the resulting route still runs directly alongside, then
 * (b) nudge onto a nearby protected/semi-protected bike lane it isn't
 * already using. Both passes reuse the same "keep the candidate only if it
 * actually helps and doesn't loop" discipline as `runDetourLoop`.
 */
async function applyHighwayAndBikeLanePasses(
  requestRoute: RequestRouteFn,
  origin: LatLng,
  destination: LatLng,
  dangerZones: DangerZone[],
  start: DetourLoopResult,
  highways: HighwaySegment[],
  bikeLanes: BikeLaneSegment[]
): Promise<DetourLoopResult> {
  let route = start.route;
  const waypoints = [...start.waypoints];

  for (let i = 0; i < MAX_HIGHWAY_AVOID_ITERATIONS; i++) {
    const approach = findHighwayApproach(route.path, highways);
    if (!approach) break;

    const waypoint = suggestHighwayAvoidanceWaypoint(approach, route.path);
    const candidateWaypoints = [...waypoints, waypoint];
    const candidateRaw = await requestRoute(origin, destination, candidateWaypoints);
    const candidate = toRiskResult(candidateRaw, dangerZones);

    if (hasBacktrackingLoop(candidate.path) || candidate.riskScore > route.riskScore) break;
    const stillApproaches = findHighwayApproach(candidate.path, [approach.highway]);
    if (stillApproaches && stillApproaches.distanceMeters <= approach.distanceMeters) break; // didn't actually get further away

    waypoints.push(waypoint);
    route = candidate;
  }

  let candidateLanes = bikeLanes;
  for (let i = 0; i < MAX_BIKE_LANE_NUDGE_ATTEMPTS; i++) {
    const suggestion = suggestBikeLaneWaypoint(route.path, candidateLanes);
    if (!suggestion) break;

    const candidateWaypoints = [...waypoints, suggestion.waypoint];
    const candidateRaw = await requestRoute(origin, destination, candidateWaypoints);
    const candidate = toRiskResult(candidateRaw, dangerZones);
    const distanceIncrease = (candidate.distanceMeters - route.distanceMeters) / Math.max(1, route.distanceMeters);

    const helped =
      !hasBacktrackingLoop(candidate.path) &&
      candidate.riskScore <= route.riskScore &&
      distanceIncrease <= BIKE_LANE_NUDGE_MAX_DISTANCE_INCREASE;

    // Drop this lane from consideration either way - if it helped it's now
    // reflected in `route`/`waypoints`; if not, retrying the same one would
    // just fail again.
    candidateLanes = candidateLanes.filter((l) => l.id !== suggestion.laneId);

    if (helped) {
      waypoints.push(suggestion.waypoint);
      route = candidate;
    }
  }

  return { route, waypoints };
}

export interface RouteOptionsCallbacks {
  /** Fired as soon as Google's own default route is known - lets the UI show it immediately rather than waiting for the safer variants too. */
  onFastest?: (route: RouteRiskResult) => void;
  /** Fired once the "overall best safe route" is ready, before the (potentially slower) "absolute safest" pass starts. */
  onBalancedSafe?: (route: RouteRiskResult) => void;
}

/**
 * Optional extra data used to go beyond pure danger-zone avoidance -
 * "avoid the big highways," "favor the routes with a bike lane," and
 * reporting *which* bike lanes/named locations a route used/avoided. All
 * default to empty, in which case `computeRouteOptions` behaves exactly as
 * before (danger-zone avoidance only).
 */
export interface RouteOptionsExtras {
  highways?: HighwaySegment[];
  /** Should already be filtered to the tiers worth actively routing toward/reporting (fully/semi-protected) - see `/api/layers`. */
  bikeLanes?: BikeLaneSegment[];
  namedLocations?: NamedDangerLocation[];
}

/**
 * Computes the three route choices shown to the user - Google's own
 * ("fastest"), a balanced safety detour ("balancedSafe"), and a maximum
 * safety detour ("safest") - between an origin and destination. This is the
 * core ask from the original project brief ("compare the route our model
 * provides [to Google's], and show why it is safer"), now with two safety
 * tiers instead of one.
 *
 * This is a lightweight heuristic layered on top of Google's black-box
 * router (see `suggestAvoidanceWaypoint` in lib/danger.ts for why a real
 * production system would instead run routing on a custom street graph
 * with per-edge safety costs). The "safest" pass deliberately continues
 * from wherever "balancedSafe" left off (reusing its waypoints) rather than
 * starting over from scratch, so upgrading from balanced to absolute-safest
 * doesn't cost a second full round of redundant Directions API calls.
 *
 * `callbacks` let the UI progressively reveal each route as it becomes
 * available instead of blocking on all three (Google's own route typically
 * resolves in under a second; the safety passes each need one Directions
 * API call per detour iteration on top of that).
 */
export async function computeRouteOptions(
  requestRoute: RequestRouteFn,
  origin: LatLng,
  destination: LatLng,
  dangerZones: DangerZone[],
  callbacks: RouteOptionsCallbacks = {},
  extras: RouteOptionsExtras = {}
): Promise<RouteOptions> {
  const { highways = [], bikeLanes = [], namedLocations = [] } = extras;

  const fastestRaw = await requestRoute(origin, destination, []);
  const fastestBase = toRiskResult(fastestRaw, dangerZones);
  // Compared against itself, so `neighborhoodsAvoided` is trivially always
  // empty here - kept structurally consistent with balancedSafe/safest
  // (which both carry these fields) rather than special-cased to omit them.
  const fastest = withExtrasSummary(fastestBase, fastestBase, bikeLanes, namedLocations);
  callbacks.onFastest?.(fastest);

  let balancedLoop = await runDetourLoop(
    requestRoute,
    origin,
    destination,
    dangerZones,
    { route: fastest, waypoints: [] },
    RISK_STOP_THRESHOLD,
    MAX_DETOUR_ITERATIONS
  );
  balancedLoop = await applyHighwayAndBikeLanePasses(
    requestRoute,
    origin,
    destination,
    dangerZones,
    balancedLoop,
    highways,
    bikeLanes
  );
  const balancedSafe = withExtrasSummary(balancedLoop.route, fastest, bikeLanes, namedLocations);
  callbacks.onBalancedSafe?.(balancedSafe);

  let safestLoop =
    balancedLoop.route.zonesCrossed.length === 0
      ? balancedLoop
      : await runDetourLoop(
          requestRoute,
          origin,
          destination,
          dangerZones,
          balancedLoop,
          0,
          Math.max(0, MAX_ABSOLUTE_SAFEST_ITERATIONS - MAX_DETOUR_ITERATIONS)
        );
  safestLoop = await applyHighwayAndBikeLanePasses(
    requestRoute,
    origin,
    destination,
    dangerZones,
    safestLoop,
    highways,
    bikeLanes
  );
  const safest = withExtrasSummary(safestLoop.route, fastest, bikeLanes, namedLocations);

  return { fastest, balancedSafe, safest };
}

function withExtrasSummary(
  route: RouteRiskResult,
  fastest: RouteRiskResult,
  bikeLanes: BikeLaneSegment[],
  namedLocations: NamedDangerLocation[]
): RouteRiskResult {
  return {
    ...route,
    bikeLanesUsed: summarizeBikeLanesUsed(route.path, bikeLanes),
    neighborhoodsAvoided: summarizeNeighborhoodsAvoided(route, fastest.zonesCrossed, namedLocations),
  };
}

/** How much less risky `other` is than `fastest`, as a rounded percentage (0 if `fastest` already had zero risk). */
export function improvedRiskPercent(fastest: RouteRiskResult, other: RouteRiskResult): number {
  if (fastest.riskScore <= 0) return 0;
  return Math.round(((fastest.riskScore - other.riskScore) / fastest.riskScore) * 1000) / 10;
}
