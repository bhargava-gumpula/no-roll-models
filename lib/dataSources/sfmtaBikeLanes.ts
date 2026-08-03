import type { BikeLaneSegment } from "../types";
import sfBikeLanesData from "../data/sfBikeLanes.json";

/**
 * Real San Francisco bike infrastructure from SFMTA's official "Bike
 * Network - Linear Features" open-data export (see
 * `scripts/importSfmtaBikeLanes.mjs` / `data/raw/sfmta_bike_network.csv`) -
 * ~5,450 surveyed street-block segments, each classified into one of our
 * four bike-lane tiers from SFMTA's own facility-type + buffer columns.
 * Replaces the old hand-picked `MOCK_BIKE_LANE_SEGMENTS` (9 corridors) as
 * the scoring input to `scoreBikeInfrastructure` in lib/danger.ts.
 */
export const REAL_SF_BIKE_LANES: BikeLaneSegment[] = sfBikeLanesData as BikeLaneSegment[];
