import { describe, expect, it } from "vitest";
import { extractRoute, isBikeableRoute, isFerryStep } from "./googleDirections";

// Minimal fakes matching just the fields these functions actually read -
// not full `google.maps.DirectionsStep`/`DirectionsRoute` objects (those
// require the Maps JS SDK to be loaded, which isn't available/needed here).
function bikeStep(overrides: Partial<google.maps.DirectionsStep> = {}): google.maps.DirectionsStep {
  return {
    travel_mode: "BICYCLING" as google.maps.TravelMode,
    maneuver: "turn-left",
    instructions: "Turn left onto Valencia St",
    ...overrides,
  } as google.maps.DirectionsStep;
}

function routeWithSteps(steps: google.maps.DirectionsStep[]): google.maps.DirectionsRoute {
  return {
    legs: [{ steps, distance: { value: 1000 }, duration: { value: 300 } }],
    overview_path: [],
  } as unknown as google.maps.DirectionsRoute;
}

function stepWithHtml(overrides: Partial<google.maps.DirectionsStep> = {}): google.maps.DirectionsStep {
  return {
    ...bikeStep(),
    distance: { value: 150 },
    duration: { value: 45 },
    ...overrides,
  } as google.maps.DirectionsStep;
}

describe("isFerryStep", () => {
  it("is false for an ordinary bicycling step", () => {
    expect(isFerryStep(bikeStep())).toBe(false);
  });

  it("catches Google's real-world shape: a BICYCLING-mode step with maneuver 'ferry'", () => {
    // Confirmed empirically against the live Directions API: a route from
    // the SF Ferry Building to Alameda comes back with travel_mode still
    // "BICYCLING" (Google treats "put your bike on the boat" as part of
    // the bicycling journey), but maneuver is literally "ferry".
    const step = bikeStep({
      maneuver: "ferry",
      instructions: "Take the Oakland &amp; Alameda ferry to Alameda",
    });
    expect(isFerryStep(step)).toBe(true);
  });

  it("catches a genuine TRANSIT-mode step as a fallback (bus/train/ferry via transit)", () => {
    const step = bikeStep({ travel_mode: "TRANSIT" as google.maps.TravelMode, maneuver: "" });
    expect(isFerryStep(step)).toBe(true);
  });

  it("catches 'ferry to <destination>' phrasing even without the maneuver field set", () => {
    const step = bikeStep({ maneuver: "", instructions: "Take the Golden Gate ferry to Larkspur" });
    expect(isFerryStep(step)).toBe(true);
  });

  it("does not false-positive on real SF places named 'Ferry' (e.g. the Ferry Building)", () => {
    // This app's own demo data has a hazard cluster right at the
    // Embarcadero/Ferry Building - a real, bikeable route through there can
    // easily produce an instruction mentioning "Ferry" without it being an
    // actual boat leg. Only the "ferry to <destination>" phrasing should
    // trip the fallback.
    const step = bikeStep({ instructions: "Turn right onto Ferry Building Marketplace" });
    expect(isFerryStep(step)).toBe(false);
  });
});

describe("isBikeableRoute", () => {
  it("is true when every step is bikeable", () => {
    const route = routeWithSteps([bikeStep(), bikeStep(), bikeStep()]);
    expect(isBikeableRoute(route)).toBe(true);
  });

  it("is false when any single step requires a ferry", () => {
    const route = routeWithSteps([bikeStep(), bikeStep({ maneuver: "ferry" }), bikeStep()]);
    expect(isBikeableRoute(route)).toBe(false);
  });

  it("is false when a ferry step is the very last one", () => {
    const route = routeWithSteps([bikeStep(), bikeStep({ maneuver: "ferry" })]);
    expect(isBikeableRoute(route)).toBe(false);
  });

  it("checks every leg, not just the first (multi-waypoint routes)", () => {
    const route = {
      legs: [
        { steps: [bikeStep()], distance: { value: 500 }, duration: { value: 100 } },
        { steps: [bikeStep({ maneuver: "ferry" })], distance: { value: 500 }, duration: { value: 100 } },
      ],
      overview_path: [],
    } as unknown as google.maps.DirectionsRoute;
    expect(isBikeableRoute(route)).toBe(false);
  });
});

describe("extractRoute", () => {
  it("sums distance/duration across every leg and maps overview_path to plain LatLngs", () => {
    const route = {
      legs: [
        { steps: [], distance: { value: 1000 }, duration: { value: 200 } },
        { steps: [], distance: { value: 500 }, duration: { value: 100 } },
      ],
      overview_path: [
        { lat: () => 37.77, lng: () => -122.42 },
        { lat: () => 37.78, lng: () => -122.41 },
      ],
    } as unknown as google.maps.DirectionsRoute;

    const result = extractRoute(route);
    expect(result.distanceMeters).toBe(1500);
    expect(result.durationSeconds).toBe(300);
    expect(result.path).toEqual([
      { lat: 37.77, lng: -122.42 },
      { lat: 37.78, lng: -122.41 },
    ]);
  });

  it("flattens turn-by-turn steps across every leg, in order", () => {
    const route = {
      legs: [
        { steps: [stepWithHtml({ instructions: "Head <b>north</b>" })], distance: { value: 0 }, duration: { value: 0 } },
        { steps: [stepWithHtml({ instructions: "Turn <b>right</b> onto Main St" })], distance: { value: 0 }, duration: { value: 0 } },
      ],
      overview_path: [],
    } as unknown as google.maps.DirectionsRoute;

    const result = extractRoute(route);
    expect(result.steps).toEqual([
      { instructions: "Head north", distanceMeters: 150, durationSeconds: 45 },
      { instructions: "Turn right onto Main St", distanceMeters: 150, durationSeconds: 45 },
    ]);
  });

  it("strips HTML tags and decodes common entities from step instructions", () => {
    const route = routeWithSteps([
      stepWithHtml({
        instructions:
          'Turn <b>left</b> onto <b>Valencia St</b><div style="font-size:0.9em">Restricted usage road</div>',
      }),
      stepWithHtml({ instructions: "Ride along Fell &amp; Oak" }),
      stepWithHtml({ instructions: "Arrive at 123 O&#39;Farrell St &quot;side entrance&quot;" }),
    ]);

    const result = extractRoute(route);
    expect(result.steps.map((s) => s.instructions)).toEqual([
      "Turn left onto Valencia St - Restricted usage road",
      "Ride along Fell & Oak",
      'Arrive at 123 O\'Farrell St "side entrance"',
    ]);
  });

  it("returns an empty steps array for a route with no steps", () => {
    const route = routeWithSteps([]);
    expect(extractRoute(route).steps).toEqual([]);
  });
});
