import { describe, expect, it } from "vitest";
import {
  ALL_MOCK_CRASHES,
  DEMO_CITY,
  MOCK_BIKE_LANE_SEGMENTS,
  MOCK_HIGHWAY_SEGMENTS,
} from "./mockData";

describe("ALL_MOCK_CRASHES", () => {
  it("has a stable, expected count (seeded RNG determinism)", () => {
    expect(ALL_MOCK_CRASHES.length).toBe(128);
  });

  it("has unique ids", () => {
    const ids = new Set(ALL_MOCK_CRASHES.map((c) => c.id));
    expect(ids.size).toBe(ALL_MOCK_CRASHES.length);
  });

  it("has valid severities and known incident types", () => {
    const validTypes = new Set(["collision", "nearmiss", "hazard", "theft"]);
    for (const crash of ALL_MOCK_CRASHES) {
      expect([1, 2, 3]).toContain(crash.severity);
      expect(validTypes.has(crash.type)).toBe(true);
      expect(crash.source).toBe("mock");
    }
  });

  it("places crashes roughly within/near the demo city bounds", () => {
    // Background crashes are drawn directly from the bounds, and hazard
    // cluster crashes are jittered a few hundred meters from in-bounds
    // centers, so allow a small margin rather than an exact bounds check.
    const margin = 0.01;
    for (const crash of ALL_MOCK_CRASHES) {
      expect(crash.position.lat).toBeGreaterThan(DEMO_CITY.bounds.south - margin);
      expect(crash.position.lat).toBeLessThan(DEMO_CITY.bounds.north + margin);
      expect(crash.position.lng).toBeGreaterThan(DEMO_CITY.bounds.west - margin);
      expect(crash.position.lng).toBeLessThan(DEMO_CITY.bounds.east + margin);
    }
  });
});

describe("MOCK_BIKE_LANE_SEGMENTS", () => {
  const validTiers = new Set(["fullyProtected", "semiProtected", "unprotected", "none"]);

  it("has at least one segment per tier used in the design", () => {
    const tiers = new Set(MOCK_BIKE_LANE_SEGMENTS.map((s) => s.tier));
    expect(tiers.has("fullyProtected")).toBe(true);
    expect(tiers.has("semiProtected")).toBe(true);
    expect(tiers.has("unprotected")).toBe(true);
  });

  it("every segment has a valid tier and at least 2 path points", () => {
    for (const seg of MOCK_BIKE_LANE_SEGMENTS) {
      expect(validTiers.has(seg.tier)).toBe(true);
      expect(seg.path.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("MOCK_HIGHWAY_SEGMENTS", () => {
  it("includes the three major SF freeways", () => {
    const ids = MOCK_HIGHWAY_SEGMENTS.map((s) => s.id);
    expect(ids).toContain("hwy-101");
    expect(ids).toContain("hwy-280");
    expect(ids).toContain("hwy-80");
  });

  it("every segment has a valid type and at least 2 path points", () => {
    for (const seg of MOCK_HIGHWAY_SEGMENTS) {
      expect(["freeway", "arterial"]).toContain(seg.type);
      expect(seg.path.length).toBeGreaterThanOrEqual(2);
      expect(seg.typicalSpeedMph).toBeGreaterThan(0);
    }
  });
});
