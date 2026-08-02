# No Roll Models — Safer Bike Routing

A web app that scores San Francisco streets on three safety factors (crash
history, bike lane quality, highway/arterial exposure), visualizes them as
color-coded danger zones on a map, and computes a safer alternative bike
route that avoids the worst of them - instead of just the fastest route like
typical navigation apps.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the whole project fits
together, the data model, and a running build log.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up a Google Maps API key

Copy the example env file:

```bash
cp .env.local.example .env.local
```

Then fill in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with a key from the
[Google Cloud Console](https://console.cloud.google.com/google/maps-apis).
You need to enable these APIs on that project: **Maps JavaScript API**,
**Places API**, **Geocoding API**, and **Directions API**. See the comments
in `.env.local.example` for details.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Running tests

```bash
npm test
```

Runs the Vitest unit test suite (`lib/**/*.test.ts`).

## Project status

This project is being built in phases - see `ARCHITECTURE.md`'s build log
for what currently exists. Crash/bike-lane/highway data is currently mock
data shaped to resemble real BikeMaps.org/NHTSA records; see
`lib/dataSources/bikemaps.ts` for notes on wiring up real data later.
