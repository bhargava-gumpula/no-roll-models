import { describe, expect, it } from "vitest";
import { REAL_SF_BIKE_LANES } from "./sfmtaBikeLanes";

describe("REAL_SF_BIKE_LANES", () => {
  const validTiers = new Set(["fullyProtected", "semiProtected", "unprotected", "none"]);

  it("loads the full real SFMTA bike-network dataset", () => {
    // Sanity floor well below the ~5,450 segments actually produced by
    // scripts/importSfmtaBikeLanes.mjs - guards against the JSON accidentally
    // being empty/truncated without hardcoding the exact source-data count.
    expect(REAL_SF_BIKE_LANES.length).toBeGreaterThan(1000);
  });

  it("has at least one segment per tier", () => {
    const tiers = new Set(REAL_SF_BIKE_LANES.map((s) => s.tier));
    expect(tiers.has("fullyProtected")).toBe(true);
    expect(tiers.has("semiProtected")).toBe(true);
    expect(tiers.has("unprotected")).toBe(true);
    expect(tiers.has("none")).toBe(true);
  });

  it("every segment has a valid tier, a name, and at least 2 real path points", () => {
    for (const seg of REAL_SF_BIKE_LANES) {
      expect(validTiers.has(seg.tier)).toBe(true);
      expect(typeof seg.name).toBe("string");
      expect(seg.name.length).toBeGreaterThan(0);
      expect(seg.path.length).toBeGreaterThanOrEqual(2);
      for (const point of seg.path) {
        expect(Number.isFinite(point.lat)).toBe(true);
        expect(Number.isFinite(point.lng)).toBe(true);
      }
    }
  });

  it("has unique ids", () => {
    const ids = new Set(REAL_SF_BIKE_LANES.map((s) => s.id));
    expect(ids.size).toBe(REAL_SF_BIKE_LANES.length);
  });

  it("known real SF bikeways are present under their real classification", () => {
    // Valencia St is one of SF's flagship protected (Class IV) bikeways;
    // spot-checking it confirms the CSV->tier mapping actually ran correctly
    // end to end, not just that *some* data loaded.
    const valencia = REAL_SF_BIKE_LANES.filter((s) => s.name.toLowerCase().includes("valencia"));
    expect(valencia.length).toBeGreaterThan(0);
    expect(valencia.some((s) => s.tier === "fullyProtected")).toBe(true);
  });

  it("sits roughly within the San Francisco peninsula", () => {
    for (const seg of REAL_SF_BIKE_LANES) {
      for (const point of seg.path) {
        expect(point.lat).toBeGreaterThan(37.6);
        expect(point.lat).toBeLessThan(37.9);
        expect(point.lng).toBeGreaterThan(-122.6);
        expect(point.lng).toBeLessThan(-122.3);
      }
    }
  });
});
