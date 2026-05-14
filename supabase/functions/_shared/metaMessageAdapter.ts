export type MetaSendResult = {
  ok: boolean;
  status: number;
  data: any;
};

export type InteractiveButtonId =
  | "confirm_booking"
  | "reschedule"
  | "cancel"
  | "see_slots";

export type InteractiveButton = {
  id: InteractiveButtonId;
  title: string;
};

export type TemplateSendSpec = {
  name: string;
  languageCode?: string;
  components?: Array<Record<string, unknown>>;
};

export async function sendViaMetaAdapter(args: {
  channel: "messenger" | "whatsapp";
  graphVersion: string;
  recipientId: string;
  text?: string;
  buttons?: InteractiveButton[];
  template?: TemplateSendSpec;
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
}): Promise<MetaSendResult> {
  const token = String(args.pageAccessToken ?? "").trim();
  if (!token) throw new Error("missing_messenger_page_access_token");
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/messages`);
  url.searchParams.set("access_token", token);

  const text = String(args.text ?? "").trim() || "Gracias por escribirnos.";
  const quickReplies = Array.isArray(args.buttons) && args.buttons.length > 0
    ? args.buttons.slice(0, 11).map((b) => ({
      content_type: "text",
      title: b.title.slice(0, 20),
      payload: `action:${b.id}`,
    }))
    : undefined;

  const body = {
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
  template?: TemplateSendSpec;
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
  if (args.template?.name) {
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
        body: { text: String(args.text ?? "").trim() || "Elige una opción:" },
        action: { buttons },
      },
    };
  } else {
    body = {
      messaging_product: "whatsapp",
      to: args.recipientId,
      type: "text",
      text: { body: String(args.text ?? "").trim() || "Gracias por escribirnos." },
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
