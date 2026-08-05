export type MetaEmbeddedSignupResult = {
  code: string;
  wabaId: string;
  phoneNumberId: string;
};

export type MetaEmbeddedSignupEventResult =
  | "finish"
  | "cancel"
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
) {
  let code = "";
  let wabaId = "";
  let phoneNumberId = "";
  let closed = false;

  const flush = () => {
    if (closed || !code || !wabaId || !phoneNumberId) return;
    closed = true;
    onReady({ code, wabaId, phoneNumberId });
    code = "";
    wabaId = "";
    phoneNumberId = "";
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
      if (event.event !== "FINISH") return "ignored";
      const nextWabaId = boundedText(event.data?.waba_id, 100);
      const nextPhoneNumberId = boundedText(event.data?.phone_number_id, 100);
      if (!nextWabaId || !nextPhoneNumberId) return "invalid_finish";
      wabaId = nextWabaId;
      phoneNumberId = nextPhoneNumberId;
      flush();
      return "finish";
    },
    cancel() {
      closed = true;
      code = "";
      wabaId = "";
      phoneNumberId = "";
    },
  };
}
