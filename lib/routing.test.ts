import { describe, expect, it } from "vitest";
import { computeRouteComparison } from "./routing";
import type { RequestRouteFn } from "./routing";
import type { DangerZone, LatLng } from "./types";

const ORIGIN: LatLng = { lat: 37.76, lng: -122.43 };
const DESTINATION: LatLng = { lat: 37.79, lng: -122.4 };

function zone(overrides: Partial<DangerZone> & Pick<DangerZone, "id" | "center" | "weight">): DangerZone {
  return {
    radiusMeters: 300,
    factorScores: { crashDensity: 0, bikeInfrastructure: 0, highwayExposure: 0 },
    crashIds: [],
    ...overrides,
  };
}

describe("computeRouteComparison", () => {
  it("returns identical fastest/safest and 0% improvement when no danger zone is crossed", async () => {
    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination) => {
      calls++;
      return { path: [origin, destination], distanceMeters: 1000, durationSeconds: 300 };
    };

    const result = await computeRouteComparison(requestRoute, ORIGIN, DESTINATION, []);

    expect(calls).toBe(1); // never attempts a detour if there's nothing to avoid
    expect(result.safest).toEqual(result.fastest);
    expect(result.improvedRiskPercent).toBe(0);
  });

  it("detours around danger zones one at a time, worst first, until the route is clear", async () => {
    // Zones placed far apart from each other and from the direct origin ->
    // destination line, so dropping one as an explicit path vertex actually
    // clears it (rather than it still being "crossed" just from sitting
    // near the remaining path).
    const zoneA = zone({ id: "a", center: { lat: 37.9, lng: -122.55 }, weight: 90 });
    const zoneB = zone({ id: "b", center: { lat: 37.65, lng: -122.25 }, weight: 50 });

    const calls: number[] = [];
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      calls.push(waypoints.length);
      if (waypoints.length === 0) {
        return { path: [origin, zoneA.center, zoneB.center, destination], distanceMeters: 1000, durationSeconds: 300 };
      }
      if (waypoints.length === 1) {
        return { path: [origin, zoneB.center, destination], distanceMeters: 1100, durationSeconds: 320 };
      }
      return { path: [origin, destination], distanceMeters: 1300, durationSeconds: 380 };
    };

    const result = await computeRouteComparison(requestRoute, ORIGIN, DESTINATION, [zoneA, zoneB]);

    expect(calls).toEqual([0, 1, 2]); // fastest, then one detour per zone, worst-weight first
    expect(result.fastest.zonesCrossed.map((z) => z.id).sort()).toEqual(["a", "b"]);
    expect(result.safest.zonesCrossed).toHaveLength(0);
    expect(result.safest.riskScore).toBeLessThan(result.fastest.riskScore);
    expect(result.improvedRiskPercent).toBe(100);
  });

  it("keeps the original route when a candidate detour doesn't actually reduce risk", async () => {
    const zoneA = zone({ id: "a", center: { lat: 37.77, lng: -122.42 }, weight: 90 });

    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination) => {
      calls++;
      // Every request - detour or not - comes back crossing the same zone at
      // the same severity, simulating Google's router folding the waypoint
      // right back through the hazard.
      return { path: [origin, zoneA.center, destination], distanceMeters: 1000, durationSeconds: 300 };
    };

    const result = await computeRouteComparison(requestRoute, ORIGIN, DESTINATION, [zoneA]);

    expect(calls).toBe(2); // tries exactly one detour, then gives up
    expect(result.safest).toEqual(result.fastest);
    expect(result.improvedRiskPercent).toBe(0);
  });

  it("rejects a candidate detour that clears the danger zone but backtracks in a weird loop", async () => {
    const zoneA = zone({ id: "a", center: { lat: 37.77, lng: -122.42 }, weight: 90 });

    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      calls++;
      if (waypoints.length === 0) {
        return { path: [origin, zoneA.center, destination], distanceMeters: 1000, durationSeconds: 300 };
      }
      // Technically clears the zone (nowhere near zoneA.center), but heads
      // ~110m one way and then almost straight back - a there-and-back spur
      // far from anything a sane router would produce.
      return {
        path: [
          origin,
          { lat: 37.7749, lng: -122.4194 },
          { lat: 37.7758, lng: -122.4194 },
          { lat: 37.775, lng: -122.4194 },
          destination,
        ],
        distanceMeters: 1400,
        durationSeconds: 420,
      };
    };

    const result = await computeRouteComparison(requestRoute, ORIGIN, DESTINATION, [zoneA]);

    expect(calls).toBe(2); // tries exactly one detour, rejects it for looping, gives up
    expect(result.safest).toEqual(result.fastest);
    expect(result.safest.zonesCrossed).toHaveLength(1); // kept the original, still-crossing route
    expect(result.improvedRiskPercent).toBe(0);
  });

  it("never loops forever, even if risk keeps only marginally improving", async () => {
    // Six zones, descending weight - each call is expected to have cleared
    // one more (the previous worst) than the last, so risk keeps dropping
    // but a zone is always still crossed, and the threshold is never quite
    // reached within a bounded number of iterations.
    const zones: DangerZone[] = Array.from({ length: 6 }, (_, i) =>
      zone({ id: `z${i}`, center: { lat: 37.77 + i * 0.001, lng: -122.42 }, weight: 100 - i * 5 })
    );

    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      calls++;
      const remaining = zones.slice(waypoints.length);
      return {
        path: [origin, ...remaining.map((z) => z.center), destination],
        distanceMeters: 1000,
        durationSeconds: 300,
      };
    };

    const result = await computeRouteComparison(requestRoute, ORIGIN, DESTINATION, zones);

    expect(calls).toBeLessThanOrEqual(6); // 1 initial + at most 5 detour iterations
    expect(result.fastest.zonesCrossed).toHaveLength(6);
    expect(result.safest.zonesCrossed.length).toBeGreaterThan(0); // never fully cleared
    expect(result.safest.riskScore).toBeLessThan(result.fastest.riskScore);
  });
});
