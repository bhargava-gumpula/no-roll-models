import type { CrashRecord, HighwaySegment, IncidentType, NamedDangerLocation, Severity } from "./types";

/**
 * Demo dataset centered on San Francisco. This is synthetic data shaped like
 * what BikeMaps.org / NHTSA / city open-data portals and city bike-network
 * GIS layers return, so the rest of the app (danger scoring, routing, UI)
 * can be built and demoed without needing live API credentials or data
 * access agreements. See `lib/dataSources/bikemaps.ts` for how crash data
 * gets swapped for a real source later.
 */
export const DEMO_CITY = {
  name: "San Francisco, CA",
  center: { lat: 37.7749, lng: -122.4194 },
  // South/east were widened from the original Phase-0 box (37.742/-122.388)
  // to reach Bayview (3rd St) and Sunnydale/Visitacion Valley, needed once
  // KNOWN_DANGEROUS_LOCATIONS below added real hotspots down there - the
  // danger-zone grid only ever samples inside these bounds, so a hotspot
  // outside them would silently never surface no matter how much crash data
  // it has.
  bounds: {
    north: 37.808,
    south: 37.705,
    east: -122.383,
    west: -122.462,
  },
};

// Deterministic PRNG so the demo dataset is stable across reloads/builds.
function mulberry32(seed: number) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20240611);

function jitter(base: { lat: number; lng: number }, spreadMeters: number) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((base.lat * Math.PI) / 180);
  const dLat = ((rand() - 0.5) * 2 * spreadMeters) / metersPerDegLat;
  const dLng = ((rand() - 0.5) * 2 * spreadMeters) / metersPerDegLng;
  return { lat: base.lat + dLat, lng: base.lng + dLng };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------------------------------------------------------------------------
// Crash / incident data
// ---------------------------------------------------------------------------

// Real-world-inspired corridors/intersections with known cycling risk factors
// (high traffic, missing bike lanes, freeway on/off-ramps). Coordinates are
// approximate and used only to shape a realistic-looking demo dataset.
const HAZARD_CLUSTERS: {
  name: string;
  center: { lat: number; lng: number };
  points: number;
  spreadMeters: number;
  severityBias: number; // 0-1, higher = more severe crashes in this cluster
}[] = [
  { name: "Market & Octavia", center: { lat: 37.7746, lng: -122.4243 }, points: 14, spreadMeters: 220, severityBias: 0.7 },
  { name: "South Van Ness & Mission", center: { lat: 37.7674, lng: -122.4194 }, points: 12, spreadMeters: 250, severityBias: 0.6 },
  { name: "Folsom St corridor (SoMa)", center: { lat: 37.7799, lng: -122.4013 }, points: 16, spreadMeters: 350, severityBias: 0.55 },
  { name: "Van Ness Ave", center: { lat: 37.7834, lng: -122.4213 }, points: 13, spreadMeters: 400, severityBias: 0.65 },
  { name: "The Wiggle (Fell/Oak)", center: { lat: 37.7726, lng: -122.4384 }, points: 10, spreadMeters: 200, severityBias: 0.3 },
  { name: "Embarcadero / Ferry Building", center: { lat: 37.7955, lng: -122.3937 }, points: 8, spreadMeters: 250, severityBias: 0.3 },
  { name: "Masonic Ave", center: { lat: 37.7735, lng: -122.4468 }, points: 9, spreadMeters: 250, severityBias: 0.5 },
  { name: "Potrero Ave near freeway ramps", center: { lat: 37.7669, lng: -122.4066 }, points: 11, spreadMeters: 300, severityBias: 0.75 },
  { name: "Geary Blvd", center: { lat: 37.7827, lng: -122.4438 }, points: 9, spreadMeters: 350, severityBias: 0.5 },
  { name: "Golden Gate Park panhandle", center: { lat: 37.7719, lng: -122.4459 }, points: 6, spreadMeters: 180, severityBias: 0.15 },
];

// Specific, user-provided list of San Francisco locations with known real
// cycling/pedestrian safety concerns (mostly high-pedestrian-volume
// Tenderloin/SoMa/Mission/Bayview corridors and BART plazas) - distinct from
// HAZARD_CLUSTERS above, which is this app's own invented demo shaping.
// These are fed through the exact same synthetic-crash-generation pipeline
// (so they surface via the normal composite danger-zone/road-scoring math,
// same threshold and clustering rules as everywhere else - see
// COMPOSITE_THRESHOLD in lib/danger.ts) rather than being hardcoded as
// always-shown zones, so they naturally combine with (and are ranked
// alongside) any other genuinely risky area the model finds. Coordinates are
// approximate street/intersection locations, not surveyed - acceptable for
// this demo's synthetic scoring model (see the "not for real navigation
// decisions" disclaimer in the UI).
// spreadMeters is deliberately kept well under CRASH_SEARCH_RADIUS_METERS
// (260, see lib/danger.ts) for every entry here: `jitter()` scatters points
// uniformly up to `spreadMeters` in *each* of lat/lng independently, so the
// true max distance from center is spreadMeters*sqrt(2) - a spread much
// above ~180 starts pushing a meaningful fraction of points outside the
// search radius entirely (zero contribution), silently diluting exactly the
// locations this list means to flag as dangerous.
const KNOWN_DANGEROUS_LOCATIONS: {
  name: string;
  center: { lat: number; lng: number };
  points: number;
  spreadMeters: number;
  severityBias: number;
}[] = [
  { name: "Turk & Taylor / Turk & Hyde (Tenderloin core)", center: { lat: 37.7834, lng: -122.4142 }, points: 15, spreadMeters: 170, severityBias: 0.82 },
  { name: "Eddy & Jones (Tenderloin)", center: { lat: 37.7846, lng: -122.414 }, points: 14, spreadMeters: 150, severityBias: 0.8 },
  { name: "Golden Gate Ave between Jones and Leavenworth", center: { lat: 37.7813, lng: -122.4147 }, points: 14, spreadMeters: 160, severityBias: 0.78 },
  { name: "6th St between Market and Howard (SoMa)", center: { lat: 37.7815, lng: -122.4096 }, points: 15, spreadMeters: 180, severityBias: 0.8 },
  { name: "16th St & Mission (BART plaza)", center: { lat: 37.7648, lng: -122.4198 }, points: 15, spreadMeters: 160, severityBias: 0.82 },
  { name: "24th St & Mission", center: { lat: 37.7523, lng: -122.4183 }, points: 15, spreadMeters: 160, severityBias: 0.82 },
  { name: "Civic Center Plaza / UN Plaza", center: { lat: 37.7799, lng: -122.4156 }, points: 15, spreadMeters: 180, severityBias: 0.8 },
  { name: "3rd St between Palou and Oakdale (Bayview)", center: { lat: 37.737, lng: -122.3891 }, points: 15, spreadMeters: 170, severityBias: 0.82 },
  { name: "Jones & Ellis (Tenderloin)", center: { lat: 37.7857, lng: -122.414 }, points: 14, spreadMeters: 150, severityBias: 0.8 },
  { name: "Leavenworth & O'Farrell", center: { lat: 37.7869, lng: -122.4153 }, points: 14, spreadMeters: 150, severityBias: 0.78 },
  { name: "Hyde & McAllister", center: { lat: 37.7809, lng: -122.4167 }, points: 14, spreadMeters: 150, severityBias: 0.78 },
  { name: "Mid-Market, Market St between 5th and 8th", center: { lat: 37.7807, lng: -122.4113 }, points: 15, spreadMeters: 180, severityBias: 0.8 },
  { name: "Harrison St underpass near 4th/5th (SoMa)", center: { lat: 37.7797, lng: -122.4013 }, points: 14, spreadMeters: 170, severityBias: 0.78 },
  { name: "Sunnydale/Visitacion Valley near Blythdale Ave", center: { lat: 37.7135, lng: -122.4079 }, points: 15, spreadMeters: 170, severityBias: 0.82 },
  { name: "Bayview, Third St between Palou and Fitzgerald", center: { lat: 37.731, lng: -122.3895 }, points: 17, spreadMeters: 160, severityBias: 0.85 },
];

/**
 * Name + location only (no synthetic-crash-generation params) - the public,
 * lightweight view of `KNOWN_DANGEROUS_LOCATIONS` used to report *which*
 * named area a route avoided (see `summarizeNeighborhoodsAvoided` in
 * `lib/routing.ts`), rather than just an opaque `zone-N` id.
 */
export const NAMED_DANGEROUS_LOCATIONS: NamedDangerLocation[] = KNOWN_DANGEROUS_LOCATIONS.map((loc) => ({
  name: loc.name,
  center: loc.center,
}));

const INCIDENT_TYPES: IncidentType[] = ["collision", "nearmiss", "hazard", "theft"];
const INCIDENT_WEIGHTS = [0.45, 0.3, 0.2, 0.05]; // rough distribution

function weightedIncidentType(): IncidentType {
  const r = rand();
  let acc = 0;
  for (let i = 0; i < INCIDENT_TYPES.length; i++) {
    acc += INCIDENT_WEIGHTS[i];
    if (r <= acc) return INCIDENT_TYPES[i];
  }
  return "collision";
}

function severityFor(type: IncidentType, bias: number): Severity {
  if (type === "hazard" || type === "theft") return 1;
  const r = rand();
  const skewed = r * (0.5 + bias);
  if (skewed > 0.75) return 3;
  if (skewed > 0.4) return 2;
  return 1;
}

const DESCRIPTIONS: Record<IncidentType, string[]> = {
  collision: [
    "Right-hook collision with turning vehicle",
    "Struck by vehicle door (dooring)",
    "Rear-ended while stopped at signal",
    "Collision at unprotected intersection",
    "Sideswiped while riding in shared lane",
  ],
  nearmiss: [
    "Vehicle merged into bike lane without signaling",
    "Close pass at high speed",
    "Vehicle ran red light, cyclist braked hard",
    "Pedestrian stepped into bike lane unexpectedly",
  ],
  hazard: [
    "Large pothole in bike lane",
    "Faded/missing bike lane markings",
    "Debris and glass in bike lane",
    "Storm drain grate parallel to travel direction",
  ],
  theft: ["Bike stolen while locked at rack", "Attempted theft, lock damaged"],
};

let crashSeq = 0;
function buildCrash(base: { lat: number; lng: number }, spreadMeters: number, severityBias: number): CrashRecord {
  crashSeq += 1;
  const type = weightedIncidentType();
  const severity = severityFor(type, severityBias);
  const daysAgo = Math.floor(rand() * 365 * 3);
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `mock-${crashSeq}`,
    position: jitter(base, spreadMeters),
    type,
    severity,
    date,
    description: pick(DESCRIPTIONS[type]),
    source: "mock",
  };
}

export const MOCK_CRASHES: CrashRecord[] = [...HAZARD_CLUSTERS, ...KNOWN_DANGEROUS_LOCATIONS].flatMap(
  (cluster) =>
    Array.from({ length: cluster.points }, () =>
      buildCrash(cluster.center, cluster.spreadMeters, cluster.severityBias)
    )
);

// A handful of scattered low-density background incidents so the whole city
// isn't perfectly clean outside the hazard clusters.
export const MOCK_BACKGROUND_CRASHES: CrashRecord[] = Array.from({ length: 20 }, () => {
  const lat = DEMO_CITY.bounds.south + rand() * (DEMO_CITY.bounds.north - DEMO_CITY.bounds.south);
  const lng = DEMO_CITY.bounds.west + rand() * (DEMO_CITY.bounds.east - DEMO_CITY.bounds.west);
  return buildCrash({ lat, lng }, 50, 0.2);
});

export const ALL_MOCK_CRASHES: CrashRecord[] = [...MOCK_CRASHES, ...MOCK_BACKGROUND_CRASHES];

// ---------------------------------------------------------------------------
// Freeways and dangerous arterials (mocked line segments; a real integration
// would pull these from OSM `highway=motorway` / `highway=primary` tags)
//
// Bike-lane infrastructure is no longer mocked here - see
// `lib/dataSources/sfmtaBikeLanes.ts` for the real SFMTA bike-network data
// that replaced it.
// ---------------------------------------------------------------------------

export const MOCK_HIGHWAY_SEGMENTS: HighwaySegment[] = [
  {
    id: "hwy-101",
    name: "US-101 (Van Ness Ave / Central Freeway)",
    type: "freeway",
    typicalSpeedMph: 55,
    path: [
      { lat: 37.8020, lng: -122.4360 },
      { lat: 37.7920, lng: -122.4245 },
      { lat: 37.7834, lng: -122.4213 },
      { lat: 37.7699, lng: -122.4194 },
      { lat: 37.7480, lng: -122.4050 },
      { lat: 37.7295, lng: -122.3959 },
    ],
  },
  {
    id: "hwy-280",
    name: "I-280",
    type: "freeway",
    typicalSpeedMph: 55,
    path: [
      { lat: 37.7786, lng: -122.3931 },
      { lat: 37.7620, lng: -122.3990 },
      { lat: 37.7440, lng: -122.4130 },
      { lat: 37.7260, lng: -122.4300 },
    ],
  },
  {
    id: "hwy-80",
    name: "I-80 (Bay Bridge approach)",
    type: "freeway",
    typicalSpeedMph: 50,
    path: [
      { lat: 37.7955, lng: -122.3937 },
      { lat: 37.7860, lng: -122.3970 },
      { lat: 37.7799, lng: -122.4013 },
      { lat: 37.7746, lng: -122.4130 },
    ],
  },
  {
    id: "arterial-van-ness",
    name: "Van Ness Ave (Civic Center)",
    type: "arterial",
    typicalSpeedMph: 35,
    path: [
      { lat: 37.7870, lng: -122.4213 },
      { lat: 37.7800, lng: -122.4213 },
      { lat: 37.7746, lng: -122.4213 },
    ],
  },
  {
    id: "arterial-geary",
    name: "Geary Blvd",
    type: "arterial",
    typicalSpeedMph: 40,
    path: [
      { lat: 37.7827, lng: -122.4620 },
      { lat: 37.7827, lng: -122.4438 },
      { lat: 37.7827, lng: -122.4210 },
    ],
  },
  {
    id: "arterial-potrero",
    name: "Potrero Ave",
    type: "arterial",
    typicalSpeedMph: 35,
    path: [
      { lat: 37.7720, lng: -122.4066 },
      { lat: 37.7669, lng: -122.4066 },
      { lat: 37.7590, lng: -122.4060 },
    ],
  },
  {
    id: "arterial-masonic",
    name: "Masonic Ave",
    type: "arterial",
    typicalSpeedMph: 35,
    path: [
      { lat: 37.7827, lng: -122.4468 },
      { lat: 37.7735, lng: -122.4468 },
      { lat: 37.7660, lng: -122.4468 },
    ],
  },
];
