import { NextResponse } from "next/server";
import { computeCompositeDangerZones, computeRoadNetworkSafety } from "@/lib/danger";
import { REAL_SF_BIKE_LANES } from "@/lib/dataSources/sfmtaBikeLanes";
import { REAL_SF_ROADS } from "@/lib/dataSources/osmRoads";
import { ALL_MOCK_CRASHES, DEMO_CITY, MOCK_HIGHWAY_SEGMENTS, NAMED_DANGEROUS_LOCATIONS } from "@/lib/mockData";

// Only the tiers worth actively routing toward/reporting on client-side
// (see lib/routing.ts's "favor the routes with a bike lane" detour pass and
// `summarizeBikeLanesUsed`) - filtering out `unprotected`/`none` cuts this
// from ~5,450 segments (~2MB) down to ~1,250 (~370KB), small enough to ship
// to the browser unlike the full dataset (see the comment below).
const ROUTABLE_BIKE_LANES = REAL_SF_BIKE_LANES.filter(
  (lane) => lane.tier === "fullyProtected" || lane.tier === "semiProtected"
);

/**
 * Serves the map-layer data for the demo city: crash records,
 * highway/arterial segments, the precomputed composite danger zones
 * (circles - kept for future route-risk scoring, not rendered on the map),
 * and `roadSegments` - the full colored *real* road network actually shown
 * on the map today (every named freeway/arterial/cycleway in the demo city,
 * not just dangerous ones - see `computeRoadNetworkSafety` in
 * lib/danger.ts). `roadSegments` geometry comes from real OpenStreetMap
 * street data (`lib/dataSources/osmRoads.ts`) so it lines up with the roads
 * Google's basemap actually draws; scoring is fed by real SFMTA bike-network
 * data (`lib/dataSources/sfmtaBikeLanes.ts`, ~5,450 surveyed segments) for
 * bike-infrastructure quality. `crashes`/`highways` remain mock data for
 * now - swapping those in only requires changing what populates those
 * scoring inputs - see lib/dataSources/bikemaps.ts for the adapter stub.
 *
 * The *full* ~5,450-segment bike-lane dataset is not included - it's used
 * server-side as a scoring input (and never rendered directly; `roadSegments`
 * is what's drawn), so shipping all of it on every page load would be ~2MB
 * of mostly-dead weight. `bikeLanes` below is a much smaller (~1,250
 * segment) filtered subset - fully/semi-protected lanes only - that IS worth
 * sending: `lib/routing.ts`'s detour logic uses it client-side to nudge
 * safer routes onto real protected bike lanes ("favor the routes with a
 * bike lane") and to report which named lanes a route actually used.
 * `namedDangerLocations` is the small (15-entry) name+location view of the
 * specific known-dangerous areas baked into the danger model (see
 * `KNOWN_DANGEROUS_LOCATIONS` in lib/mockData.ts), used to report which of
 * them a route avoided by name rather than an opaque zone id.
 *
 * Computing this on every request (rather than caching) is fine at this
 * dataset size (still comfortably under a second even with the much larger
 * real bike-lane dataset) - see lib/danger.test.ts for a determinism check
 * confirming repeated calls produce identical output.
 */
export async function GET() {
  const dangerZones = computeCompositeDangerZones(
    ALL_MOCK_CRASHES,
    REAL_SF_BIKE_LANES,
    MOCK_HIGHWAY_SEGMENTS
  );
  const roadSegments = computeRoadNetworkSafety(
    ALL_MOCK_CRASHES,
    REAL_SF_BIKE_LANES,
    MOCK_HIGHWAY_SEGMENTS,
    REAL_SF_ROADS
  );

  return NextResponse.json({
    city: DEMO_CITY,
    crashes: ALL_MOCK_CRASHES,
    highways: MOCK_HIGHWAY_SEGMENTS,
    dangerZones,
    roadSegments,
    bikeLanes: ROUTABLE_BIKE_LANES,
    namedDangerLocations: NAMED_DANGEROUS_LOCATIONS,
  });
}
