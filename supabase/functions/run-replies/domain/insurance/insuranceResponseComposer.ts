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

export function buildInsuranceTypeButtons(options: InsuranceServiceOption[]): InteractiveButton[] {
  return options.slice(0, 3).map((option) => ({
    id: `insurance_type:${actionSafeId(option.id)}`,
    title: option.name.slice(0, 20),
  }));
}

export function buildInsuranceTypeList(options: InsuranceServiceOption[]): WhatsAppInteractiveListSpec | undefined {
  if (!options.length) return undefined;
  return {
    body: "Hola. Te ayudo con tu seguro. Elegí el tipo de seguro que estás buscando.",
    buttonText: "Ver opciones",
    sections: [
      {
        title: "Tipos de seguro",
        rows: options.slice(0, 10).map((option) => ({
          id: `insurance_type:${actionSafeId(option.id)}`,
          title: option.name.slice(0, 24),
        })),
      },
    ],
  };
}

export function buildInsuranceCurrentCoverageButtons(): InteractiveButton[] {
  return [
    { id: "insurance_current:yes", title: "Sí" },
    { id: "insurance_current:no", title: "No" },
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

export function composeInsuranceTypePrompt(options: InsuranceServiceOption[]): string {
  if (!options.length) return "Hola. Te ayudo con tu seguro. ¿Qué tipo de seguro estás buscando?";
  const list = options.map((option) => `• ${option.name}`).join("\n");
  return `Hola. Te ayudo con tu seguro. ¿Qué tipo de seguro estás buscando?\n\n${list}`;
}

export function composeInsuranceNamePrompt(): string {
  return "Perfecto. ¿Cuál es tu nombre completo?";
}

export function composeInsuranceLocationPrompt(): string {
  return "¿En qué estado o ciudad estás?";
}

export function composeInsuranceEmailPrompt(): string {
  return "¿Cuál es tu email?";
}

export function composeInsuranceCurrentCoveragePrompt(): string {
  return "¿Tenés seguro actualmente?";
}

export function composeInsuranceBudgetPrompt(): string {
  return "¿Qué presupuesto mensual tenés en mente?";
}

export function composeInsurancePreferredTimePrompt(): string {
  return "¿Qué horario preferís para que te contacten?";
}

export function composeInsuranceConfirmation(args: {
  typeName: string;
  contact: Record<string, unknown>;
  currentInsurance: string;
  budget: string;
  preferredTime: string;
  priority?: "alta" | "media" | "baja";
}): string {
  const followUp = args.priority === "alta"
    ? "Un asesor te contacta en la próxima hora."
    : args.priority === "media"
    ? "Un asesor te contacta hoy mismo."
    : "Un asesor te contacta pronto.";
  return `Listo, guardé tu solicitud.\n\nTipo de seguro: ${args.typeName}\nNombre: ${
    safeStr(args.contact.nombre)
  }\nEstado: ${safeStr(args.contact.estado)}\nTeléfono: ${
    safeStr(args.contact.telefono)
  }\nEmail: ${safeStr(args.contact.email)}\nSeguro actual: ${args.currentInsurance}\nPresupuesto: ${args.budget}\nHorario preferido: ${args.preferredTime}\n\n${followUp}`;
}
