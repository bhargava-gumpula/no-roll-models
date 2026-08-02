import { describe, expect, it } from "vitest";
import { distanceToPathMeters, hasBacktrackingLoop, haversineMeters } from "./geo";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    const p = { lat: 37.7749, lng: -122.4194 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 3);
  });

  it("is symmetric", () => {
    const a = { lat: 37.7749, lng: -122.4194 };
    const b = { lat: 37.8, lng: -122.41 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("matches the known ~111.32km per degree of latitude", () => {
    const a = { lat: 37.0, lng: -122.0 };
    const b = { lat: 38.0, lng: -122.0 };
    expect(haversineMeters(a, b)).toBeCloseTo(111_320, -3); // within ~1km
  });
});

describe("distanceToPathMeters", () => {
  it("returns Infinity for an empty path", () => {
    expect(distanceToPathMeters({ lat: 37.77, lng: -122.42 }, [])).toBe(Infinity);
  });

  it("falls back to point distance for a single-point path", () => {
    const point = { lat: 37.77, lng: -122.42 };
    const path = [{ lat: 37.78, lng: -122.43 }];
    expect(distanceToPathMeters(point, path)).toBeCloseTo(haversineMeters(point, path[0]), 3);
  });

  it("is ~0 for a point sitting exactly on a segment", () => {
    const path = [
      { lat: 37.77, lng: -122.42 },
      { lat: 37.78, lng: -122.42 },
    ];
    const midpoint = { lat: 37.775, lng: -122.42 };
    expect(distanceToPathMeters(midpoint, path)).toBeLessThan(1);
  });

  it("finds the closer of two segments", () => {
    const path = [
      { lat: 37.77, lng: -122.42 },
      { lat: 37.78, lng: -122.42 },
      { lat: 37.78, lng: -122.40 },
    ];
    // Sits right on the second segment, far from the first.
    const point = { lat: 37.78, lng: -122.41 };
    expect(distanceToPathMeters(point, path)).toBeLessThan(5);
  });
});

describe("hasBacktrackingLoop", () => {
  it("is false for a straight line", () => {
    const path = [
      { lat: 37.77, lng: -122.42 },
      { lat: 37.771, lng: -122.42 },
      { lat: 37.772, lng: -122.42 },
      { lat: 37.773, lng: -122.42 },
    ];
    expect(hasBacktrackingLoop(path)).toBe(false);
  });

  it("is false for a normal street-grid detour (90-degree turns)", () => {
    const path = [
      { lat: 37.77, lng: -122.42 }, // start
      { lat: 37.77, lng: -122.4188 }, // east ~106m
      { lat: 37.771, lng: -122.4188 }, // north ~111m
      { lat: 37.771, lng: -122.4176 }, // east ~106m
      { lat: 37.772, lng: -122.4176 }, // north ~111m
    ];
    expect(hasBacktrackingLoop(path)).toBe(false);
  });

  it("is false for a short jog under the minimum segment length", () => {
    const path = [
      { lat: 37.77, lng: -122.42 },
      { lat: 37.7701, lng: -122.42 }, // ~11m north (below threshold)
      { lat: 37.7701, lng: -122.4201 }, // ~9m west (below threshold)
      { lat: 37.772, lng: -122.4201 }, // ~211m north
    ];
    expect(hasBacktrackingLoop(path)).toBe(false);
  });

  it("is true for a there-and-back spur (near-180-degree reversal)", () => {
    const path = [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.7758, lng: -122.4194 }, // north ~100m
      { lat: 37.775, lng: -122.4194 }, // back south, near the start
    ];
    expect(hasBacktrackingLoop(path)).toBe(true);
  });
});
