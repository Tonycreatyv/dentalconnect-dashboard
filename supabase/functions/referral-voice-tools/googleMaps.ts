export const GOOGLE_GEOCODING_ENDPOINT =
  "https://geocode.googleapis.com/v4/geocode/address";
export const GOOGLE_ROUTE_MATRIX_ENDPOINT =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

const GOOGLE_TIMEOUT_MS = 8_000;

export type GeocodedAddress = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

export type DrivingRoute = {
  destinationIndex: number;
  distanceMeters: number;
  durationSeconds: number;
};

export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

// Sanitized diagnostic detail attached to a failed call - never includes
// the API key (never read from the response body in the first place) or
// any customer PII. httpStatus/googleErrorStatus/googleErrorMessage come
// directly from Google's own response when present, so a caller can tell
// "not enabled for this API" (PERMISSION_DENIED) apart from "billing not
// enabled" (billingNotEnabled reason) apart from a quota/rate-limit error
// apart from a genuine network failure, without ever guessing.
export type GoogleMapsCallDiagnostics = {
  httpStatus: number | null;
  googleErrorStatus: string | null;
  googleErrorMessage: string | null;
  networkError: boolean;
};

export type GoogleMapsClient = {
  geocodeAddress: (address: string) => Promise<{
    data: GeocodedAddress | null;
    error: string | null;
    // Optional: the real client (createGoogleMapsClient below) always
    // populates this; kept optional on the type so existing mocks/fakes in
    // other callers' tests (referral-voice-tools) don't all need updating
    // just to satisfy a new diagnostic-only field they don't exercise.
    diagnostics?: GoogleMapsCallDiagnostics;
  }>;
  computeDrivingRouteMatrix: (input: {
    origin: RouteCoordinate;
    destinationCoordinates: RouteCoordinate[];
  }) => Promise<{
    data: DrivingRoute[] | null;
    error: string | null;
    diagnostics?: GoogleMapsCallDiagnostics;
  }>;
};

const NO_DIAGNOSTICS: GoogleMapsCallDiagnostics = {
  httpStatus: null,
  googleErrorStatus: null,
  googleErrorMessage: null,
  networkError: false,
};

// Google's standard error envelope for a non-2xx response is
// { error: { code, message, status } } - extracting this is safe because
// it never contains the request's API key or any customer data, only
// Google's own description of why the request was rejected.
async function readGoogleErrorDiagnostics(response: Response): Promise<GoogleMapsCallDiagnostics> {
  let googleErrorStatus: string | null = null;
  let googleErrorMessage: string | null = null;
  try {
    const body = await response.clone().json() as { error?: { status?: unknown; message?: unknown } };
    googleErrorStatus = typeof body?.error?.status === "string" ? body.error.status : null;
    googleErrorMessage = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : null;
  } catch {
    // Response body wasn't JSON or was unreadable - httpStatus alone is
    // still useful diagnostic signal, so this is not itself a failure.
  }
  return { httpStatus: response.status, googleErrorStatus, googleErrorMessage, networkError: false };
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function timedFetch(
  fetchImpl: Fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

export function createGoogleMapsClient(
  apiKey: string,
  fetchImpl: Fetch = fetch,
): GoogleMapsClient {
  const headers = {
    "X-Goog-Api-Key": apiKey,
  };

  return {
    async geocodeAddress(address) {
      try {
        const response = await timedFetch(
          fetchImpl,
          `${GOOGLE_GEOCODING_ENDPOINT}/${
            encodeURIComponent(address)
          }?regionCode=US`,
          {
            method: "GET",
            headers: {
              ...headers,
              "X-Goog-FieldMask": "results.formattedAddress,results.location",
            },
          },
        );
        if (!response.ok) {
          return { data: null, error: "geocoding_failed", diagnostics: await readGoogleErrorDiagnostics(response) };
        }
        const payload = await response.json() as Record<string, unknown>;
        const results = Array.isArray(payload.results) ? payload.results : [];
        const first = results[0] as Record<string, unknown> | undefined;
        if (!first) return { data: null, error: null, diagnostics: { ...NO_DIAGNOSTICS, httpStatus: response.status } };
        const location = first.location as Record<string, unknown> | undefined;
        const formattedAddress = typeof first.formattedAddress === "string"
          ? first.formattedAddress.trim()
          : "";
        const latitude = finiteNumber(location?.latitude);
        const longitude = finiteNumber(location?.longitude);
        if (!formattedAddress || latitude === null || longitude === null) {
          return { data: null, error: null, diagnostics: { ...NO_DIAGNOSTICS, httpStatus: response.status } };
        }
        return {
          data: { formattedAddress, latitude, longitude },
          error: null,
          diagnostics: { ...NO_DIAGNOSTICS, httpStatus: response.status },
        };
      } catch (err) {
        return {
          data: null,
          error: "geocoding_failed",
          diagnostics: { ...NO_DIAGNOSTICS, networkError: true, googleErrorMessage: err instanceof Error ? err.name : null },
        };
      }
    },

    async computeDrivingRouteMatrix(input) {
      try {
        const response = await timedFetch(
          fetchImpl,
          GOOGLE_ROUTE_MATRIX_ENDPOINT,
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
              "X-Goog-FieldMask":
                "originIndex,destinationIndex,status,condition,distanceMeters,duration",
            },
            body: JSON.stringify({
              origins: [{
                waypoint: {
                  location: { latLng: input.origin },
                },
              }],
              destinations: input.destinationCoordinates.map((latLng) => ({
                waypoint: {
                  location: { latLng },
                },
              })),
              travelMode: "DRIVE",
            }),
          },
        );
        if (!response.ok) {
          return { data: null, error: "routes_failed", diagnostics: await readGoogleErrorDiagnostics(response) };
        }
        const payload = await response.json() as unknown;
        const baseDiagnostics: GoogleMapsCallDiagnostics = { ...NO_DIAGNOSTICS, httpStatus: response.status };
        if (!Array.isArray(payload)) {
          return { data: null, error: "routes_failed", diagnostics: { ...baseDiagnostics, googleErrorMessage: "non_array_response" } };
        }
        const routes: DrivingRoute[] = [];
        for (const value of payload) {
          if (!value || typeof value !== "object") {
            return { data: null, error: "routes_failed", diagnostics: { ...baseDiagnostics, googleErrorMessage: "non_object_element" } };
          }
          const element = value as Record<string, unknown>;
          const status = element.status as Record<string, unknown> | undefined;
          const statusCode = status?.code === undefined
            ? 0
            : finiteNumber(status.code);
          const destinationIndex = finiteNumber(element.destinationIndex);
          const distanceMeters = finiteNumber(element.distanceMeters);
          const seconds = durationSeconds(element.duration);
          if (
            statusCode !== 0 || element.condition !== "ROUTE_EXISTS" ||
            destinationIndex === null || !Number.isInteger(destinationIndex) ||
            distanceMeters === null || distanceMeters < 0 || seconds === null ||
            seconds < 0
          ) {
            return {
              data: null,
              error: "routes_failed",
              diagnostics: {
                ...baseDiagnostics,
                googleErrorStatus: typeof status?.code === "number" ? String(status.code) : null,
                googleErrorMessage: typeof element.condition === "string" ? `condition:${element.condition}` : "element_rejected",
              },
            };
          }
          routes.push({
            destinationIndex,
            distanceMeters,
            durationSeconds: seconds,
          });
        }
        return { data: routes, error: null, diagnostics: baseDiagnostics };
      } catch (err) {
        return {
          data: null,
          error: "routes_failed",
          diagnostics: { ...NO_DIAGNOSTICS, networkError: true, googleErrorMessage: err instanceof Error ? err.name : null },
        };
      }
    },
  };
}
