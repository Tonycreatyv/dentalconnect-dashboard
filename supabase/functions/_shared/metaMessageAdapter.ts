export type MetaSendResult = {
  ok: boolean;
  status: number;
  data: any;
};

export type InteractiveButton = {
  id: string;
  title: string;
};

export type WhatsAppLocationSpec = {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
};

export type WhatsAppInteractiveListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppInteractiveListSection = {
  title: string;
  rows: WhatsAppInteractiveListRow[];
};

export type WhatsAppInteractiveListSpec = {
  title?: string;
  body: string;
  buttonText: string;
  sections: WhatsAppInteractiveListSection[];
};

export type TemplateSendSpec = {
  name: string;
  languageCode?: string;
  components?: Array<Record<string, unknown>>;
};

export type WhatsAppFlowCtaSpec = {
  bodyText: string;
  ctaText: string;
  flowId: string;
  /** Draft is permitted only by the isolated Meta test transport. */
  flowMode?: "published" | "draft";
  flowToken?: string;
  flowAction?: "navigate" | "data_exchange";
  flowActionPayload?: Record<string, unknown>;
  /**
   * Optional header/title override for the outer WhatsApp CTA message.
   * Undefined keeps the legacy "Agendá tu cita" default; an explicit empty
   * string omits the header entirely.
   */
  headerText?: string;
};

export function buildWhatsAppFlowCtaMessage(args: {
  to: string;
  flow_id: string;
  flow_token?: string;
  cta_text?: string;
  body_text?: string;
  header_text?: string;
  mode?: "published" | "draft";
  flow_action?: "navigate" | "data_exchange";
  flow_action_payload?: Record<string, unknown>;
  organization_id?: string;
  lead_id?: string;
}): Record<string, unknown> {
  const bodyText = String(
    args.body_text ?? "Tocá aquí para elegir servicio, fecha y hora.",
  ).trim();
  const ctaText = String(args.cta_text ?? "Agendar cita").trim();
  // header_text undefined => legacy default header; explicit "" => no header.
  const headerText = args.header_text === undefined
    ? "Agendá tu cita"
    : String(args.header_text).trim();
  const flowId = String(args.flow_id ?? "").trim();
  const flowToken = String(args.flow_token ?? "").trim();
  const flowMode = args.mode ?? "published";
  const flowAction = args.flow_action ?? "navigate";
  const flowActionPayload = args.flow_action_payload ?? {
    screen: "SERVICE",
    data: {
      organization_id: String(args.organization_id ?? "").trim(),
      lead_id: String(args.lead_id ?? "").trim(),
    },
  };
  return {
    messaging_product: "whatsapp",
    to: String(args.to ?? "").trim(),
    type: "interactive",
    interactive: {
      type: "flow",
      ...(headerText ? { header: { type: "text", text: headerText } } : {}),
      body: {
        text: bodyText || "Tocá aquí para elegir servicio, fecha y hora.",
      },
      action: {
        name: "flow",
        parameters: {
          mode: flowMode,
          flow_message_version: "3",
          flow_id: flowId,
          flow_cta: ctaText || "Agendar cita",
          ...(flowToken ? { flow_token: flowToken } : {}),
          flow_action: flowAction,
          flow_action_payload: flowActionPayload,
        },
      },
    },
  };
}

// Pure payload builder, exported for direct testing (same pattern as
// buildWhatsAppFlowCtaMessage above) - never invents coordinates or an
// address; whatever the caller passes is what's sent, verbatim.
export function buildWhatsAppLocationMessage(args: {
  to: string;
  location: WhatsAppLocationSpec;
}): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to: String(args.to ?? "").trim(),
    type: "location",
    location: {
      latitude: args.location.latitude,
      longitude: args.location.longitude,
      name: String(args.location.name ?? "").trim(),
      address: String(args.location.address ?? "").trim(),
    },
  };
}

export async function sendViaMetaAdapter(args: {
  channel: "messenger" | "whatsapp";
  graphVersion: string;
  recipientId: string;
  text?: string;
  buttons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
  imageUrl?: string;
  location?: WhatsAppLocationSpec;
  template?: TemplateSendSpec;
  flowCta?: WhatsAppFlowCtaSpec;
  pageAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
}): Promise<MetaSendResult> {
  if (args.channel === "whatsapp") {
    return await sendViaWhatsApp(args);
  }
  return await sendViaMessenger(args);
}

async function sendViaMessenger(args: {
  graphVersion: string;
  recipientId: string;
  text?: string;
  buttons?: InteractiveButton[];
  pageAccessToken?: string;
  template?: TemplateSendSpec;
  interactiveList?: WhatsAppInteractiveListSpec;
  imageUrl?: string;
}): Promise<MetaSendResult> {
  const token = String(args.pageAccessToken ?? "").trim();
  if (!token) throw new Error("missing_messenger_page_access_token");
  const url = new URL(
    `https://graph.facebook.com/${args.graphVersion}/me/messages`,
  );
  url.searchParams.set("access_token", token);

  const text = String(args.text ?? "").trim() || "Gracias por escribirnos.";
  const imageUrl = String(args.imageUrl ?? "").trim();
  const quickReplies = Array.isArray(args.buttons) && args.buttons.length > 0
    ? args.buttons.slice(0, 11).map((b) => ({
      content_type: "text",
      title: b.title.slice(0, 20),
      payload: b.id,
    }))
    : undefined;

  const body = imageUrl
    ? {
      messaging_type: "RESPONSE",
      recipient: { id: args.recipientId },
      message: {
        attachment: {
          type: "image",
          payload: { url: imageUrl, is_reusable: true },
        },
      },
    }
    : {
      messaging_type: "RESPONSE",
      recipient: { id: args.recipientId },
      message: {
        text,
        ...(quickReplies ? { quick_replies: quickReplies } : {}),
      },
    };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function sendViaWhatsApp(args: {
  graphVersion: string;
  recipientId: string;
  text?: string;
  buttons?: InteractiveButton[];
  interactiveList?: WhatsAppInteractiveListSpec;
  imageUrl?: string;
  location?: WhatsAppLocationSpec;
  template?: TemplateSendSpec;
  flowCta?: WhatsAppFlowCtaSpec;
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
}): Promise<MetaSendResult> {
  const phoneNumberId = String(args.whatsappPhoneNumberId ?? "").trim();
  const accessToken = String(args.whatsappAccessToken ?? "").trim();
  if (!phoneNumberId || !accessToken) {
    throw new Error("missing_whatsapp_credentials");
  }

  const url = new URL(
    `https://graph.facebook.com/${args.graphVersion}/${phoneNumberId}/messages`,
  );

  let body: Record<string, unknown>;
  if (args.flowCta?.flowId) {
    body = buildWhatsAppFlowCtaMessage({
      to: args.recipientId,
      flow_id: String(args.flowCta.flowId ?? "").trim(),
      flow_token: String(args.flowCta.flowToken ?? "").trim() || undefined,
      cta_text: String(args.flowCta.ctaText ?? "").trim() || "Agendar cita",
      body_text: String(args.flowCta.bodyText ?? "").trim() ||
        "Tocá aquí para elegir servicio, fecha y hora.",
      header_text: args.flowCta.headerText,
      mode: args.flowCta.flowMode ?? "published",
      flow_action: args.flowCta.flowAction ?? "navigate",
      flow_action_payload: args.flowCta.flowActionPayload ??
        { screen: "SERVICE" },
    });
    const interactive = (body as any)?.interactive ?? {};
    const parameters = (interactive?.action?.parameters ?? {}) as Record<
      string,
      unknown
    >;
    console.log(JSON.stringify({
      event: "flow_payload_before_send",
      has_flow_id: Boolean(String(parameters.flow_id ?? "").trim()),
      flow_id: String(parameters.flow_id ?? "").trim(),
      flow_id_length: String(parameters.flow_id ?? "").trim().length,
      mode: String(parameters.mode ?? ""),
      flow_action: String(parameters.flow_action ?? ""),
      screen: String((parameters.flow_action_payload as any)?.screen ?? ""),
      phone_number_id: phoneNumberId,
      interactive_type: String(interactive?.type ?? ""),
      flow_cta: String(parameters.flow_cta ?? ""),
    }));
  } else if (args.template?.name) {
    body = {
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "template",
      template: {
        name: args.template.name,
        language: { code: args.template.languageCode ?? "es" },
        ...(Array.isArray(args.template.components) &&
            args.template.components.length > 0
          ? { components: args.template.components }
          : {}),
      },
    };
  } else if (args.interactiveList?.sections?.length) {
    body = {
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "interactive",
      interactive: {
        type: "list",
        ...(String(args.interactiveList.title ?? "").trim()
          ? {
            header: {
              type: "text",
              text: String(args.interactiveList.title).trim().slice(0, 60),
            },
          }
          : {}),
        body: {
          text: String(args.interactiveList.body ?? args.text ?? "").trim() ||
            "Elegí una opción:",
        },
        action: {
          button:
            String(args.interactiveList.buttonText ?? "Ver opciones").trim()
              .slice(0, 20) || "Ver opciones",
          sections: args.interactiveList.sections
            .filter((section) =>
              Array.isArray(section.rows) && section.rows.length > 0
            )
            .slice(0, 10)
            .map((section) => ({
              title: String(section.title ?? "Opciones").trim().slice(0, 24) ||
                "Opciones",
              rows: section.rows
                .filter((row) =>
                  String(row.id ?? "").trim() && String(row.title ?? "").trim()
                )
                .slice(0, 10)
                .map((row) => ({
                  id: `action:${String(row.id).trim()}`.slice(0, 200),
                  title: String(row.title).trim().slice(0, 24),
                  ...(String(row.description ?? "").trim()
                    ? {
                      description: String(row.description).trim().slice(0, 72),
                    }
                    : {}),
                })),
            })),
        },
      },
    };
  } else if (Array.isArray(args.buttons) && args.buttons.length > 0) {
    const buttons = args.buttons.slice(0, 3).map((b) => ({
      type: "reply",
      reply: {
        id: `action:${b.id}`,
        title: b.title.slice(0, 20),
      },
    }));
    body = {
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "interactive",
      interactive: {
        type: "button",
        ...(String(args.imageUrl ?? "").trim()
          ? {
            header: {
              type: "image",
              image: { link: String(args.imageUrl).trim() },
            },
          }
          : {}),
        body: { text: String(args.text ?? "").trim() || "Elige una opción:" },
        action: { buttons },
      },
    };
  } else if (args.location) {
    body = buildWhatsAppLocationMessage({ to: args.recipientId, location: args.location });
  } else if (String(args.imageUrl ?? "").trim()) {
    body = {
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "image",
      image: {
        link: String(args.imageUrl).trim(),
        ...(String(args.text ?? "").trim()
          ? { caption: String(args.text).trim().slice(0, 1024) }
          : {}),
      },
    };
  } else {
    body = {
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "text",
      text: {
        body: String(args.text ?? "").trim() || "Gracias por escribirnos.",
      },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
