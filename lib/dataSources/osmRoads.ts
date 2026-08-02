import type { RealRoadSegment } from "../types";
import sfRoadsData from "../data/sfRoads.json";

/**
 * Real, named San Francisco street geometry sourced from OpenStreetMap
 * ((c) OpenStreetMap contributors, ODbL license), pre-fetched and merged by
 * `scripts/fetchSfRoads.mjs` into `lib/data/sfRoads.json`. This is what
 * `computeRoadNetworkSafety` scores and what the map renders, so every
 * colored line actually traces a real street rather than a hand-drawn
 * approximation - re-run the script to refresh coverage if needed.
 *
 * Scope: named freeways, primary/secondary arterials, and cycleways within
 * the demo city bounds (see DEMO_CITY in lib/mockData.ts). Ordinary
 * residential/local streets are intentionally excluded to keep the map
 * readable and the segment count in a smoothly-renderable range - see the
 * script's header comment for the exact thresholds.
 */
export const REAL_SF_ROADS: RealRoadSegment[] = sfRoadsData as RealRoadSegment[];
