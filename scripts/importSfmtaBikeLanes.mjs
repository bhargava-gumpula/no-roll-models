// One-time data-import script: converts the real San Francisco Municipal
// Transportation Agency (SFMTA) "Bike Network - Linear Features" open-data
// export (data/raw/sfmta_bike_network.csv - downloaded from SF's open data
// portal, one row per surveyed street block of bike infrastructure) into the
// compact JSON the app loads statically at runtime (lib/data/sfBikeLanes.json).
//
// This replaces the old MOCK_BIKE_LANE_SEGMENTS (9 hand-picked corridors) as
// the input to `scoreBikeInfrastructure` in lib/danger.ts: instead of a
// handful of guessed tiers, every block of SF's actual bike network - all
// ~5,450 surveyed segments - now contributes a real classification. Re-run
// this script manually (`npm run data:import-bike-lanes`) if the source CSV
// is ever refreshed.
//
// Tier mapping, from the source's own official facility classification
// (FACILITY_T) - see https://www.sfmta.com/getting-around/bike/bikeway-network
// for SFMTA's own definitions of these classes:
//   - CLASS I  (off-street bike path, own right-of-way)        -> fullyProtected
//   - CLASS IV (separated bikeway, physical barrier from BARRIER
//               column - curb/parking/posts/K-rail)            -> fullyProtected
//   - CLASS II (painted bike lane) + BUFFERED=YES               -> semiProtected
//   - CLASS II (painted bike lane), no buffer                   -> unprotected
//   - CLASS III (bike route/sharrow, no dedicated lane space)   -> none
// A tiny number of rows (2 of 5,457) have a blank FACILITY_T (malformed
// source rows with no geometry either) and are skipped.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAX_POINTS_PER_SEGMENT = 30;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseLineStringWkt(wkt) {
  if (!wkt || !wkt.startsWith("LINESTRING")) return null;
  const inner = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"));
  return inner.split(",").map((pair) => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lat, lng };
  });
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

function titleCase(raw) {
  return raw
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function tierFor(facilityType, buffered) {
  switch (facilityType) {
    case "CLASS I":
    case "CLASS IV":
      return "fullyProtected";
    case "CLASS II":
      return buffered === "YES" ? "semiProtected" : "unprotected";
    case "CLASS III":
      return "none";
    default:
      return null;
  }
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const inPath = path.join(scriptDir, "..", "data", "raw", "sfmta_bike_network.csv");
  const outPath = path.join(scriptDir, "..", "lib", "data", "sfBikeLanes.json");

  console.log(`Reading ${inPath}...`);
  const rows = parseCsv(readFileSync(inPath, "utf8"));
  const [header, ...dataRows] = rows;
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  console.log(`Parsed ${dataRows.length} CSV rows.`);

  const segments = [];
  const skipped = { noTier: 0, noGeometry: 0 };
  const tierCounts = {};

  for (const row of dataRows) {
    const facilityType = row[col.FACILITY_T];
    const tier = tierFor(facilityType, row[col.BUFFERED]);
    if (!tier) {
      skipped.noTier++;
      continue;
    }

    const path_ = parseLineStringWkt(row[col.shape]);
    if (!path_ || path_.length < 2) {
      skipped.noGeometry++;
      continue;
    }

    const streetName = row[col.STREETNAME]?.trim();
    const objectId = row[col.OBJECTID];
    segments.push({
      id: `sfmta-${objectId}`,
      name: streetName ? titleCase(streetName) : `Bikeway ${objectId}`,
      tier,
      path: decimate(path_, MAX_POINTS_PER_SEGMENT),
    });
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }

  console.log(`Produced ${segments.length} bike-lane segments.`);
  console.log("By tier:", tierCounts);
  console.log("Skipped:", skipped);

  writeFileSync(outPath, JSON.stringify(segments, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main();
