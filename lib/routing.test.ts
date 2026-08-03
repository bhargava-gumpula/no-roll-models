import { describe, expect, it } from "vitest";
import { computeRouteOptions, improvedRiskPercent } from "./routing";
import type { RequestRouteFn } from "./routing";
import type { BikeLaneSegment, DangerZone, HighwaySegment, LatLng, NamedDangerLocation } from "./types";

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

function route(path: LatLng[], distanceMeters: number, durationSeconds: number) {
  return { path, distanceMeters, durationSeconds, steps: [] };
}

describe("computeRouteOptions", () => {
  it("returns identical fastest/balancedSafe/safest when no danger zone is crossed", async () => {
    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination) => {
      calls++;
      return route([origin, destination], 1000, 300);
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, []);

    expect(calls).toBe(1); // never attempts a detour if there's nothing to avoid
    expect(result.balancedSafe).toEqual(result.fastest);
    expect(result.safest).toEqual(result.fastest);
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
        return route([origin, zoneA.center, zoneB.center, destination], 1000, 300);
      }
      if (waypoints.length === 1) {
        return route([origin, zoneB.center, destination], 1100, 320);
      }
      return route([origin, destination], 1300, 380);
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, [zoneA, zoneB]);

    expect(calls).toEqual([0, 1, 2]); // fastest, then one detour per zone, worst-weight first
    expect(result.fastest.zonesCrossed.map((z) => z.id).sort()).toEqual(["a", "b"]);
    expect(result.balancedSafe.zonesCrossed).toHaveLength(0);
    expect(result.balancedSafe.riskScore).toBeLessThan(result.fastest.riskScore);
    // Both zones were fully cleared during the balanced pass already, so the
    // absolute-safest pass has nothing left to do and matches it exactly -
    // no redundant extra Directions calls.
    expect(result.safest).toEqual(result.balancedSafe);
  });

  it("'absolute safest' keeps detouring past where 'overall best safe route' stops", async () => {
    // Zones placed far apart from each other and from the direct origin ->
    // destination line (same layout as the test above), so a path that
    // drops one as a vertex genuinely clears it rather than still counting
    // as "crossed" from mere proximity. zoneA is severe enough alone to keep
    // the balanced pass going; zoneB is mild enough that once it's the
    // *only* remaining zone, its risk contribution sits at/under the
    // balanced pass's stop threshold (20) - so balancedSafe stops with
    // zoneB still technically crossed, while safest (threshold 0) keeps
    // going and clears it too.
    const zoneA = zone({ id: "a", center: { lat: 37.9, lng: -122.55 }, weight: 90 });
    const zoneB = zone({ id: "b", center: { lat: 37.65, lng: -122.25 }, weight: 15 });

    const calls: number[] = [];
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      calls.push(waypoints.length);
      if (waypoints.length === 0) return route([origin, zoneA.center, zoneB.center, destination], 1000, 300);
      if (waypoints.length === 1) return route([origin, zoneB.center, destination], 1100, 320);
      return route([origin, destination], 1300, 380);
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, [zoneA, zoneB]);

    expect(calls).toEqual([0, 1, 2]);
    expect(result.fastest.zonesCrossed).toHaveLength(2);
    expect(result.balancedSafe.zonesCrossed.map((z) => z.id)).toEqual(["b"]);
    expect(result.balancedSafe.riskScore).toBeLessThanOrEqual(20);
    expect(result.safest.zonesCrossed).toHaveLength(0);
    expect(result.safest.riskScore).toBe(0);
    expect(result.safest.riskScore).toBeLessThan(result.balancedSafe.riskScore);
  });

  it("fires onFastest/onBalancedSafe callbacks progressively, before the final result resolves", async () => {
    // zoneA sits far from the direct origin -> destination line, so the
    // plain 2-point "cleared" response below is genuinely outside its
    // radius rather than still coincidentally within it.
    const zoneA = zone({ id: "a", center: { lat: 37.9, lng: -122.55 }, weight: 90 });
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      if (waypoints.length === 0) return route([origin, zoneA.center, destination], 1000, 300);
      return route([origin, destination], 1200, 340);
    };

    const seen: string[] = [];
    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, [zoneA], {
      onFastest: () => seen.push("fastest"),
      onBalancedSafe: () => seen.push("balancedSafe"),
    });

    expect(seen).toEqual(["fastest", "balancedSafe"]);
    expect(result.safest.zonesCrossed).toHaveLength(0);
  });

  it("keeps the original route (at every tier) when a candidate detour doesn't actually reduce risk", async () => {
    const zoneA = zone({ id: "a", center: { lat: 37.77, lng: -122.42 }, weight: 90 });

    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination) => {
      calls++;
      // Every request - detour or not - comes back crossing the same zone at
      // the same severity, simulating Google's router folding the waypoint
      // right back through the hazard.
      return route([origin, zoneA.center, destination], 1000, 300);
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, [zoneA]);

    // 1 fastest + 1 rejected balanced attempt + 1 rejected safest attempt.
    expect(calls).toBe(3);
    expect(result.balancedSafe).toEqual(result.fastest);
    expect(result.safest).toEqual(result.fastest);
  });

  it("rejects a candidate detour that clears the danger zone but backtracks in a weird loop, at every tier", async () => {
    const zoneA = zone({ id: "a", center: { lat: 37.77, lng: -122.42 }, weight: 90 });

    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      calls++;
      if (waypoints.length === 0) return route([origin, zoneA.center, destination], 1000, 300);
      // Technically clears the zone (nowhere near zoneA.center), but heads
      // ~110m one way and then almost straight back - a there-and-back spur
      // far from anything a sane router would produce.
      return route(
        [
          origin,
          { lat: 37.7749, lng: -122.4194 },
          { lat: 37.7758, lng: -122.4194 },
          { lat: 37.775, lng: -122.4194 },
          destination,
        ],
        1400,
        420
      );
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, [zoneA]);

    expect(calls).toBe(3); // 1 fastest + 1 rejected balanced attempt + 1 rejected safest attempt
    expect(result.balancedSafe).toEqual(result.fastest);
    expect(result.safest).toEqual(result.fastest);
    expect(result.safest.zonesCrossed).toHaveLength(1); // kept the original, still-crossing route
  });

  it("never loops forever, even with far more zones than the combined iteration budget", async () => {
    // 15 zones, descending weight - each call is expected to have cleared
    // one more (the previous worst) than the last, so risk keeps dropping
    // but a zone is always still crossed. The combined balanced + safest
    // budget is bounded (5 + 5 = 10 detour attempts), so some zones must
    // still remain uncrossed at the end rather than the loop running
    // indefinitely trying to clear all 15.
    const zones: DangerZone[] = Array.from({ length: 15 }, (_, i) =>
      zone({ id: `z${i}`, center: { lat: 37.77 + i * 0.001, lng: -122.42 }, weight: 100 - i * 5 })
    );

    let calls = 0;
    const requestRoute: RequestRouteFn = async (origin, destination, waypoints) => {
      calls++;
      const remaining = zones.slice(waypoints.length);
      return route([origin, ...remaining.map((z) => z.center), destination], 1000, 300);
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, zones);

    expect(calls).toBeLessThanOrEqual(11); // 1 initial + at most 5 balanced + at most 5 safest
    expect(result.fastest.zonesCrossed).toHaveLength(15);
    expect(result.safest.zonesCrossed.length).toBeGreaterThan(0); // never fully cleared
    expect(result.safest.riskScore).toBeLessThan(result.balancedSafe.riskScore);
    expect(result.balancedSafe.riskScore).toBeLessThan(result.fastest.riskScore);
  });
});

describe("computeRouteOptions extras (highways / bike lanes / named locations)", () => {
  // Kept well clear (>500m) of the test highway/bike-lane geometry below, so
  // a "cleared" candidate response (a plain straight line between these two
  // points) doesn't accidentally still count as close to either.
  const origin: LatLng = { lat: 37.765, lng: -122.425 };
  const destination: LatLng = { lat: 37.785, lng: -122.425 };

  it("detours away from a highway the route runs alongside, given extras.highways", async () => {
    const highway: HighwaySegment = {
      id: "hwy-1",
      name: "Test Freeway",
      type: "freeway",
      typicalSpeedMph: 55,
      path: [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.78, lng: -122.42 },
      ],
    };

    const calls: number[] = [];
    const requestRoute: RequestRouteFn = async (o, d, waypoints) => {
      calls.push(waypoints.length);
      if (waypoints.length === 0) {
        // Runs right alongside the freeway for most of the trip.
        return route([o, { lat: 37.77, lng: -122.4201 }, { lat: 37.78, lng: -122.4201 }, d], 1000, 300);
      }
      // Any detour attempt clears it entirely (straight line, far from it).
      return route([o, d], 1100, 320);
    };

    const result = await computeRouteOptions(requestRoute, origin, destination, [], {}, { highways: [highway] });

    expect(calls).toEqual([0, 1]); // fastest, then one highway-avoidance attempt (safest reuses the same already-clear result)
    expect(result.fastest.path).toHaveLength(4); // untouched Google route
    expect(result.balancedSafe.path).toEqual([origin, destination]);
    expect(result.safest.path).toEqual([origin, destination]);
  });

  it("nudges onto a nearby protected bike lane the route isn't already using, given extras.bikeLanes", async () => {
    const lane: BikeLaneSegment = {
      id: "lane-1",
      name: "Protected Ave",
      tier: "fullyProtected",
      path: [
        { lat: 37.771, lng: -122.421 },
        { lat: 37.775, lng: -122.421 },
        { lat: 37.779, lng: -122.421 },
      ],
    };

    const calls: number[] = [];
    const requestRoute: RequestRouteFn = async (o, d, waypoints) => {
      calls.push(waypoints.length);
      if (waypoints.length === 0) return route([o, d], 1000, 300); // doesn't touch the lane
      return route([o, ...lane.path, d], 1100, 320); // routes along it once nudged
    };

    const result = await computeRouteOptions(requestRoute, origin, destination, [], {}, { bikeLanes: [lane] });

    expect(calls).toEqual([0, 1]); // fastest, then one successful bike-lane nudge
    expect(result.fastest.bikeLanesUsed).toEqual([]);
    expect(result.balancedSafe.bikeLanesUsed).toEqual([{ name: "Protected Ave", tier: "fullyProtected" }]);
    expect(result.safest.bikeLanesUsed).toEqual([{ name: "Protected Ave", tier: "fullyProtected" }]);
  });

  it("does not nudge onto a bike lane far outside the route's corridor", async () => {
    const farLane: BikeLaneSegment = {
      id: "lane-far",
      name: "Far Trail",
      tier: "fullyProtected",
      path: [
        { lat: 38.5, lng: -123.5 },
        { lat: 38.51, lng: -123.5 },
      ],
    };
    let calls = 0;
    const requestRoute: RequestRouteFn = async (o, d) => {
      calls++;
      return route([o, d], 1000, 300);
    };

    const result = await computeRouteOptions(requestRoute, origin, destination, [], {}, { bikeLanes: [farLane] });

    expect(calls).toBe(1); // no nudge attempted - nothing within the corridor
    expect(result.balancedSafe.bikeLanesUsed).toEqual([]);
  });

  it("reports named locations avoided end-to-end, once a zone detour clears them", async () => {
    const zoneA = zone({ id: "a", center: { lat: 37.9, lng: -122.55 }, weight: 90 });
    const namedLocations: NamedDangerLocation[] = [{ name: "Dangerous Corner", center: zoneA.center }];

    const requestRoute: RequestRouteFn = async (o, d, waypoints) => {
      if (waypoints.length === 0) return route([o, zoneA.center, d], 1000, 300);
      return route([o, d], 1100, 320);
    };

    const result = await computeRouteOptions(requestRoute, ORIGIN, DESTINATION, [zoneA], {}, { namedLocations });

    expect(result.fastest.neighborhoodsAvoided).toEqual([]);
    expect(result.balancedSafe.neighborhoodsAvoided).toEqual(["Dangerous Corner"]);
    expect(result.safest.neighborhoodsAvoided).toEqual(["Dangerous Corner"]);
  });

  it("behaves exactly as before when extras are omitted entirely", async () => {
    let calls = 0;
    const requestRoute: RequestRouteFn = async (o, d) => {
      calls++;
      return route([o, d], 1000, 300);
    };
    const result = await computeRouteOptions(requestRoute, origin, destination, []);
    expect(calls).toBe(1);
    expect(result.balancedSafe).toEqual(result.fastest);
  });
});

describe("improvedRiskPercent", () => {
  it("computes the percent risk reduction relative to the fastest route", () => {
    const fastest = { riskScore: 100 } as never;
    const safer = { riskScore: 40 } as never;
    expect(improvedRiskPercent(fastest, safer)).toBe(60);
  });

  it("is 0 when the fastest route already had no risk", () => {
    const fastest = { riskScore: 0 } as never;
    const other = { riskScore: 0 } as never;
    expect(improvedRiskPercent(fastest, other)).toBe(0);
  });
});
