"use client";

import { GoogleMap, Marker, Polyline } from "@react-google-maps/api";
import { useMemo } from "react";
import type { DangerFactorScores, LatLng, MapLayerId, RoadKind, RoadSafetySegment } from "@/lib/types";

interface MapViewProps {
  center: LatLng;
  isLoaded: boolean;
  roadSegments: RoadSafetySegment[];
  activeLayer: MapLayerId;
  selectedSegmentId: string | null;
  onSegmentClick?: (segment: RoadSafetySegment) => void;
  origin?: LatLng | null;
  destination?: LatLng | null;
  /** Google's default bike route, for comparison against `saferRoutePath`. */
  fastestRoutePath?: LatLng[] | null;
  /** Our danger-zone-avoiding route - drawn on top of `fastestRoutePath`. */
  saferRoutePath?: LatLng[] | null;
}

const containerStyle = { width: "100%", height: "100%" };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: false,
  clickableIcons: false,
  streetViewControl: false,
  mapTypeControl: false,
  styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }],
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Green -> yellow -> red gradient for a 0-100 "danger" score. Every road is
 * rendered now (not just flagged danger spots), so the full range matters -
 * a quiet, fully-protected bikeway should actually look green.
 */
function dangerColor(score: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100;
  const r = t < 0.5 ? lerp(34, 234, t * 2) : 234;
  const g = t < 0.5 ? 197 : lerp(179, 68, (t - 0.5) * 2);
  const b = t < 0.5 ? 94 : 40;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Line thickness by real road classification ("the size of the road"),
 * independent of its safety score - a freeway is drawn as a wide road
 * whether it scores safe or dangerous, same as a real map would.
 */
const ROAD_WIDTH_BY_KIND: Record<RoadKind, number> = {
  freeway: 9,
  arterial: 6,
  bikeLane: 4,
};

function scoreForLayer(factorScores: DangerFactorScores, overall: number, layer: MapLayerId): number {
  switch (layer) {
    case "neighborhoodSafety":
      return factorScores.crashDensity;
    case "bikeInfrastructure":
      return factorScores.bikeInfrastructure;
    case "highwayExposure":
      return factorScores.highwayExposure;
    case "overallSafety":
    default:
      return overall;
  }
}

export default function MapView({
  center,
  isLoaded,
  roadSegments,
  activeLayer,
  selectedSegmentId,
  onSegmentClick,
  origin,
  destination,
  fastestRoutePath,
  saferRoutePath,
}: MapViewProps) {
  const lines = useMemo(
    () =>
      roadSegments.map((segment) => ({
        segment,
        score: scoreForLayer(segment.factorScores, segment.score, activeLayer),
      })),
    [roadSegments, activeLayer]
  );

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500">
        Loading map…
      </div>
    );
  }

  return (
    <GoogleMap mapContainerStyle={containerStyle} center={center} zoom={13} options={mapOptions}>
      {lines.map(({ segment, score }) => {
        const isSelected = segment.id === selectedSegmentId;
        const baseWidth = ROAD_WIDTH_BY_KIND[segment.kind];
        return (
          <Polyline
            key={segment.id}
            path={segment.path}
            onClick={() => onSegmentClick?.(segment)}
            options={{
              strokeColor: isSelected ? "#1d4ed8" : dangerColor(score),
              strokeOpacity: 0.9,
              strokeWeight: isSelected ? baseWidth + 3 : baseWidth,
              clickable: true,
              zIndex: isSelected ? 20 : ROAD_WIDTH_BY_KIND[segment.kind],
            }}
          />
        );
      })}

      {fastestRoutePath && fastestRoutePath.length > 1 && (
        <Polyline
          path={fastestRoutePath}
          options={{
            strokeColor: "#64748b",
            strokeOpacity: 0.9,
            strokeWeight: 5,
            zIndex: 30,
            icons: [
              {
                icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
                offset: "0",
                repeat: "14px",
              },
            ],
          }}
        />
      )}

      {saferRoutePath && saferRoutePath.length > 1 && (
        <Polyline
          path={saferRoutePath}
          options={{
            strokeColor: "#1d4ed8",
            strokeOpacity: 0.95,
            strokeWeight: 5,
            zIndex: 31,
          }}
        />
      )}

      {origin && <Marker position={origin} label={{ text: "A", color: "white" }} />}
      {destination && <Marker position={destination} label={{ text: "B", color: "white" }} />}
    </GoogleMap>
  );
}
