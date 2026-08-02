import { describe, expect, it } from "vitest";
import {
  assessRouteRisk,
  computeCompositeDangerZones,
  computeRoadNetworkSafety,
  suggestAvoidanceWaypoint,
} from "./danger";
import { haversineMeters } from "./geo";
import { REAL_SF_ROADS } from "./dataSources/osmRoads";
import { ALL_MOCK_CRASHES, DEMO_CITY, MOCK_BIKE_LANE_SEGMENTS, MOCK_HIGHWAY_SEGMENTS } from "./mockData";
import type { DangerZone } from "./types";

const zones = computeCompositeDangerZones(ALL_MOCK_CRASHES, MOCK_BIKE_LANE_SEGMENTS, MOCK_HIGHWAY_SEGMENTS);
const roadSegments = computeRoadNetworkSafety(
  ALL_MOCK_CRASHES,
  MOCK_BIKE_LANE_SEGMENTS,
  MOCK_HIGHWAY_SEGMENTS,
  REAL_SF_ROADS
);

describe("computeCompositeDangerZones", () => {
  it("only emits zones for genuinely risky clusters, not the whole city", () => {
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.length).toBeLessThan(100);
  });

  it("never includes a safe (below-threshold) zone - no green circles", () => {
    for (const zone of zones) {
      expect(zone.weight).toBeGreaterThanOrEqual(64);
    }
  });

  it("produces varying circle sizes (extent + severity based), not one fixed size for every zone", () => {
    const radii = new Set(zones.map((z) => z.radiusMeters));
    expect(radii.size).toBeGreaterThan(1);
  });

  it("keeps radii within the configured min/max bounds", () => {
    for (const zone of zones) {
      expect(zone.radiusMeters).toBeGreaterThanOrEqual(90);
      expect(zone.radiusMeters).toBeLessThanOrEqual(380);
    }
  });

  it("every zone has factor scores in [0, 100]", () => {
    for (const zone of zones) {
      expect(zone.factorScores.crashDensity).toBeGreaterThanOrEqual(0);
      expect(zone.factorScores.crashDensity).toBeLessThanOrEqual(100);
      expect(zone.factorScores.bikeInfrastructure).toBeGreaterThanOrEqual(0);
      expect(zone.factorScores.bikeInfrastructure).toBeLessThanOrEqual(100);
      expect(zone.factorScores.highwayExposure).toBeGreaterThanOrEqual(0);
      expect(zone.factorScores.highwayExposure).toBeLessThanOrEqual(100);
    }
  });

  it("every zone center falls within the demo city bounds", () => {
    for (const zone of zones) {
      expect(zone.center.lat).toBeGreaterThanOrEqual(DEMO_CITY.bounds.south);
      expect(zone.center.lat).toBeLessThanOrEqual(DEMO_CITY.bounds.north);
      expect(zone.center.lng).toBeGreaterThanOrEqual(DEMO_CITY.bounds.west);
      expect(zone.center.lng).toBeLessThanOrEqual(DEMO_CITY.bounds.east);
    }
  });

  it("returns zones sorted from most to least dangerous", () => {
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].weight).toBeLessThanOrEqual(zones[i - 1].weight);
    }
  });

  it("is deterministic given the same inputs", () => {
    const again = computeCompositeDangerZones(ALL_MOCK_CRASHES, MOCK_BIKE_LANE_SEGMENTS, MOCK_HIGHWAY_SEGMENTS);
    expect(again).toEqual(zones);
  });
});

describe("computeRoadNetworkSafety", () => {
  it("covers every real named road (freeways, arterials, cycleways from OSM)", () => {
    expect(roadSegments.length).toBe(REAL_SF_ROADS.length);
    // Comprehensive real-street coverage, not just our handful of curated
    // corridors - this is what makes "every road has a color" true.
    expect(roadSegments.length).toBeGreaterThan(100);
  });

  it("includes a real spread of safe and dangerous roads", () => {
    const scores = roadSegments.map((s) => s.score);
    expect(Math.min(...scores)).toBeLessThan(20);
    expect(Math.max(...scores)).toBeGreaterThan(50);
  });

  it("every real road is present, tagged with its real kind, using real (multi-point) OSM geometry", () => {
    for (const road of REAL_SF_ROADS) {
      const found = roadSegments.find((r) => r.id === road.id);
      expect(found).toBeDefined();
      expect(found?.kind).toBe(road.kind);
      expect(found?.name).toBe(road.name);
      expect(found?.path).toEqual(road.path);
    }
  });

  it("known named corridors from the old curated list are still present under their real geometry", () => {
    // Spot-check a few streets our original hand-curated MOCK_BIKE_LANE_SEGMENTS
    // / MOCK_HIGHWAY_SEGMENTS also modeled, confirming the swap to real OSM
    // geometry didn't drop the roads this app has always cared about.
    const names = roadSegments.map((s) => s.name);
    expect(names).toContain("Valencia Street Bikeway");
    expect(names).toContain("Van Ness Avenue");
    expect(names.some((n) => n?.startsWith("Geary"))).toBe(true);
  });

  it("real cycleways never score the full 'no bike lane' infrastructure risk", () => {
    for (const segment of roadSegments.filter((s) => s.kind === "bikeLane")) {
      expect(segment.factorScores.bikeInfrastructure).toBeLessThanOrEqual(65);
    }
  });

  it("real freeways always carry a meaningful highway-exposure floor", () => {
    for (const segment of roadSegments.filter((s) => s.kind === "freeway")) {
      expect(segment.factorScores.highwayExposure).toBeGreaterThanOrEqual(85);
    }
  });

  it("every segment has a path with at least 2 points, roughly within the demo city area", () => {
    // Real OSM ways run slightly past DEMO_CITY.bounds at their ends (the
    // Overpass query includes any way with at least one node inside the
    // bbox), so this allows some slack rather than requiring an exact
    // bounding box.
    for (const segment of roadSegments) {
      expect(segment.path.length).toBeGreaterThanOrEqual(2);
      for (const point of segment.path) {
        expect(point.lat).toBeGreaterThanOrEqual(DEMO_CITY.bounds.south - 0.03);
        expect(point.lat).toBeLessThanOrEqual(DEMO_CITY.bounds.north + 0.03);
        expect(point.lng).toBeGreaterThanOrEqual(DEMO_CITY.bounds.west - 0.03);
        expect(point.lng).toBeLessThanOrEqual(DEMO_CITY.bounds.east + 0.03);
      }
    }
  });

  it("every segment has factor scores in [0, 100]", () => {
    for (const segment of roadSegments) {
      expect(segment.factorScores.crashDensity).toBeGreaterThanOrEqual(0);
      expect(segment.factorScores.crashDensity).toBeLessThanOrEqual(100);
      expect(segment.factorScores.bikeInfrastructure).toBeGreaterThanOrEqual(0);
      expect(segment.factorScores.bikeInfrastructure).toBeLessThanOrEqual(100);
      expect(segment.factorScores.highwayExposure).toBeGreaterThanOrEqual(0);
      expect(segment.factorScores.highwayExposure).toBeLessThanOrEqual(100);
    }
  });

  it("returns segments sorted from most to least dangerous", () => {
    for (let i = 1; i < roadSegments.length; i++) {
      expect(roadSegments[i].score).toBeLessThanOrEqual(roadSegments[i - 1].score);
    }
  });

  it("is deterministic given the same inputs", () => {
    const again = computeRoadNetworkSafety(
      ALL_MOCK_CRASHES,
      MOCK_BIKE_LANE_SEGMENTS,
      MOCK_HIGHWAY_SEGMENTS,
      REAL_SF_ROADS
    );
    expect(again).toEqual(roadSegments);
  });
});

describe("assessRouteRisk", () => {
  it("scores a route through the worst zone's center as risky and crossing it", () => {
    const worst = zones[0];
    const path = [
      { lat: worst.center.lat - 0.01, lng: worst.center.lng - 0.01 },
      worst.center,
      { lat: worst.center.lat + 0.01, lng: worst.center.lng + 0.01 },
    ];
    const result = assessRouteRisk(path, zones);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.zonesCrossed.some((z) => z.id === worst.id)).toBe(true);
  });

  it("scores a route far from every zone as zero risk", () => {
    // The middle of the Pacific, nowhere near San Francisco's danger zones.
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0.01, lng: 0.01 },
    ];
    const result = assessRouteRisk(path, zones);
    expect(result.riskScore).toBe(0);
    expect(result.zonesCrossed).toHaveLength(0);
  });
});

describe("suggestAvoidanceWaypoint", () => {
  it("suggests a point clear of the zone's radius", () => {
    const zone: DangerZone = zones[0];
    const path = [
      { lat: zone.center.lat - 0.005, lng: zone.center.lng },
      zone.center,
      { lat: zone.center.lat + 0.005, lng: zone.center.lng },
    ];
    const waypoint = suggestAvoidanceWaypoint(zone, path);
    const distFromCenter = haversineMeters(waypoint, zone.center);
    expect(distFromCenter).toBeGreaterThan(zone.radiusMeters);
  });
});
