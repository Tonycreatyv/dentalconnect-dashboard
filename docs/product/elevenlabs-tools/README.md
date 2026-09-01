# Referral Hub ElevenLabs webhook tools

These files are ready to paste into ElevenLabs **Edit as JSON**. Before saving any tool, replace `REPLACE_WITH_EXISTING_SECRET_ID` with the `secret_id` from the working `check_delivery_zip` JSON. Never paste the underlying secret value.

## Tool creation order

1. `get_basket_details.json`
2. `save_basket_intake.json`
3. `create_basket_order.json`
4. `deliver_coupon_image.json`
5. `find_nearest_supermarket.json`

The grocery conversation should call the already-working tools in this operational order:

1. `check_delivery_zip` with the customer's ZIP.
2. `list_basket_offers` with the selected `partner_location_id`.
3. `get_basket_details` with the selected real `offer_id` and the same `partner_location_id`.
4. `save_basket_intake` incrementally as selections and customer details become known.
5. `create_basket_order` only after all required intake is persisted and the customer explicitly confirms the complete order summary.

`deliver_coupon_image` is a separate coupon path and must be called only after the customer selects and confirms one of the three allowed coupon services.

When the customer wants the closest eligible supermarket and provides a full address, call `find_nearest_supermarket` after ZIP eligibility and before listing offers. Use only a successfully returned `partner_location_id`; never infer proximity from ZIP alone.

## Constant values

Every file defines these constants:

- `action`: the exact filename/action name without `.json`.
- `source_channel`: `whatsapp`.
- `Content-Type`: `application/json`.
- Webhook URL: `https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/referral-voice-tools`.

Only `organization_id` uses `value_type: dynamic_variable`. Its placeholder is named `organization_id`.

## Values from prior tool responses

- `partner_location_id`: exact UUID selected from `check_delivery_zip`.
- `offer_id`: exact real active offer UUID returned by `list_basket_offers` for that same location.
- `service_id` for coupon delivery: exact selected canonical service ID (`luis_cupon_super`, `luis_cupon_medico`, or `luis_cupon_dental`).
- Prices, basket contents, merchant name, discount or promotional terms, image URL, and caption are response data. They must never be sent as caller-controlled request fields.

## Values from the customer

The grocery intake may incrementally collect:

- `postal_code`
- `customer_name`
- `phone`
- `address_line_1`
- optional `address_line_2`
- `city`
- `state`
- optional `delivery_instructions`
- `payment_preference`

`confirmed` is true only after explicit customer confirmation. It must never be inferred. Coupon delivery may additionally send optional `caller_phone`, `fields.profile_name`, and `fields.profile_city` only when the customer supplied those values.

`conversation_id` must be the exact identifier for the current ElevenLabs conversation available to the agent context. It is not customer data and must never be invented or reused across conversations.

## Exact files

- `get_basket_details.json` — loads one exact active offer/location pair.
- `save_basket_intake.json` — incrementally persists selected and customer-provided grocery fields.
- `create_basket_order.json` — creates an idempotent order from persisted intake after explicit confirmation.
- `deliver_coupon_image.json` — prepares the trusted configured coupon image and public campaign copy without accepting caller-supplied commercial or media fields.
- `find_nearest_supermarket.json` — geocodes the customer address and ranks only ZIP-eligible supermarkets by verified driving route.
- `system-prompt-location-update.txt` — safe orchestration and phone-error instructions to add to the agent prompt.

## Future cost optimization

Store latitude and longitude for every partner location, geocode each destination once, and reuse those coordinates for future route comparisons. This change intentionally does not add that persistence migration yet.

## Secret setup reminder

For every JSON file, replace:

```text
REPLACE_WITH_EXISTING_SECRET_ID
```

with the exact `secret_id` already used by the working `check_delivery_zip` tool's `x-creatyv-voice-secret` header. Do not replace it with the secret value itself.
