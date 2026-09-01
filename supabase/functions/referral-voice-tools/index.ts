import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleVoiceToolRequest } from "./handler.ts";
import { issueOrGetCoupon } from "./workflow.ts";
import { createGoogleMapsClient } from "./googleMaps.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    try {
      const supabase = createClient(
        requiredEnv("SUPABASE_URL"),
        requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const googleMaps = createGoogleMapsClient(
        requiredEnv("GOOGLE_MAPS_PLATFORM_API_KEY"),
      );
      return await handleVoiceToolRequest(request, {
        expectedSecret: requiredEnv("CREATYV_VOICE_TOOL_SECRET"),
        listActiveNonCouponServices: async (organizationId) => {
          const result = await supabase
            .from("service_configs")
            .select("id,activo")
            .eq("organization_id", organizationId)
            .eq("activo", true)
            .order("menu_orden", { ascending: true });
          return {
            data: result.data,
            error: result.error,
          };
        },
        listActiveCouponCampaigns: async (organizationId) => {
          const result = await supabase
            .from("referral_coupon_campaigns")
            .select("service_id,active,offer_terms")
            .eq("organization_id", organizationId)
            .eq("active", true);
          return {
            data: result.data,
            error: result.error,
          };
        },
        workflow: {
          findVoiceLead: async (channelUserId, sourceChannel) => {
            const result = await supabase
              .from("leads")
              .select(
                "id,state,channel,channel_user_id,service_id,handoff_to_human,status",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("channel", sourceChannel)
              .eq("channel_user_id", channelUserId)
              .maybeSingle();
            return { data: result.data, error: result.error };
          },
          saveVoiceLead: async (input) => {
            const result = await supabase.from("leads").upsert({
              organization_id: input.organizationId,
              channel: input.sourceChannel,
              last_channel: input.sourceChannel,
              channel_user_id: input.channelUserId,
              service_id: input.serviceId,
              state: input.state,
              full_name: input.fullName,
              first_name: input.firstName,
              last_name: input.lastName,
              handoff_to_human: input.handoffToHuman ?? false,
              status: input.status ?? "contacted",
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "organization_id,channel,channel_user_id",
            }).select(
              "id,state,channel,channel_user_id,service_id,handoff_to_human,status",
            ).single();
            return { data: result.data, error: result.error };
          },
          getCampaign: async (serviceId) => {
            const result = await supabase
              .from("referral_coupon_campaigns")
              .select(
                "service_id,campaign_key,display_name,offer_terms,active",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("service_id", serviceId)
              .eq("active", true)
              .maybeSingle();
            return { data: result.data, error: result.error };
          },
          issueCoupon: ({ organizationId, leadId, campaignKey }) =>
            issueOrGetCoupon({
              supabase,
              organizationId,
              leadId,
              campaignKey,
            }),
        },
        grocery: {
          listOffers: async (partnerLocationId) => {
            const result = await supabase
              .from("referral_basket_offers")
              .select(
                "id,partner_location_id,basket_key,display_name,price_cents,currency,contents_snapshot,active",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("partner_location_id", partnerLocationId)
              .eq("active", true)
              .order("basket_key", { ascending: true });
            return { data: result.data, error: result.error };
          },
          getOffer: async (offerId) => {
            const result = await supabase
              .from("referral_basket_offers")
              .select(
                "id,partner_location_id,basket_key,display_name,price_cents,currency,contents_snapshot,active",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("id", offerId)
              .eq("active", true)
              .maybeSingle();
            return { data: result.data, error: result.error };
          },
          listLocations: async () => {
            const locations = await supabase
              .from("referral_partner_locations")
              .select(
                "id,partner_id,name,formatted_address,city,state,postal_code,latitude,longitude,active,delivery_enabled",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("active", true)
              .eq("delivery_enabled", true)
              .order("name", { ascending: true });
            if (locations.error || !locations.data) {
              return { data: null, error: locations.error };
            }
            const partnerIds = [
              ...new Set(locations.data.map((row) => String(row.partner_id))),
            ];
            const partners = await supabase
              .from("referral_partners")
              .select("id,name,active")
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("active", true)
              .in("id", partnerIds);
            if (partners.error || !partners.data) {
              return { data: null, error: partners.error };
            }
            const byId = new Map(
              partners.data.map((row) => [String(row.id), row]),
            );
            return {
              data: locations.data.map((row) => {
                const partner = byId.get(String(row.partner_id));
                return {
                  ...row,
                  partner_name: String(partner?.name ?? ""),
                  partner_active: partner?.active === true,
                };
              }),
              error: null,
            };
          },
          listDeliveryCoverage: async (postalCode) => {
            const result = await supabase
              .from("referral_grocery_delivery_coverage")
              .select("partner_location_id,postal_code,active,priority")
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("postal_code", postalCode)
              .eq("active", true)
              .order("priority", { ascending: true });
            const code = String(result.error?.code ?? "");
            if (result.error && (code === "42P01" || code === "PGRST205")) {
              return { data: null, error: null, unavailable: true };
            }
            return { data: result.data, error: result.error };
          },
          geocodeAddress: (address) => googleMaps.geocodeAddress(address),
          computeDrivingRouteMatrix: (input) =>
            googleMaps.computeDrivingRouteMatrix(input),
          findVoiceLead: async (channelUserId, sourceChannel) => {
            const result = await supabase
              .from("leads")
              .select(
                "id,state,channel,channel_user_id,service_id,handoff_to_human,status",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("channel", sourceChannel)
              .eq("channel_user_id", channelUserId)
              .maybeSingle();
            return { data: result.data, error: result.error };
          },
          saveVoiceLead: async (input) => {
            const result = await supabase.from("leads").upsert({
              organization_id: input.organizationId,
              channel: input.sourceChannel,
              last_channel: input.sourceChannel,
              channel_user_id: input.channelUserId,
              service_id: input.serviceId,
              state: input.state,
              full_name: input.fullName,
              first_name: input.firstName,
              last_name: input.lastName,
              handoff_to_human: input.handoffToHuman ?? false,
              status: input.status ?? "contacted",
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "organization_id,channel,channel_user_id",
            }).select(
              "id,state,channel,channel_user_id,service_id,handoff_to_human,status",
            ).single();
            return { data: result.data, error: result.error };
          },
          createOrder: async (args) => {
            const result = await supabase.rpc("create_referral_order", args);
            return {
              data: Array.isArray(result.data)
                ? result.data[0] ?? null
                : result.data,
              error: result.error,
            };
          },
        },
        couponDelivery: {
          getCampaign: async (serviceId) => {
            const result = await supabase
              .from("referral_coupon_campaigns")
              .select(
                "service_id,campaign_key,display_name,offer_terms,active",
              )
              .eq("organization_id", "luis-gabriel-referral-hub")
              .eq("service_id", serviceId)
              .eq("active", true)
              .maybeSingle();
            return { data: result.data, error: result.error };
          },
          saveDeliveryTracking: async (input) => {
            const result = await supabase
              .from("referral_coupon_delivery_events")
              .upsert({
                organization_id: input.organizationId,
                conversation_identity_hash: input.conversationIdentityHash,
                service_id: input.serviceId,
                campaign_key: input.campaignKey,
                channel: input.channel,
                metadata: input.metadata,
                prepared_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }, {
                onConflict:
                  "organization_id,conversation_identity_hash,service_id,campaign_key,channel",
              })
              .select("id")
              .single();
            return {
              saved: Boolean(result.data?.id) && !result.error,
              error: result.error,
            };
          },
        },
        log: (event) => console.log(JSON.stringify(event)),
      });
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "service_unavailable" }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }
  });
}
