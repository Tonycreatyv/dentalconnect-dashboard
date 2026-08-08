import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const localUrl = Deno.env.get("LOCAL_SUPABASE_URL");
const secretKey = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
const publishableKey = Deno.env.get("LOCAL_SUPABASE_PUBLISHABLE_KEY");
const functionUrl = Deno.env.get("LOCAL_MANUAL_MESSAGE_URL");

if (!localUrl || !secretKey || !publishableKey || !functionUrl) {
  Deno.test.ignore(
    "local authenticated manual Inbox Edge Function smoke",
    () => {},
  );
} else {
  const testUrl = localUrl;
  const testSecretKey = secretKey;
  const testPublishableKey = publishableKey;
  const testFunctionUrl = functionUrl;
  Deno.test("local authenticated manual Inbox Edge Function smoke", async () => {
    const admin = createClient(testUrl, testSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const organizationId = "luis-gabriel-referral-hub";

    async function user(role: "owner" | "admin" | "nonmember") {
      const email = `${role}-${crypto.randomUUID()}@local.test`;
      const password = `Local-${crypto.randomUUID()}!`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      assert(created.data.user?.id);
      if (role !== "nonmember") {
        assertEquals(
          (await admin.from("org_members").insert({
            organization_id: organizationId,
            user_id: created.data.user.id,
            role,
          })).error,
          null,
        );
      }
      const client = createClient(testUrl, testPublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signedIn = await client.auth.signInWithPassword({
        email,
        password,
      });
      assertEquals(signedIn.error, null);
      assert(signedIn.data.session?.access_token);
      return signedIn.data.session.access_token;
    }

    const ownerToken = await user("owner");
    const adminToken = await user("admin");
    const nonmemberToken = await user("nonmember");
    const messengerLead = crypto.randomUUID();
    const whatsappLead = crypto.randomUUID();
    assertEquals(
      (await admin.from("leads").insert([{
        id: messengerLead,
        organization_id: organizationId,
        channel: "messenger",
        channel_user_id: `local-messenger-${crypto.randomUUID()}`,
      }, {
        id: whatsappLead,
        organization_id: organizationId,
        channel: "whatsapp",
        channel_user_id: `local-whatsapp-${crypto.randomUUID()}`,
      }])).error,
      null,
    );

    async function invoke(
      token: string,
      body: Record<string, unknown>,
    ) {
      const response = await fetch(testFunctionUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          apikey: testPublishableKey,
          "content-type": "application/json",
          origin: "http://localhost:5173",
        },
        body: JSON.stringify(body),
      });
      return { response, body: await response.json() };
    }

    const messenger = (await admin.from("leads").select("channel_user_id")
      .eq("id", messengerLead).single()).data!;
    const whatsapp = (await admin.from("leads").select("channel_user_id")
      .eq("id", whatsappLead).single()).data!;
    const textKey = `owner-text-${crypto.randomUUID()}`;
    const ownerResult = await invoke(ownerToken, {
      organization_id: organizationId,
      lead_id: messengerLead,
      channel: "messenger",
      channel_user_id: messenger.channel_user_id,
      text: "Mensaje local de prueba",
      idempotency_key: textKey,
    });
    assertEquals(ownerResult.response.status, 202);
    assertEquals(ownerResult.body.delivery_status, "queued");
    assertEquals(ownerResult.body.idempotent_replay, false);
    assert(!JSON.stringify(ownerResult.body).match(/token|secret/i));
    assertEquals(
      (await admin.from("messages").select("id").eq(
        "id",
        ownerResult.body.message_id,
      )).data?.length,
      1,
    );
    assertEquals(
      (await admin.from("reply_outbox").select("status,payload").eq(
        "id",
        ownerResult.body.outbox_id,
      )).data?.[0]?.status,
      "queued",
    );

    const replay = await invoke(ownerToken, {
      organization_id: organizationId,
      lead_id: messengerLead,
      channel: "messenger",
      channel_user_id: messenger.channel_user_id,
      text: "No debe duplicarse",
      idempotency_key: textKey,
    });
    assertEquals(replay.response.status, 200);
    assertEquals(replay.body.idempotent_replay, true);
    assertEquals(
      (await admin.from("reply_outbox").select("id").contains(
        "payload",
        { idempotency_key: textKey },
      )).data?.length,
      1,
    );

    const adminImage = await invoke(adminToken, {
      organization_id: organizationId,
      lead_id: whatsappLead,
      channel: "whatsapp",
      channel_user_id: whatsapp.channel_user_id,
      image_url:
        "https://referral.creatyv.io/images/coupons/lg-dental-coupon.jpeg",
      idempotency_key: `admin-image-${crypto.randomUUID()}`,
    });
    assertEquals(adminImage.response.status, 202);
    assertEquals(adminImage.body.delivery_status, "queued");

    const nonmember = await invoke(nonmemberToken, {
      organization_id: organizationId,
      lead_id: messengerLead,
      channel: "messenger",
      channel_user_id: messenger.channel_user_id,
      text: "No autorizado",
      idempotency_key: `nonmember-${crypto.randomUUID()}`,
    });
    assertEquals(nonmember.response.status, 403);
    assertEquals(nonmember.body.error, "permission_denied");

    const wrongOrganization = await invoke(ownerToken, {
      organization_id: "another-tenant",
      lead_id: messengerLead,
      channel: "messenger",
      channel_user_id: messenger.channel_user_id,
      text: "No autorizado",
      idempotency_key: `wrong-org-${crypto.randomUUID()}`,
    });
    assertEquals(wrongOrganization.response.status, 403);
    assertEquals(wrongOrganization.body.error, "organization_forbidden");

    const mismatched = await invoke(ownerToken, {
      organization_id: organizationId,
      lead_id: messengerLead,
      channel: "whatsapp",
      channel_user_id: whatsapp.channel_user_id,
      text: "Canal incorrecto",
      idempotency_key: `mismatch-${crypto.randomUUID()}`,
    });
    assertEquals(mismatched.response.status, 404);
    assertEquals(mismatched.body.error, "conversation_not_found");

    const invalidImage = await invoke(ownerToken, {
      organization_id: organizationId,
      lead_id: messengerLead,
      channel: "messenger",
      channel_user_id: messenger.channel_user_id,
      image_url: "http://insecure.test/image.jpg",
      idempotency_key: `invalid-image-${crypto.randomUUID()}`,
    });
    assertEquals(invalidImage.response.status, 400);
    assertEquals(invalidImage.body.error, "invalid_content");

    // Local provider adapter simulation only: no Meta request is made.
    const providerMockId = `mock-${crypto.randomUUID()}`;
    assertEquals(
      (await admin.from("reply_outbox").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
        payload: {
          ...(await admin.from("reply_outbox").select("payload").eq(
            "id",
            ownerResult.body.outbox_id,
          ).single()).data?.payload,
          provider_mock: {
            outcome: "sent",
            provider_message_id: providerMockId,
          },
        },
      }).eq("id", ownerResult.body.outbox_id)).error,
      null,
    );
    const sent = await admin.from("reply_outbox").select("status,payload")
      .eq("id", ownerResult.body.outbox_id).single();
    assertEquals(sent.data?.status, "sent");
    assertEquals(
      sent.data?.payload.provider_mock.provider_message_id,
      providerMockId,
    );

    assertEquals(
      (await admin.from("reply_outbox").update({
        status: "failed",
        sent_at: null,
        last_error: "provider_mock_failed",
      }).eq("id", adminImage.body.outbox_id)).error,
      null,
    );
    const failed = await admin.from("reply_outbox").select("status,last_error")
      .eq("id", adminImage.body.outbox_id).single();
    assertEquals(failed.data?.status, "failed");
    assertEquals(failed.data?.last_error, "provider_mock_failed");
  });
}
