import type { LatLng } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minimum distance in meters from a point to any segment of a polyline path. */
export function distanceToPathMeters(point: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineMeters(point, path[0]);

  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    min = Math.min(min, distanceToSegmentMeters(point, path[i], path[i + 1]));
  }
  return min;
}

/** Compass bearing (0-360, 0 = north) from `a` to `b`. */
function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Smallest angle (0-180) between two compass bearings. */
function bearingDiffDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Segments shorter than this are ignored when looking for backtracking -
// short zig-zags at an intersection (e.g. a jog to cross to the far
// crosswalk) are normal turn-by-turn noise, not a real "go out and come
// back" loop.
const MIN_BACKTRACK_SEGMENT_METERS = 25;
// Segments longer than this are also ignored: a genuine multi-kilometer
// detour that happens to reverse the route's general heading (e.g. routing
// far to one side to clear a hazard, then heading back the other way toward
// the destination) is a legitimate, intentional routing choice, not a "weird
// loop" bug. The bug this function targets is a *local* artifact - a short
// there-and-back spur - typically on the scale of one waypoint's clearance
// distance (see `suggestAvoidanceWaypoint`), not the whole route's shape.
const MAX_BACKTRACK_SEGMENT_METERS = 2000;
// A near-U-turn between two consecutive substantial segments - much sharper
// than any real street-grid turn (a normal turn, even a tight one, is well
// under this).
const BACKTRACK_ANGLE_THRESHOLD_DEGREES = 150;

/**
 * Detects a "weird loop" artifact: the route heads one way for a short real
 * distance, then immediately reverses and heads almost straight back the
 * way it came. This shows up in `lib/routing.ts`'s waypoint-detour logic
 * when a suggested avoidance waypoint sits awkwardly relative to the
 * route's natural direction of travel, and Google's router satisfies the
 * "must pass through this point" constraint by tacking on a there-and-back
 * spur instead of a sensible new path. A normal turn (even a sharp
 * 90-degree corner) never trips this, and neither does a large, intentional
 * detour around a hazard; only a short, local reversal does.
 */
export function hasBacktrackingLoop(path: LatLng[]): boolean {
  const substantial: { point: LatLng; bearingIn: number; length: number }[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const segmentLength = haversineMeters(path[i], path[i + 1]);
    if (segmentLength < MIN_BACKTRACK_SEGMENT_METERS) continue;
    substantial.push({
      point: path[i + 1],
      bearingIn: bearingDegrees(path[i], path[i + 1]),
      length: segmentLength,
    });
  }

  for (let i = 0; i < substantial.length - 1; i++) {
    const a = substantial[i];
    const b = substantial[i + 1];
    if (a.length > MAX_BACKTRACK_SEGMENT_METERS || b.length > MAX_BACKTRACK_SEGMENT_METERS) continue;

    const turn = bearingDiffDegrees(a.bearingIn, b.bearingIn);
    if (turn >= BACKTRACK_ANGLE_THRESHOLD_DEGREES) return true;
  }

  return false;
}

function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  // Project into a local equirectangular approximation, fine at city scale.
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(toRad(p.lat));

  const toXY = (pt: LatLng) => ({
    x: (pt.lng - a.lng) * metersPerDegLng,
    y: (pt.lat - a.lat) * metersPerDegLat,
  });

  const pXY = toXY(p);
  const bXY = toXY(b);
  const abLenSq = bXY.x ** 2 + bXY.y ** 2;

  if (abLenSq === 0) return haversineMeters(p, a);

  let t = (pXY.x * bXY.x + pXY.y * bXY.y) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const closest = { x: t * bXY.x, y: t * bXY.y };
  const dx = pXY.x - closest.x;
  const dy = pXY.y - closest.y;
  return Math.sqrt(dx * dx + dy * dy);
}
