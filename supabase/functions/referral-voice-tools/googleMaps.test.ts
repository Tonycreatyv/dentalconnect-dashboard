import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  createGoogleMapsClient,
  GOOGLE_GEOCODING_ENDPOINT,
  GOOGLE_ROUTE_MATRIX_ENDPOINT,
} from "./googleMaps.ts";

Deno.test("Google client uses v4 geocoding and sanitized route matrix contracts", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith(GOOGLE_GEOCODING_ENDPOINT)) {
      return Promise.resolve(Response.json({
        results: [{
          formattedAddress: "123 Main St, Atlanta, GA 30345, USA",
          location: { latitude: 33.85, longitude: -84.29 },
          rawPrivateField: "must-not-leak",
        }],
      }));
    }
    return Promise.resolve(Response.json([
      {
        originIndex: 0,
        destinationIndex: 0,
        status: {},
        condition: "ROUTE_EXISTS",
        distanceMeters: 1609.344,
        duration: "300s",
        rawPrivateField: "must-not-leak",
      },
    ]));
  };
  const client = createGoogleMapsClient("test-secret-key", fetchMock);
  const geocoded = await client.geocodeAddress("123 Main Street #4");
  assertEquals(geocoded, {
    data: {
      formattedAddress: "123 Main St, Atlanta, GA 30345, USA",
      latitude: 33.85,
      longitude: -84.29,
    },
    error: null,
    diagnostics: { httpStatus: 200, googleErrorStatus: null, googleErrorMessage: null, networkError: false },
  });
  assert(requests[0].url.includes("123%20Main%20Street%20%234"));
  assert(!requests[0].url.includes("test-secret-key"));
  assertEquals(
    new Headers(requests[0].init?.headers).get("X-Goog-Api-Key"),
    "test-secret-key",
  );

  const routes = await client.computeDrivingRouteMatrix({
    origin: { latitude: 33.85, longitude: -84.29 },
    destinationCoordinates: [{ latitude: 33.9, longitude: -84.3 }],
  });
  assertEquals(routes, {
    data: [{
      destinationIndex: 0,
      distanceMeters: 1609.344,
      durationSeconds: 300,
    }],
    error: null,
    diagnostics: { httpStatus: 200, googleErrorStatus: null, googleErrorMessage: null, networkError: false },
  });
  assertEquals(requests[1].url, GOOGLE_ROUTE_MATRIX_ENDPOINT);
  const body = JSON.parse(String(requests[1].init?.body));
  assertEquals(body.travelMode, "DRIVE");
  assertEquals(
    body.destinations[0].waypoint.location.latLng,
    { latitude: 33.9, longitude: -84.3 },
  );
  assert(!JSON.stringify(routes).includes("rawPrivateField"));
});

Deno.test("Google client rejects HTTP and route-element failures", async () => {
  const httpFailure = createGoogleMapsClient(
    "test-key",
    () => Promise.resolve(new Response("denied", { status: 403 })),
  );
  assertEquals(await httpFailure.geocodeAddress("123 Main Street"), {
    data: null,
    error: "geocoding_failed",
    // Response body is plain text ("denied"), not Google's JSON error
    // envelope, so googleErrorStatus/Message stay null - httpStatus alone
    // is still real, useful signal (403 = likely auth/permission issue).
    diagnostics: { httpStatus: 403, googleErrorStatus: null, googleErrorMessage: null, networkError: false },
  });

  const routeFailure = createGoogleMapsClient(
    "test-key",
    () =>
      Promise.resolve(Response.json([{
        originIndex: 0,
        destinationIndex: 0,
        status: { code: 5, message: "raw provider message" },
        condition: "ROUTE_NOT_FOUND",
      }])),
  );
  const result = await routeFailure.computeDrivingRouteMatrix({
    origin: { latitude: 33.85, longitude: -84.29 },
    destinationCoordinates: [{ latitude: 33.9, longitude: -84.3 }],
  });
  assertEquals(result, {
    data: null,
    error: "routes_failed",
    // The per-element rejection reason is the route's `condition` field
    // (a safe Google-defined enum value), never the raw provider
    // `status.message` text - verified below.
    diagnostics: { httpStatus: 200, googleErrorStatus: "5", googleErrorMessage: "condition:ROUTE_NOT_FOUND", networkError: false },
  });
  assert(!JSON.stringify(result).includes("raw provider message"));
});
