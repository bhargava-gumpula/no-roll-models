import { assessRouteRisk, suggestAvoidanceWaypoint } from "./danger";
import { hasBacktrackingLoop } from "./geo";
import type { DangerZone, LatLng, RouteComparison, RouteRiskResult } from "./types";

export interface RawRoute {
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Requests a route between two points, optionally through waypoints, and
 * returns its path + distance/duration. Kept as an injectable function
 * (rather than calling `google.maps.DirectionsService` directly in this
 * file) so `computeRouteComparison`'s detour-loop logic can be unit tested
 * with a fake router, with no dependency on the Google Maps JS SDK being
 * loaded. See `lib/googleDirections.ts` for the real browser implementation.
 */
export type RequestRouteFn = (origin: LatLng, destination: LatLng, waypoints: LatLng[]) => Promise<RawRoute>;

const MAX_DETOUR_ITERATIONS = 5;
// Below this, a route's remaining risk isn't worth detouring further for -
// the marginal safety gain doesn't outweigh the added distance/complexity
// of one more waypoint. Roughly "brushes past the edge of one moderate
// zone" territory rather than "cuts through the middle of a bad one."
const RISK_STOP_THRESHOLD = 20;

function toRiskResult(route: RawRoute, dangerZones: DangerZone[]): RouteRiskResult {
  const { riskScore, zonesCrossed } = assessRouteRisk(route.path, dangerZones);
  return { ...route, riskScore, zonesCrossed };
}

/**
 * Computes both a "fastest" route (Google's default bike directions) and a
 * "safest" route (the fastest route, then iteratively detoured around its
 * own worst danger zones) between an origin and destination, so the UI can
 * show a side-by-side comparison - the core ask from the original project
 * brief ("compare the route our model provides [to Google's], and show why
 * it is safer").
 *
 * This is a lightweight heuristic layered on top of Google's black-box
 * router (see `suggestAvoidanceWaypoint` in lib/danger.ts for why a real
 * production system would instead run routing on a custom street graph
 * with per-edge safety costs). Each iteration:
 *   1. Finds the single highest-weight danger zone still crossed by the
 *      current best route.
 *   2. Asks `suggestAvoidanceWaypoint` for a point that clears that zone.
 *   3. Re-requests directions through every waypoint found so far (not just
 *      the new one - earlier detours must stay in effect).
 *   4. Keeps the new route only if it's actually less risky than what we
 *      had *and* doesn't introduce a "weird loop" (`hasBacktrackingLoop`) -
 *      a there-and-back spur that Google's router sometimes tacks on to
 *      satisfy an awkwardly-placed waypoint; otherwise stops (this also
 *      guards against Google's router folding the waypoint right back
 *      through the same danger zone, which would otherwise loop forever).
 * Stops early once risk drops below `RISK_STOP_THRESHOLD`, no zones are
 * crossed, a detour fails to help (or loops), or `MAX_DETOUR_ITERATIONS` is
 * hit.
 */
export async function computeRouteComparison(
  requestRoute: RequestRouteFn,
  origin: LatLng,
  destination: LatLng,
  dangerZones: DangerZone[]
): Promise<RouteComparison> {
  const fastestRaw = await requestRoute(origin, destination, []);
  const fastest = toRiskResult(fastestRaw, dangerZones);

  let safest = fastest;
  const waypoints: LatLng[] = [];

  for (let i = 0; i < MAX_DETOUR_ITERATIONS; i++) {
    if (safest.riskScore <= RISK_STOP_THRESHOLD || safest.zonesCrossed.length === 0) break;

    const worstZone = [...safest.zonesCrossed].sort((a, b) => b.weight - a.weight)[0];
    const waypoint = suggestAvoidanceWaypoint(worstZone, safest.path);
    const candidateWaypoints = [...waypoints, waypoint];

    const candidateRaw = await requestRoute(origin, destination, candidateWaypoints);
    const candidate = toRiskResult(candidateRaw, dangerZones);

    if (candidate.riskScore >= safest.riskScore || hasBacktrackingLoop(candidate.path)) break;

    waypoints.push(waypoint);
    safest = candidate;
  }

  const improvedRiskPercent =
    fastest.riskScore > 0
      ? Math.round(((fastest.riskScore - safest.riskScore) / fastest.riskScore) * 1000) / 10
      : 0;

  return { fastest, safest, improvedRiskPercent };
}
