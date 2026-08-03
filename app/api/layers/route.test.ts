import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/layers", () => {
  it("returns city info, crashes, highways, and danger zones", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.city.name).toBe("San Francisco, CA");
    expect(Array.isArray(body.crashes)).toBe(true);
    expect(body.crashes.length).toBeGreaterThan(0);
    // The real ~5,450-segment SFMTA bike-lane dataset is a scoring input
    // only (see route.ts) and deliberately not shipped in full - but a much
    // smaller filtered (fully/semi-protected only) `bikeLanes` subset is,
    // for client-side bike-lane-aware routing/reporting.
    expect(Array.isArray(body.bikeLanes)).toBe(true);
    expect(body.bikeLanes.length).toBeGreaterThan(0);
    expect(body.bikeLanes.length).toBeLessThan(2000);
    for (const lane of body.bikeLanes) {
      expect(["fullyProtected", "semiProtected"]).toContain(lane.tier);
    }
    expect(Array.isArray(body.namedDangerLocations)).toBe(true);
    expect(body.namedDangerLocations.length).toBe(15);
    expect(body.namedDangerLocations[0]).toHaveProperty("name");
    expect(body.namedDangerLocations[0]).toHaveProperty("center");
    expect(Array.isArray(body.highways)).toBe(true);
    expect(body.highways.length).toBeGreaterThan(0);
    expect(Array.isArray(body.dangerZones)).toBe(true);
    expect(body.dangerZones.length).toBeGreaterThan(0);
    expect(body.dangerZones[0]).toHaveProperty("factorScores");
    expect(Array.isArray(body.roadSegments)).toBe(true);
    // Real OSM-sourced road network (freeways/arterials/cycleways), not just
    // our original handful of curated corridors - see lib/danger.test.ts for
    // the exact-count assertion against REAL_SF_ROADS.
    expect(body.roadSegments.length).toBeGreaterThan(100);
    expect(body.roadSegments[0]).toHaveProperty("path");
    expect(body.roadSegments[0]).toHaveProperty("score");
    expect(body.roadSegments[0]).toHaveProperty("kind");
    expect(body.roadSegments[0]).toHaveProperty("name");
  });
});
