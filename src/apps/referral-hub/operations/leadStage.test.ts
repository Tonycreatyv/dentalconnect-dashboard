/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveStage } from "./leadStage.ts";

const base = {
  lastUserReplyAt: null as string | null,
  staffOutreachAt: null as string | null,
  requestStatus: null as string | null,
  workStatus: null as string | null,
  hasCompletedLegalIntake: false,
};

Deno.test("a newly completed legal intake (no legacy request, no staff outreach) surfaces as 'por_contactar', not 'nuevo'", () => {
  assertEquals(deriveStage({ ...base, hasCompletedLegalIntake: true }), "por_contactar");
});

Deno.test("a lead with no signal at all stays 'nuevo' (regression guard — coupon-only leads unaffected)", () => {
  assertEquals(deriveStage({ ...base }), "nuevo");
});

Deno.test("staff outreach still wins over a completed legal intake with no reply yet", () => {
  assertEquals(
    deriveStage({ ...base, hasCompletedLegalIntake: true, staffOutreachAt: "2026-08-20T10:00:00Z" }),
    "contactado",
  );
});

Deno.test("a reply after staff outreach is 'respondio' regardless of legal intake", () => {
  assertEquals(
    deriveStage({
      ...base,
      hasCompletedLegalIntake: true,
      staffOutreachAt: "2026-08-20T10:00:00Z",
      lastUserReplyAt: "2026-08-20T11:00:00Z",
    }),
    "respondio",
  );
});

Deno.test("a legacy request with work_status 'appointment_scheduled' is 'confirmado', not the generic 'contactado'", () => {
  assertEquals(
    deriveStage({ ...base, requestStatus: "prequalified", workStatus: "appointment_scheduled" }),
    "confirmado",
  );
});

Deno.test("a legacy request with work_status 'contacted'/'in_progress' is still 'contactado'", () => {
  assertEquals(deriveStage({ ...base, requestStatus: "prequalified", workStatus: "contacted" }), "contactado");
  assertEquals(deriveStage({ ...base, requestStatus: "prequalified", workStatus: "in_progress" }), "contactado");
});

// Real production case (2026-08-25, lead 867dace6-d2a9-4ebb-80d2-4ad877316058):
// a completed AUTO_ACCIDENT Flow intake coexists with an UNRELATED legacy
// referral_service_requests row (service "luis_representante", status
// "prequalified", no assignment) — the unrelated row must not suppress the
// intake's "por_contactar" promotion.
Deno.test("an unrelated legacy request with no real progress does not suppress a completed legal intake's promotion", () => {
  assertEquals(
    deriveStage({ ...base, hasCompletedLegalIntake: true, requestStatus: "prequalified", workStatus: null }),
    "por_contactar",
  );
});

Deno.test("a closed legacy request is 'cerrado' regardless of a completed legal intake", () => {
  assertEquals(
    deriveStage({ ...base, hasCompletedLegalIntake: true, requestStatus: "closed" }),
    "cerrado",
  );
});
