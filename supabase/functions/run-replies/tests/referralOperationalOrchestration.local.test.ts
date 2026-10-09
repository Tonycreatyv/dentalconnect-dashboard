import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const localUrl = Deno.env.get("LOCAL_SUPABASE_URL");
const serviceKey = Deno.env.get("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("LOCAL_SUPABASE_ANON_KEY");
const portalUrl = Deno.env.get("LOCAL_PARTNER_PORTAL_URL");

if (!localUrl || !serviceKey || !anonKey || !portalUrl) {
  Deno.test.ignore(
    "local Referral Hub operational orchestration end to end",
    () => {},
  );
} else {
  const testLocalUrl = localUrl;
  const testServiceKey = serviceKey;
  const testAnonKey = anonKey;
  const testPortalUrl = portalUrl;
  Deno.test("local Referral Hub operational orchestration end to end", async () => {
    const admin = createClient(testLocalUrl, testServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const organizationId = "luis-gabriel-referral-hub";
    const otherOrganizationId = `other-${crypto.randomUUID()}`;
    assertEquals(
      (await admin.from("organizations").upsert([
        { id: organizationId, name: "LG local orchestration fixture" },
        { id: otherOrganizationId, name: "Other local tenant fixture" },
      ])).error,
      null,
    );

    const ownerEmail = `owner-${crypto.randomUUID()}@local.test`;
    const ownerPassword = `Local-${crypto.randomUUID()}!`;
    const owner = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    assert(owner.data.user?.id);
    assertEquals(
      (await admin.from("org_members").insert({
        organization_id: organizationId,
        user_id: owner.data.user.id,
        role: "owner",
      })).error,
      null,
    );
    const browser = createClient(testLocalUrl, testAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assertEquals(
      (await browser.auth.signInWithPassword({
        email: ownerEmail,
        password: ownerPassword,
      })).error,
      null,
    );

    const partnerId = crypto.randomUUID();
    const noContactPartnerId = crypto.randomUUID();
    assertEquals(
      (await admin.from("referral_partners").insert([{
        id: partnerId,
        organization_id: organizationId,
        name: "Local reviewed partner fixture",
        slug: `local-reviewed-${partnerId}`,
        partnership_status: "demo_reference",
        active: true,
      }, {
        id: noContactPartnerId,
        organization_id: organizationId,
        name: "Local missing-contact fixture",
        slug: `local-missing-contact-${noContactPartnerId}`,
        partnership_status: "demo_reference",
        active: true,
      }])).error,
      null,
    );
    const configuredServices = [
      "luis_accidente",
      "luis_inmigracion",
      "luis_eventos",
      "luis_representante",
    ];
    assertEquals(
      (await admin.from("referral_partner_contacts").insert({
        organization_id: organizationId,
        partner_id: partnerId,
        name: "Local operations contact",
        email: "operations@local.test",
        is_primary: true,
        service_ids: configuredServices,
        notification_priority: 1,
        active: true,
      })).error,
      null,
    );
    assertEquals(
      (await admin.from("referral_partner_service_rules").insert([
        ...configuredServices.map((serviceId, index) => ({
          organization_id: organizationId,
          partner_id: partnerId,
          service_id: serviceId,
          cities: ["Configured City"],
          languages: ["es"],
          specialties: serviceId === "luis_accidente" ? ["auto"] : [],
          assignment_priority: index + 1,
          assignment_weight: 1,
          capacity_limit: 20,
          acceptance_sla_minutes: 60,
          preferred_notification_channel: "email",
          active: true,
        })),
        {
          organization_id: organizationId,
          partner_id: noContactPartnerId,
          service_id: "luis_representante",
          cities: ["No Contact City"],
          languages: ["es"],
          specialties: [],
          assignment_priority: 1,
          assignment_weight: 1,
          capacity_limit: 20,
          acceptance_sla_minutes: 60,
          preferred_notification_channel: "email",
          active: true,
        },
      ])).error,
      null,
    );

    async function createLead(
      channel: "messenger" | "whatsapp",
      organization = organizationId,
    ) {
      const id = crypto.randomUUID();
      const channelUserId = `${channel}-${crypto.randomUUID()}`;
      assertEquals(
        (await admin.from("leads").insert({
          id,
          organization_id: organization,
          channel,
          channel_user_id: channelUserId,
          full_name: "Local Test Customer",
        })).error,
        null,
      );
      return { id, channel, channelUserId };
    }

    async function orchestrate(args: {
      lead: Awaited<ReturnType<typeof createLead>>;
      serviceId: string;
      city: string;
      specialty?: string;
      outcome?: "confirmed_intake" | "follow_up_requested";
      completionKey?: string;
    }) {
      const completionKey = args.completionKey ?? crypto.randomUUID();
      const response = await admin.rpc("orchestrate_referral_service_request", {
        p_organization_id: organizationId,
        p_lead_id: args.lead.id,
        p_service_id: args.serviceId,
        p_source_channel: args.lead.channel,
        p_channel_user_id: args.lead.channelUserId,
        p_completion_key: completionKey,
        p_completion_outcome: args.outcome ?? "confirmed_intake",
        p_intake: {
          profile_city: args.city,
          language: "es",
          ...(args.specialty ? { specialty: args.specialty } : {}),
        },
      });
      assertEquals(response.error, null, response.error?.message);
      return {
        data: response.data as Record<string, unknown>,
        completionKey,
      };
    }

    // A/C/E/H: configured accident, immigration, advisor and event follow-up.
    const accidentLead = await createLead("whatsapp");
    const accident = await orchestrate({
      lead: accidentLead,
      serviceId: "luis_accidente",
      city: "Configured City",
      specialty: "auto",
    });
    assertEquals(accident.data.outcome, "assigned");
    assertEquals(accident.data.request_status, "prequalified");
    assertEquals(accident.data.notification_status, "queued");
    assert(typeof accident.data.portal_token === "string");
    assert((accident.data.portal_token as string).length >= 32);

    const immigration = await orchestrate({
      lead: await createLead("messenger"),
      serviceId: "luis_inmigracion",
      city: "Configured City",
    });
    assertEquals(immigration.data.outcome, "assigned");

    const advisor = await orchestrate({
      lead: await createLead("whatsapp"),
      serviceId: "luis_representante",
      city: "Configured City",
    });
    assertEquals(advisor.data.outcome, "assigned");
    assertEquals(advisor.data.assignment_kind, "internal");
    assertEquals(advisor.data.portal_token, null);

    const eventFollowUp = await orchestrate({
      lead: await createLead("messenger"),
      serviceId: "luis_eventos",
      city: "Configured City",
      outcome: "follow_up_requested",
    });
    assertEquals(eventFollowUp.data.outcome, "assigned");

    // B/D/F: no eligible assignment and missing internal contact are explicit exceptions.
    for (const serviceId of ["luis_accidente", "luis_inmigracion"]) {
      const missing = await orchestrate({
        lead: await createLead("whatsapp"),
        serviceId,
        city: "Unconfigured City",
        specialty: serviceId === "luis_accidente" ? "auto" : undefined,
      });
      assertEquals(missing.data.outcome, "needs_coordinator_review");
      assertEquals(missing.data.exception_type, "no_eligible_partner");
      assertEquals(missing.data.assignment_id, null);
    }
    const advisorMissingContact = await orchestrate({
      lead: await createLead("whatsapp"),
      serviceId: "luis_representante",
      city: "No Contact City",
    });
    assertEquals(
      advisorMissingContact.data.outcome,
      "needs_coordinator_review",
    );
    assertEquals(
      advisorMissingContact.data.exception_type,
      "missing_partner_contact",
    );

    // J: replay reuses every canonical record and token row.
    const replay = await orchestrate({
      lead: accidentLead,
      serviceId: "luis_accidente",
      city: "Configured City",
      specialty: "auto",
      completionKey: accident.completionKey,
    });
    assertEquals(replay.data.idempotent_replay, true);
    assertEquals(replay.data.request_id, accident.data.request_id);
    assertEquals(replay.data.assignment_id, accident.data.assignment_id);
    for (
      const [table, column, value] of [
        ["referral_service_requests", "id", accident.data.request_id],
        ["referral_assignments", "id", accident.data.assignment_id],
        [
          "referral_notification_attempts",
          "assignment_id",
          accident.data.assignment_id,
        ],
        [
          "referral_partner_access_tokens",
          "assignment_id",
          accident.data.assignment_id,
        ],
      ] as const
    ) {
      const count = await admin.from(table).select("id", {
        count: "exact",
        head: true,
      }).eq(column, value);
      assertEquals(count.count, 1, `${table} duplicated`);
    }

    // A continued: real local portal endpoint accepts, then marks contacted.
    async function portal(
      action: string,
      token = String(accident.data.portal_token),
    ) {
      const response = await fetch(testPortalUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      return { status: response.status, body: await response.json() };
    }
    const viewed = await portal("view");
    assertEquals(viewed.status, 200, JSON.stringify(viewed.body));
    assertEquals(viewed.body.assignment.id, accident.data.assignment_id);
    const prematureContact = await portal("contacted");
    assertEquals(prematureContact.status, 409);
    assertEquals(
      prematureContact.body.error,
      "invalid_assignment_transition",
    );
    const accepted = await portal("accept");
    assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
    assertEquals(accepted.body.assignment.status, "accepted");
    const duplicateAccept = await portal("accept");
    assertEquals(duplicateAccept.status, 409);
    const contacted = await portal("contacted");
    assertEquals(contacted.status, 200, JSON.stringify(contacted.body));
    assertEquals(contacted.body.assignment.work_status, "contacted");

    const wrongToken = await portal("view", crypto.randomUUID().repeat(2));
    assertEquals(wrongToken.status, 401);
    const storedToken = await admin.from("referral_partner_access_tokens")
      .select("id,token_hash,expires_at,revoked_at")
      .eq("assignment_id", accident.data.assignment_id).single();
    assertEquals(storedToken.error, null);
    assertEquals(storedToken.data?.token_hash.length, 64);
    assert(
      storedToken.data?.token_hash !== String(accident.data.portal_token),
    );
    assert(
      !JSON.stringify(storedToken.data).includes(
        String(accident.data.portal_token),
      ),
    );
    assertEquals(
      (await admin.from("referral_partner_access_tokens").update({
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }).eq("id", storedToken.data!.id)).error,
      null,
    );
    assertEquals((await portal("view")).status, 401);
    assertEquals(
      (await admin.from("referral_partner_access_tokens").update({
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        revoked_at: new Date().toISOString(),
      }).eq("id", storedToken.data!.id)).error,
      null,
    );
    assertEquals((await portal("view")).status, 401);
    assertEquals(
      (await admin.from("referral_partner_access_tokens").update({
        revoked_at: null,
      }).eq("id", storedToken.data!.id)).error,
      null,
    );

    // Dashboard reads see requests, assignments, attention and timeline through RLS.
    const dashboardRequests = await browser.from("referral_service_requests")
      .select("id,status");
    const dashboardAssignments = await browser.from("referral_assignments")
      .select("id,status,work_status");
    const dashboardExceptions = await browser.from(
      "referral_operational_exceptions",
    ).select("id,status");
    const dashboardEvents = await browser.from("referral_operational_events")
      .select("id,event_type");
    assertEquals(dashboardRequests.error, null);
    assertEquals(dashboardAssignments.error, null);
    assertEquals(dashboardExceptions.error, null);
    assertEquals(dashboardEvents.error, null);
    assert((dashboardRequests.data?.length ?? 0) >= 7);
    assert((dashboardAssignments.data?.length ?? 0) >= 4);
    assert((dashboardExceptions.data?.length ?? 0) >= 3);
    assert(
      dashboardEvents.data?.some((event) =>
        event.event_type === "partner_accepted"
      ),
    );
    assert(
      dashboardEvents.data?.some((event) =>
        event.event_type === "partner_contacted"
      ),
    );

    // K: a lead from another tenant cannot be used to create canonical records.
    const otherLead = await createLead("whatsapp", otherOrganizationId);
    const crossTenant = await admin.rpc(
      "orchestrate_referral_service_request",
      {
        p_organization_id: organizationId,
        p_lead_id: otherLead.id,
        p_service_id: "luis_accidente",
        p_source_channel: otherLead.channel,
        p_channel_user_id: otherLead.channelUserId,
        p_completion_key: crypto.randomUUID(),
        p_completion_outcome: "confirmed_intake",
        p_intake: {
          profile_city: "Configured City",
          language: "es",
          specialty: "auto",
        },
      },
    );
    assert(crossTenant.error);
    assertEquals(
      (await admin.from("referral_service_requests").select("id").eq(
        "lead_id",
        otherLead.id,
      )).data?.length,
      0,
    );
  });
}
