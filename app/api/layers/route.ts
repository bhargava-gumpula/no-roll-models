import { NextResponse } from "next/server";
import { computeCompositeDangerZones, computeRoadNetworkSafety } from "@/lib/danger";
import { REAL_SF_ROADS } from "@/lib/dataSources/osmRoads";
import {
  ALL_MOCK_CRASHES,
  DEMO_CITY,
  MOCK_BIKE_LANE_SEGMENTS,
  MOCK_HIGHWAY_SEGMENTS,
} from "@/lib/mockData";

/**
 * Serves the map-layer data for the demo city: crash records, bike-lane
 * segments, highway/arterial segments, the precomputed composite danger
 * zones (circles - kept for future route-risk scoring, not rendered on the
 * map), and `roadSegments` - the full colored *real* road network actually
 * shown on the map today (every named freeway/arterial/cycleway in the demo
 * city, not just dangerous ones - see `computeRoadNetworkSafety` in
 * lib/danger.ts). `roadSegments` geometry comes from real OpenStreetMap
 * street data (`lib/dataSources/osmRoads.ts`) so it lines up with the roads
 * Google's basemap actually draws; `crashes`/`bikeLanes`/`highways` remain
 * mock data used as scoring inputs (see lib/mockData.ts). Swapping in real
 * crash/bike-lane-tier sources (BikeMaps.org, NHTSA, city GIS layers) only
 * requires changing what populates those scoring inputs - see
 * lib/dataSources/bikemaps.ts for the adapter stub.
 *
 * Computing this on every request (rather than caching) is fine at this
 * dataset size (tens of milliseconds) - see lib/danger.test.ts for a
 * determinism check confirming repeated calls produce identical output.
 */
export async function GET() {
  const dangerZones = computeCompositeDangerZones(
    ALL_MOCK_CRASHES,
    MOCK_BIKE_LANE_SEGMENTS,
    MOCK_HIGHWAY_SEGMENTS
  );
  const roadSegments = computeRoadNetworkSafety(
    ALL_MOCK_CRASHES,
    MOCK_BIKE_LANE_SEGMENTS,
    MOCK_HIGHWAY_SEGMENTS,
    REAL_SF_ROADS
  );

  return NextResponse.json({
    city: DEMO_CITY,
    crashes: ALL_MOCK_CRASHES,
    bikeLanes: MOCK_BIKE_LANE_SEGMENTS,
    highways: MOCK_HIGHWAY_SEGMENTS,
    dangerZones,
    roadSegments,
  });
}
