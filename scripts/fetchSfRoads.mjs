// One-time data-generation script: pulls real street geometry for San
// Francisco from OpenStreetMap (via the Overpass API) and writes a compact,
// pre-processed JSON file that the app loads statically at build/runtime
// (lib/data/sfRoads.json). We do NOT call Overpass from the running app -
// that would be slow, rate-limited, and a hard runtime dependency on a third
// party service just to render the map. Re-run this script manually
// (`node scripts/fetchSfRoads.mjs`) if the road list ever needs refreshing.
//
// Why OSM instead of more hand-drawn mock coordinates: OSM way geometry is
// real surveyed road-centerline data, so when Google's basemap renders the
// same real-world street, our line sits directly on top of it - which is
// what "roads are actually on the google maps road" requires. Hand-picked
// 2-4 point approximations (the old MOCK_HIGHWAY_SEGMENTS/MOCK_BIKE_LANE_
// SEGMENTS paths) are fine as scoring inputs but were never meant to be
// pixel-accurate road geometry.
//
// Scope: only "major" named roads (freeways, primary/secondary arterials,
// cycleways) within the demo city bounds, each with combined length >=
// MIN_NAMED_ROAD_LENGTH_METERS. This keeps coverage comprehensive (every
// significant real street gets a color) while keeping the total rendered
// segment count in the low hundreds instead of the thousands of tiny
// intersection-to-intersection ways OSM actually stores things as (a single
// street like Van Ness Ave is dozens of separate OSM ways - we merge those
// back into as few connected chains as possible per named road).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEMO_CITY_BOUNDS = {
  north: 37.808,
  south: 37.742,
  east: -122.388,
  west: -122.462,
};

const HIGHWAY_KIND = {
  motorway: "freeway",
  motorway_link: "freeway",
  trunk: "freeway",
  trunk_link: "freeway",
  primary: "arterial",
  primary_link: "arterial",
  secondary: "arterial",
  secondary_link: "arterial",
  cycleway: "bikeLane",
};

// Cycleways get a much lower bar than car roads: SF's named bike
// infrastructure (e.g. "The Wiggle" streets, short protected-lane stretches)
// is often only a few blocks long, and undercounting them would defeat the
// whole point of this app. Car roads use a higher bar so we don't pull in
// every minor unclassified stub, keeping the total segment count renderable.
const MIN_NAMED_ROAD_LENGTH_METERS = { freeway: 500, arterial: 500, bikeLane: 100 };
const MAX_POINTS_PER_CHAIN = 80;

function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function pathLengthMeters(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += haversineMeters(pts[i - 1], pts[i]);
  return len;
}

function pointKey(p) {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/**
 * Merges way fragments that share an endpoint into longer connected chains.
 * OSM splits every real street into many short ways (one per block, roughly),
 * so a named road like "Geary Boulevard" might arrive as 40+ separate ways;
 * this stitches consecutive ones back together wherever their endpoints
 * coincide, so we render one long polyline instead of 40 disconnected ones.
 */
function mergeIntoChains(ways) {
  let chains = ways.map((w) => w.slice());
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i];
        const b = chains[j];
        const aStart = pointKey(a[0]);
        const aEnd = pointKey(a[a.length - 1]);
        const bStart = pointKey(b[0]);
        const bEnd = pointKey(b[b.length - 1]);

        if (aEnd === bStart) {
          chains[i] = a.concat(b.slice(1));
        } else if (aEnd === bEnd) {
          chains[i] = a.concat(b.slice(0, -1).reverse());
        } else if (aStart === bEnd) {
          chains[i] = b.concat(a.slice(1));
        } else if (aStart === bStart) {
          chains[i] = b.slice().reverse().concat(a.slice(1));
        } else {
          continue;
        }
        chains.splice(j, 1);
        mergedSomething = true;
        break outer;
      }
    }
  }
  return chains;
}

function decimate(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const stride = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.round(i * stride)]);
  }
  return out;
}

async function fetchOverpass() {
  const highwayTypes = Object.keys(HIGHWAY_KIND).join("|");
  const { north, south, east, west } = DEMO_CITY_BOUNDS;
  const query = `[out:json][timeout:60];way["highway"~"^(${highwayTypes})$"]["name"](${south},${west},${north},${east});out geom;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      "User-Agent": "no-roll-models-data-fetch/1.0 (one-time dev script)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  console.log("Fetching OSM road geometry for San Francisco via Overpass API...");
  const data = await fetchOverpass();
  console.log(`Fetched ${data.elements.length} raw OSM ways.`);

  const groups = new Map();
  for (const way of data.elements) {
    const kind = HIGHWAY_KIND[way.tags?.highway];
    const name = way.tags?.name;
    if (!kind || !name || !way.geometry?.length) continue;

    const points = way.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    const key = `${name}|${kind}`;
    if (!groups.has(key)) groups.set(key, { name, kind, ways: [] });
    groups.get(key).ways.push(points);
  }

  const segments = [];
  let seq = 0;
  for (const { name, kind, ways } of groups.values()) {
    const totalLength = ways.reduce((sum, w) => sum + pathLengthMeters(w), 0);
    if (totalLength < MIN_NAMED_ROAD_LENGTH_METERS[kind]) continue;

    const chains = mergeIntoChains(ways);
    for (const chain of chains) {
      if (chain.length < 2) continue;
      seq += 1;
      segments.push({
        id: `osm-${seq}`,
        name,
        kind,
        path: decimate(chain, MAX_POINTS_PER_CHAIN),
      });
    }
  }

  segments.sort((a, b) => a.name.localeCompare(b.name));

  const totalPoints = segments.reduce((sum, s) => sum + s.path.length, 0);
  console.log(
    `Produced ${segments.length} merged road segments (${totalPoints} total points) ` +
      `across ${groups.size} named-road groups.`
  );
  const byKind = {};
  for (const s of segments) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  console.log("By kind:", byKind);

  const outPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "lib",
    "data",
    "sfRoads.json"
  );
  writeFileSync(outPath, JSON.stringify(segments, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
