import { describe, expect, it } from "vitest";
import { bikeMapsFeatureToCrashRecord, fetchRaw, type BikeMapsFeature } from "./bikemaps";

function feature(overrides: Partial<BikeMapsFeature["properties"]> = {}): BikeMapsFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-122.42, 37.77] },
    properties: {
      id: 42,
      date: "2024-01-01",
      p_type: "collision",
      details: "Test incident",
      injury: null,
      ...overrides,
    },
  };
}

describe("bikeMapsFeatureToCrashRecord", () => {
  it("converts coordinates from [lng, lat] to {lat, lng}", () => {
    const record = bikeMapsFeatureToCrashRecord(feature());
    expect(record.position).toEqual({ lat: 37.77, lng: -122.42 });
  });

  it("prefixes the id and tags the source as bikemaps", () => {
    const record = bikeMapsFeatureToCrashRecord(feature({ id: 7 }));
    expect(record.id).toBe("bikemaps-7");
    expect(record.source).toBe("bikemaps");
  });

  it("maps injury text to severity", () => {
    expect(bikeMapsFeatureToCrashRecord(feature({ injury: "Fatal" })).severity).toBe(3);
    expect(bikeMapsFeatureToCrashRecord(feature({ injury: "Yes" })).severity).toBe(2);
    expect(bikeMapsFeatureToCrashRecord(feature({ injury: null })).severity).toBe(1);
  });

  it("falls back to 'hazard' for unrecognized point types", () => {
    const record = bikeMapsFeatureToCrashRecord(feature({ p_type: "something-unexpected" }));
    expect(record.type).toBe("hazard");
  });
});

describe("fetchRaw", () => {
  it("throws, since live BikeMaps integration isn't configured yet", async () => {
    await expect(fetchRaw({ north: 1, south: 0, east: 1, west: 0 })).rejects.toThrow(
      /not yet configured/
    );
  });
});
