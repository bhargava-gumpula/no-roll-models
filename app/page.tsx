"use client";

import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { useEffect, useRef, useState } from "react";
import MapView from "@/components/MapView";
import { createGoogleDirectionsRouter } from "@/lib/googleDirections";
import { computeRouteComparison } from "@/lib/routing";
import type { DangerZone, LatLng, MapLayerId, RoadSafetySegment, RouteComparison } from "@/lib/types";

const LIBRARIES: "places"[] = ["places"];

// Matches DEMO_CITY.bounds in lib/mockData.ts - biases (not restricts, since
// strictBounds is off) the address autocomplete toward San Francisco.
const SF_BOUNDS: google.maps.LatLngBoundsLiteral = {
  north: 37.808,
  south: 37.742,
  east: -122.388,
  west: -122.462,
};

const LAYER_OPTIONS: { id: MapLayerId; label: string }[] = [
  { id: "overallSafety", label: "Overall safety" },
  { id: "neighborhoodSafety", label: "Neighborhood safety (crash density)" },
  { id: "bikeInfrastructure", label: "Bike trail quality" },
  { id: "highwayExposure", label: "Highway / arterial exposure" },
];

interface LayersResponse {
  city: { name: string; center: { lat: number; lng: number } };
  roadSegments: RoadSafetySegment[];
  dangerZones: DangerZone[];
}

function metersToMiles(m: number): string {
  return (m / 1609.34).toFixed(1);
}

function secondsToMinutes(s: number): string {
  return Math.round(s / 60).toString();
}

export default function Home() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey ?? "",
    libraries: LIBRARIES,
  });

  const [data, setData] = useState<LayersResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<MapLayerId>("overallSafety");
  const [selectedSegment, setSelectedSegment] = useState<RoadSafetySegment | null>(null);

  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [routeComparison, setRouteComparison] = useState<RouteComparison | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);

  const originAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const destinationAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  useEffect(() => {
    fetch("/api/layers")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((json: LayersResponse) => setData(json))
      .catch((err) => setFetchError(err instanceof Error ? err.message : "Failed to load map data"));
  }, []);

  function placeToLatLng(place: google.maps.places.PlaceResult | undefined): LatLng | null {
    const location = place?.geometry?.location;
    return location ? { lat: location.lat(), lng: location.lng() } : null;
  }

  async function handleFindRoute() {
    if (!origin || !destination || !data) return;
    setRoutingLoading(true);
    setRoutingError(null);
    setRouteComparison(null);
    try {
      if (!directionsServiceRef.current) {
        directionsServiceRef.current = new google.maps.DirectionsService();
      }
      const requestRoute = createGoogleDirectionsRouter(directionsServiceRef.current);
      const comparison = await computeRouteComparison(requestRoute, origin, destination, data.dangerZones);
      setRouteComparison(comparison);
    } catch (err) {
      setRoutingError(err instanceof Error ? err.message : "Failed to compute a route");
    } finally {
      setRoutingLoading(false);
    }
  }

  if (!apiKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-100 p-8 text-center text-slate-600">
        <p className="max-w-md">
          Missing <code className="rounded bg-slate-200 px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>.
          Add it to <code className="rounded bg-slate-200 px-1">.env.local</code> and restart the dev
          server.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-red-50 p-8 text-center text-red-700">
        Failed to load Google Maps: {loadError.message}
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-80 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-200 bg-white p-4">
        <div>
          <h1 className="text-lg font-bold text-black">🚲 Safe Route</h1>
          <p className="mt-1 text-xs text-black">{data?.city.name ?? "Loading city…"}</p>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black">
            Plan a route
          </h2>
          {isLoaded && (
            <>
              <Autocomplete
                onLoad={(ac) => (originAutocompleteRef.current = ac)}
                onPlaceChanged={() =>
                  setOrigin(placeToLatLng(originAutocompleteRef.current?.getPlace()))
                }
                bounds={SF_BOUNDS}
                options={{ strictBounds: false }}
              >
                <input
                  type="text"
                  placeholder="Start address (A)"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-black"
                />
              </Autocomplete>
              <Autocomplete
                onLoad={(ac) => (destinationAutocompleteRef.current = ac)}
                onPlaceChanged={() =>
                  setDestination(placeToLatLng(destinationAutocompleteRef.current?.getPlace()))
                }
                bounds={SF_BOUNDS}
                options={{ strictBounds: false }}
              >
                <input
                  type="text"
                  placeholder="Destination address (B)"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-black"
                />
              </Autocomplete>
            </>
          )}
          <button
            type="button"
            onClick={handleFindRoute}
            disabled={!origin || !destination || !data || routingLoading}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {routingLoading ? "Finding safer route…" : "Find safer route"}
          </button>
          {routingError && <p className="text-xs text-black">{routingError}</p>}
        </section>

        {routeComparison && (
          <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-black">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-black">
              Route comparison
            </h2>
            <div className="grid grid-cols-3 items-center gap-x-2 gap-y-1 text-xs">
              <span></span>
              <span className="font-semibold text-black">Fastest</span>
              <span className="font-semibold text-black">Safer</span>

              <span className="text-black">Distance</span>
              <span>{metersToMiles(routeComparison.fastest.distanceMeters)} mi</span>
              <span>{metersToMiles(routeComparison.safest.distanceMeters)} mi</span>

              <span className="text-black">Time</span>
              <span>{secondsToMinutes(routeComparison.fastest.durationSeconds)} min</span>
              <span>{secondsToMinutes(routeComparison.safest.durationSeconds)} min</span>

              <span className="text-black">Risk score</span>
              <span>{routeComparison.fastest.riskScore}</span>
              <span>{routeComparison.safest.riskScore}</span>

              <span className="text-black">Zones crossed</span>
              <span>{routeComparison.fastest.zonesCrossed.length}</span>
              <span>{routeComparison.safest.zonesCrossed.length}</span>
            </div>
            <p className="text-xs font-medium text-black">
              {routeComparison.improvedRiskPercent > 0
                ? `${routeComparison.improvedRiskPercent}% less danger-zone risk than Google's fastest route.`
                : "Google's fastest route was already clear of danger zones."}
            </p>
            <div className="flex gap-3 text-[11px] text-black">
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 bg-slate-500"></span> Fastest
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 bg-blue-700"></span> Safer
              </span>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black">
            Danger layer
          </h2>
          {LAYER_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm text-black hover:bg-slate-50"
            >
              <input
                type="radio"
                name="layer"
                checked={activeLayer === opt.id}
                onChange={() => setActiveLayer(opt.id)}
              />
              {opt.label}
            </label>
          ))}
        </section>

        {fetchError && <p className="text-xs text-black">{fetchError}</p>}
        {!data && !fetchError && <p className="text-xs text-black">Loading road network…</p>}

        {selectedSegment && (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-black">
            <h2 className="text-sm font-semibold text-black">{selectedSegment.name}</h2>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-black">
              {selectedSegment.kind}
            </p>
            <dl className="grid grid-cols-2 gap-y-1 text-xs text-black">
              <dt>Overall score</dt>
              <dd className="text-right font-medium">{selectedSegment.score}</dd>
              <dt>Crash density</dt>
              <dd className="text-right font-medium">{selectedSegment.factorScores.crashDensity}</dd>
              <dt>Bike infrastructure risk</dt>
              <dd className="text-right font-medium">
                {selectedSegment.factorScores.bikeInfrastructure}
              </dd>
              <dt>Highway exposure</dt>
              <dd className="text-right font-medium">
                {selectedSegment.factorScores.highwayExposure}
              </dd>
            </dl>
          </section>
        )}

        <p className="mt-auto text-[11px] leading-snug text-black">
          Road geometry is real San Francisco street data from{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            © OpenStreetMap contributors
          </a>
          . Crash/infrastructure scores are synthetic demo data shaped to resemble real records.
          Not for real navigation decisions.
        </p>
      </aside>

      <main className="flex-1">
        <MapView
          center={data?.city.center ?? { lat: 37.7749, lng: -122.4194 }}
          isLoaded={isLoaded}
          roadSegments={data?.roadSegments ?? []}
          activeLayer={activeLayer}
          selectedSegmentId={selectedSegment?.id ?? null}
          onSegmentClick={setSelectedSegment}
          origin={origin}
          destination={destination}
          fastestRoutePath={routeComparison?.fastest.path}
          saferRoutePath={routeComparison?.safest.path}
        />
      </main>
    </div>
  );
}
