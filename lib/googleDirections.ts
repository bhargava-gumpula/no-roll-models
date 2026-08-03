import type { RawRoute, RequestRouteFn } from "./routing";
import type { LatLng, RouteStep } from "./types";

/**
 * Google's Directions API, in `BICYCLING` mode, will sometimes propose a
 * route that boards a ferry when there's no continuous bike-accessible path
 * (confirmed empirically: SF Ferry Building -> Alameda comes back with a
 * step whose `travel_mode` is still `"BICYCLING"`, but whose `maneuver` is
 * literally `"ferry"` - Google treats "put your bike on the boat" as part
 * of a bicycling journey, not a separate transit leg). This app is about
 * biking, not ferries, so any step matching this is disqualifying. Checked
 * three ways for robustness, since `maneuver` values are explicitly
 * documented as "subject to change": the `maneuver` field, a genuine
 * `TRANSIT` step (covers ferries embedded as an actual transit leg instead,
 * plus buses/trains for good measure - none of those are bikeable either),
 * and a text fallback on the turn-by-turn instructions.
 */
export function isFerryStep(step: google.maps.DirectionsStep): boolean {
  // Compared as a plain string (not `google.maps.TravelMode.TRANSIT`) so
  // this function - and its unit tests - have no dependency on the Google
  // Maps JS SDK actually being loaded (its enums are only real objects once
  // the script tag has executed in a browser).
  if ((step.travel_mode as string) === "TRANSIT") return true;
  if (step.maneuver === "ferry") return true;
  // Deliberately narrow (not a bare `/ferry/i`): this app's own demo data
  // has a real hazard cluster right at the Embarcadero/Ferry Building, so a
  // legitimately bikeable route can easily have an instruction like "Turn
  // right onto Ferry Building Marketplace" - a bare "ferry" match would
  // wrongly reject that whole route. Google's actual "board a boat" phrasing
  // is consistently "Take the <line> ferry to <destination>", so anchor on
  // "ferry to" instead.
  return /\bferry\s+to\b/i.test(step.instructions ?? "");
}

export function isBikeableRoute(route: google.maps.DirectionsRoute): boolean {
  return route.legs.every((leg) => leg.steps.every((step) => !isFerryStep(step)));
}

// Google's step instructions arrive as small HTML fragments (e.g. `Turn
// <b>right</b> onto <b>Valencia St</b>`, sometimes with a
// `<div style="font-size:0.9em">Restricted usage road</div>` sub-line) -
// this app just needs plain, readable text for the turn-by-turn panel.
function stripInstructionsHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, " - ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractSteps(route: google.maps.DirectionsRoute): RouteStep[] {
  return route.legs.flatMap((leg) =>
    leg.steps.map((step) => ({
      instructions: stripInstructionsHtml(step.instructions ?? ""),
      distanceMeters: step.distance?.value ?? 0,
      durationSeconds: step.duration?.value ?? 0,
    }))
  );
}

/**
 * Pulls a flat path + total distance/duration + turn-by-turn steps out of a
 * single Google `DirectionsRoute`, summing distance/duration across every
 * leg (there's one leg per waypoint segment) so multi-waypoint "safer"
 * routes report their full trip, not just the first leg's.
 */
export function extractRoute(route: google.maps.DirectionsRoute): RawRoute {
  const path: LatLng[] = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
  const distanceMeters = route.legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
  const durationSeconds = route.legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
  const steps = extractSteps(route);

  return { path, distanceMeters, durationSeconds, steps };
}

/**
 * Builds a `RequestRouteFn` (see lib/routing.ts) backed by the real Google
 * Maps JavaScript SDK's `DirectionsService`, requesting bicycling
 * directions. This is the only place in the app that talks to the
 * Directions API - kept separate from `lib/routing.ts` so the
 * detour-planning logic itself has no dependency on the Maps SDK being
 * loaded and can be unit tested with a fake router instead.
 *
 * Requests route alternatives and picks the first fully-bikeable one
 * (Google returns alternatives ordered by its own preference, so this
 * preserves that ordering rather than second-guessing it) - see
 * `isFerryStep` above for why. If every alternative Google offers requires
 * a ferry (a real possibility for origin/destination pairs separated by
 * open water with no bike-accessible bridge), this rejects with a clear
 * error rather than silently handing back a route the user can't actually
 * ride.
 */
export function createGoogleDirectionsRouter(service: google.maps.DirectionsService): RequestRouteFn {
  return (origin, destination, waypoints) =>
    new Promise<RawRoute>((resolve, reject) => {
      service.route(
        {
          origin,
          destination,
          waypoints: waypoints.map((location) => ({ location, stopover: false })),
          travelMode: google.maps.TravelMode.BICYCLING,
          provideRouteAlternatives: true,
        },
        (result, status) => {
          if (status !== google.maps.DirectionsStatus.OK || !result) {
            reject(new Error(`Directions request failed: ${status}`));
            return;
          }
          const bikeableRoute = result.routes.find(isBikeableRoute);
          if (!bikeableRoute) {
            reject(
              new Error(
                "Google has no all-bicycle route between these points (every option requires a ferry)."
              )
            );
            return;
          }
          resolve(extractRoute(bikeableRoute));
        }
      );
    });
}
