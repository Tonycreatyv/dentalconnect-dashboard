export type MetaEmbeddedSignupResult = {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  completion: MetaEmbeddedSignupCompletion;
};

export type MetaEmbeddedSignupCompletion = {
  eventName: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
  onboardingMode: "STANDARD" | "COEXISTENCE";
  sessionInfoVersion: string;
  businessAppCoexistenceCompleted: boolean;
};

export type MetaEmbeddedSignupEventResult =
  | "finish"
  | "cancel"
  | "error"
  | "invalid_finish"
  | "ignored";

function boundedText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 &&
      value.trim().length <= max
    ? value.trim()
    : "";
}

export function createMetaEmbeddedSignupAttempt(
  onReady: (result: MetaEmbeddedSignupResult) => void,
  options: { sessionInfoVersion?: string } = {},
) {
  let code = "";
  let wabaId = "";
  let phoneNumberId = "";
  let completion: MetaEmbeddedSignupCompletion | null = null;
  let closed = false;
  const sessionInfoVersion = boundedText(options.sessionInfoVersion, 20) || "3";

  const flush = () => {
    // phoneNumberId may legitimately be "" here for a validated
    // FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING completion; per-event-type
    // requirements are already enforced in acceptEvent before wabaId/
    // completion are set, so no additional phoneNumberId check belongs here.
    if (closed || !code || !wabaId || !completion) return;
    closed = true;
    onReady({ code, wabaId, phoneNumberId, completion });
    code = "";
    wabaId = "";
    phoneNumberId = "";
    completion = null;
  };

  return {
    acceptCode(value: unknown) {
      if (closed) return false;
      const nextCode = boundedText(value, 2_000);
      if (!nextCode) return false;
      code = nextCode;
      flush();
      return true;
    },
    acceptEvent(value: unknown): MetaEmbeddedSignupEventResult {
      if (closed || !value || typeof value !== "object") return "ignored";
      const event = value as {
        type?: unknown;
        event?: unknown;
        data?: { waba_id?: unknown; phone_number_id?: unknown };
      };
      if (event.type !== "WA_EMBEDDED_SIGNUP") return "ignored";
      if (event.event === "CANCEL") {
        closed = true;
        code = "";
        return "cancel";
      }
      if (event.event === "ERROR") {
        closed = true;
        code = "";
        return "error";
      }
      const eventName = event.event === "FINISH" ||
          event.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
        ? event.event
        : "";
      if (!eventName) return "ignored";
      const nextWabaId = boundedText(event.data?.waba_id, 100);
      const nextPhoneNumberId = boundedText(event.data?.phone_number_id, 100);
      // Coexistence classification comes only from the exact event string.
      // Meta's documented FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING payload may
      // omit phone_number_id (it is resolved from the WABA's phone list on
      // the backend); STANDARD FINISH keeps requiring both IDs unchanged.
      const isCoexistence =
        eventName === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
      if (!nextWabaId) return "invalid_finish";
      if (!isCoexistence && !nextPhoneNumberId) return "invalid_finish";
      wabaId = nextWabaId;
      phoneNumberId = nextPhoneNumberId;
      completion = {
        eventName,
        onboardingMode: isCoexistence ? "COEXISTENCE" : "STANDARD",
        sessionInfoVersion,
        businessAppCoexistenceCompleted: isCoexistence,
      };
      flush();
      return "finish";
    },
    cancel() {
      closed = true;
      code = "";
      wabaId = "";
      phoneNumberId = "";
      completion = null;
    },
  };
}
