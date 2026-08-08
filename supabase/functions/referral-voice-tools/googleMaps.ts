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

export type GoogleMapsClient = {
  geocodeAddress: (address: string) => Promise<{
    data: GeocodedAddress | null;
    error: string | null;
  }>;
  computeDrivingRouteMatrix: (input: {
    origin: RouteCoordinate;
    destinationCoordinates: RouteCoordinate[];
  }) => Promise<{
    data: DrivingRoute[] | null;
    error: string | null;
  }>;
};

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
        if (!response.ok) return { data: null, error: "geocoding_failed" };
        const payload = await response.json() as Record<string, unknown>;
        const results = Array.isArray(payload.results) ? payload.results : [];
        const first = results[0] as Record<string, unknown> | undefined;
        if (!first) return { data: null, error: null };
        const location = first.location as Record<string, unknown> | undefined;
        const formattedAddress = typeof first.formattedAddress === "string"
          ? first.formattedAddress.trim()
          : "";
        const latitude = finiteNumber(location?.latitude);
        const longitude = finiteNumber(location?.longitude);
        if (!formattedAddress || latitude === null || longitude === null) {
          return { data: null, error: null };
        }
        return {
          data: { formattedAddress, latitude, longitude },
          error: null,
        };
      } catch {
        return { data: null, error: "geocoding_failed" };
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
        if (!response.ok) return { data: null, error: "routes_failed" };
        const payload = await response.json() as unknown;
        if (!Array.isArray(payload)) {
          return { data: null, error: "routes_failed" };
        }
        const routes: DrivingRoute[] = [];
        for (const value of payload) {
          if (!value || typeof value !== "object") {
            return { data: null, error: "routes_failed" };
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
            return { data: null, error: "routes_failed" };
          }
          routes.push({
            destinationIndex,
            distanceMeters,
            durationSeconds: seconds,
          });
        }
        return { data: routes, error: null };
      } catch {
        return { data: null, error: "routes_failed" };
      }
    },
  };
}
