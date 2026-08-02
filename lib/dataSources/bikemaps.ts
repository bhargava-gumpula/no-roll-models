import type { CrashRecord, IncidentType } from "../types";

/**
 * BikeMaps.org integration notes (as of this writing):
 *
 * - BikeMaps.org (https://bikemaps.org) is a crowdsourced cycling-safety
 *   platform run by the SPARlab research group (source: github.com/sparlab/bikemaps).
 * - It publishes crowdsourced incidents in four categories: collisions,
 *   near-misses, hazards, and thefts, exportable as GeoJSON.
 * - There is no fully public, unauthenticated "give me a bbox, get back JSON"
 *   REST endpoint documented for third-party apps. Bulk/filtered export is
 *   done either (a) through an admin account's "Export" page in the BikeMaps
 *   web app, or (b) via direct Postgres/PostGIS access, which requires
 *   contacting the BikeMaps team (see docs/query-and-export-data.md in their
 *   repo). Any real integration should start by emailing the SPARlab team to
 *   request API/data access and confirm current terms of use and attribution
 *   requirements.
 * - Because of that, this module is a typed *adapter stub*: it defines the
 *   shape we expect real BikeMaps GeoJSON to arrive in, and a converter into
 *   our internal `CrashRecord` type, so swapping the mock data source for a
 *   live one later only means implementing `fetchRaw()` below.
 *
 * Complementary sources worth wiring in alongside BikeMaps, for the other
 * two safety factors (`lib/danger.ts` combines all three into one score):
 * - Crash density: NHTSA FARS / Traffic Safety Facts (fatal crashes), plus
 *   city open-data portals (e.g. DataSF's "Traffic Crashes Resulting in
 *   Injury" dataset) for non-fatal, jurisdiction-specific crash data -
 *   both typically available as public downloads/APIs with no special
 *   access needed, unlike BikeMaps.
 * - Bike infrastructure quality: city/OSM bike-network GIS layers (e.g.
 *   OSM `cycleway` tags, or a city's official bikeway-network shapefile)
 *   would replace `MOCK_BIKE_LANE_SEGMENTS` in lib/mockData.ts.
 * - Highway/arterial exposure: OSM `highway=motorway`/`primary` tags, or a
 *   city's road-classification GIS layer, would replace
 *   `MOCK_HIGHWAY_SEGMENTS` in lib/mockData.ts.
 */

export interface BikeMapsFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
  properties: {
    id: number | string;
    date?: string;
    p_type?: IncidentType | string; // BikeMaps' "point type"
    details?: string;
    injury?: string | null;
    [key: string]: unknown;
  };
}

export interface BikeMapsFeatureCollection {
  type: "FeatureCollection";
  features: BikeMapsFeature[];
}

export interface BikeMapsBoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

function mapIncidentType(pType: string | undefined): IncidentType {
  switch (pType) {
    case "collision":
    case "nearmiss":
    case "hazard":
    case "theft":
      return pType;
    default:
      return "hazard";
  }
}

export function bikeMapsFeatureToCrashRecord(feature: BikeMapsFeature): CrashRecord {
  const [lng, lat] = feature.geometry.coordinates;
  const injury = (feature.properties.injury || "").toLowerCase();
  const severity = injury.includes("fatal") ? 3 : injury.includes("yes") ? 2 : 1;
  return {
    id: `bikemaps-${feature.properties.id}`,
    position: { lat, lng },
    type: mapIncidentType(feature.properties.p_type as string | undefined),
    severity,
    date: feature.properties.date ?? "unknown",
    description: feature.properties.details ?? "No details provided",
    source: "bikemaps",
  };
}

/**
 * Placeholder for the real fetch. Intentionally unimplemented until BikeMaps
 * API/data access is confirmed - throwing keeps misuse loud instead of
 * silently returning empty data. Swap the crash-loading call in
 * `app/api/layers/route.ts` to use this once it's ready.
 */
export async function fetchRaw(_bbox: BikeMapsBoundingBox): Promise<BikeMapsFeatureCollection> {
  throw new Error(
    "BikeMaps.org live integration not yet configured. See lib/dataSources/bikemaps.ts for setup notes; currently the app runs on lib/mockData.ts."
  );
}
