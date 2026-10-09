import type {
  InteractiveButton,
  WhatsAppInteractiveListSpec,
} from "../../../_shared/metaMessageAdapter.ts";

export type InsuranceServiceOption = {
  id: string;
  name: string;
  aliases: string[];
};

const DEFAULT_INSURANCE_SERVICE_OPTIONS: InsuranceServiceOption[] = [
  {
    id: "auto",
    name: "Auto",
    aliases: ["auto", "carro", "carros", "vehiculo", "vehiculos", "car", "vehicle"],
  },
  {
    id: "vida",
    name: "Vida",
    aliases: ["vida", "life"],
  },
  {
    id: "casa",
    name: "Casa",
    aliases: ["casa", "hogar", "vivienda", "home", "homeowners"],
  },
  {
    id: "negocio",
    name: "Negocio",
    aliases: ["negocio", "comercial", "empresa", "business", "commercial"],
  },
];

function safeStr(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeText(input: string): string {
  return safeStr(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => safeStr(value)).filter(Boolean))];
}

export function getInsuranceServiceOptions(services: unknown): InsuranceServiceOption[] {
  if (!Array.isArray(services) || services.length === 0) return DEFAULT_INSURANCE_SERVICE_OPTIONS;
  return services
    .map((service, index): InsuranceServiceOption | null => {
      if (!service || typeof service !== "object") return null;
      const row = service as Record<string, unknown>;
      const name = safeStr(
        row.name,
        safeStr(row.title, safeStr(row.label, safeStr(row.service_name, ""))),
      );
      if (!name) return null;
      const id = safeStr(row.id, safeStr(row.key, normalizeText(name).replace(/\s+/g, "_")));
      const rawAliases = Array.isArray(row.aliases) ? row.aliases : [];
      const aliases = unique([
        name,
        safeStr(row.key),
        safeStr(row.type),
        ...rawAliases.map((alias) => safeStr(alias)),
      ]);
      return { id: id || `insurance_${index + 1}`, name, aliases };
    })
    .filter((option): option is InsuranceServiceOption => Boolean(option));
}

export function resolveInsuranceServiceOption(
  text: string,
  options: InsuranceServiceOption[],
): InsuranceServiceOption | null {
  const actionId = normalizeText(text).replace(/^action:/, "");
  const actionMatch = actionId.match(/^insurance_type:([a-z0-9_-]+)$/i);
  if (actionMatch) {
    const selectedId = actionMatch[1];
    const byId = options.find((option) => actionSafeId(option.id) === selectedId);
    if (byId) return byId;
  }
  const normalized = normalizeText(text);
  if (!normalized) return null;
  return options.find((option) =>
    option.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias && new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`, "i").test(normalized);
    })
  ) ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function actionSafeId(value: string): string {
  return normalizeText(value).replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}

function insuranceTypeEmoji(option: InsuranceServiceOption): string {
  const values = [option.id, option.name, ...option.aliases].map(normalizeText);
  if (values.some((value) => ["auto", "carro", "carros", "vehiculo", "vehiculos", "car", "vehicle"].includes(value))) {
    return "🚗";
  }
  if (values.some((value) => ["vida", "life"].includes(value))) return "❤️";
  if (values.some((value) => ["casa", "hogar", "vivienda", "home", "homeowners"].includes(value))) return "🏠";
  if (values.some((value) => ["negocio", "comercial", "empresa", "business", "commercial"].includes(value))) {
    return "🏢";
  }
  return "";
}

export function buildInsuranceTypeButtons(options: InsuranceServiceOption[]): InteractiveButton[] {
  return options.slice(0, 3).map((option) => ({
    id: `insurance_type:${actionSafeId(option.id)}`,
    title: `${insuranceTypeEmoji(option)} ${option.name}`.trim().slice(0, 20),
  }));
}

export function buildInsuranceTypeList(options: InsuranceServiceOption[], agencyName?: string): WhatsAppInteractiveListSpec | undefined {
  if (!options.length) return undefined;
  return {
    body: composeInsuranceTypePrompt(options, agencyName),
    buttonText: "Ver opciones",
    sections: [
      {
        title: "Tipos de seguro",
        rows: options.slice(0, 10).map((option) => ({
          id: `insurance_type:${actionSafeId(option.id)}`,
          title: `${insuranceTypeEmoji(option)} ${option.name}`.trim().slice(0, 24),
        })),
      },
    ],
  };
}

export function buildInsuranceCurrentCoverageButtons(): InteractiveButton[] {
  return [
    { id: "insurance_current:vence_pronto", title: "Vence pronto" },
    { id: "insurance_current:comparando", title: "Ya tengo, comparo" },
    { id: "insurance_current:no_tiene", title: "No tengo" },
  ];
}

export function buildInsuranceBudgetButtons(): InteractiveButton[] {
  return [
    { id: "insurance_budget:under_50", title: "Menos de $50" },
    { id: "insurance_budget:50_100", title: "$50-100" },
    { id: "insurance_budget:100_200_plus", title: "$100-200+" },
  ];
}

export function buildInsurancePreferredTimeButtons(): InteractiveButton[] {
  return [
    { id: "insurance_time:early", title: "Temprano (8am-12pm)" },
    { id: "insurance_time:afternoon", title: "Tarde (12pm-5pm)" },
    { id: "insurance_time:any", title: "Cuando pueda" },
  ];
}

export function buildInsuranceClosedActionButtons(): InteractiveButton[] {
  return [
    { id: "insurance_closed:quote_other", title: "Cotizar otro seguro" },
    { id: "insurance_closed:advisor", title: "Hablar con asesor" },
    { id: "insurance_closed:done", title: "Listo, gracias" },
  ];
}

export function composeInsuranceTypePrompt(_options: InsuranceServiceOption[], agencyName?: string): string {
  const agency = safeStr(agencyName, "nuestra agencia");
  return `¡Hola! 👋 Bienvenido a ${agency}. Te hago algunas preguntas rápidas para conectarte con el asesor que mejor te puede ayudar. ¿Qué tipo de seguro te interesa?`;
}

export function composeInsuranceNamePrompt(): string {
  return "Perfecto. ¿Cómo te llamás?";
}

export function composeInsuranceContactPrompt(typeName: string): string {
  const selectedType = safeStr(typeName);
  return selectedType ? `Perfecto, seguro de ${selectedType}. ¿Cómo te llamás?` : composeInsuranceNamePrompt();
}

export function composeInsuranceLocationPrompt(name?: string): string {
  const leadName = safeStr(name);
  return leadName ? `¿En qué estado estás, ${leadName}?` : "¿En qué estado estás?";
}

export function composeInsuranceEmailPrompt(): string {
  return "¿Tu correo? Ahí te llega la info de tu asesor.";
}

export function composeInsuranceCurrentCoveragePrompt(): string {
  return "¿Tu seguro actual vence pronto, o estás recién comparando opciones?";
}

export function composeInsuranceBudgetPrompt(): string {
  return "¿Más o menos qué presupuesto mensual tenés pensado?";
}

export function composeInsurancePreferredTimePrompt(): string {
  return "Última pregunta: ¿en qué horario preferís que te llamen?";
}

export function composeInsuranceConfirmation(args: {
  typeName: string;
  contact: Record<string, unknown>;
  currentInsurance: string;
  budget: string;
  preferredTime: string;
  priority?: "alta" | "media" | "baja";
}): string {
  const leadName = safeStr(args.contact.nombre);
  const followUp = args.priority === "alta"
    ? "🚀 Un asesor te contacta en la próxima hora."
    : args.priority === "media"
    ? "⏱️ Un asesor te contacta hoy mismo."
    : "📩 Un asesor te contacta pronto.";
  return `✅ *Solicitud recibida${leadName ? `, ${leadName}` : ""}*\n\n🚗 *Tipo de seguro:* ${args.typeName}\n🙋 *Nombre:* ${
    safeStr(args.contact.nombre)
  }\n📍 *Estado:* ${safeStr(args.contact.estado)}\n✉️ *Correo:* ${
    safeStr(args.contact.email)
  }\n🛡️ *Seguro actual:* ${args.currentInsurance}\n💵 *Presupuesto mensual:* ${args.budget}\n🕒 *Horario preferido:* ${args.preferredTime}\n\n${followUp} 🎉`;
}
