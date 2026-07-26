export type InsuranceFaqEntry = {
  tipo_seguro: "auto" | "vida" | "casa" | "negocio";
  keywords: string[];
  answer: string;
};

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

export const INSURANCE_FAQ_ENTRIES: InsuranceFaqEntry[] = [
  {
    tipo_seguro: "auto",
    keywords: ["accidente", "accidentes", "fuera del estado", "otro estado", "cualquier estado"],
    answer:
      "Sí, la mayoría de nuestras pólizas de auto cubren accidentes en cualquier estado de USA. Tu asesor te confirma los detalles exactos según la aseguradora que elijas.",
  },
  {
    tipo_seguro: "auto",
    keywords: ["otro conductor", "sin seguro", "uninsured motorist", "no tiene seguro", "suficiente cobertura"],
    answer:
      'Podés agregar cobertura de "motorista sin seguro" (uninsured motorist) a tu póliza — te protege incluso si el otro conductor no tiene seguro o no tiene suficiente cobertura.',
  },
  {
    tipo_seguro: "auto",
    keywords: ["reclamo", "reclamos", "cuanto tarda", "cuánto tarda", "procesarse", "documentacion", "documentación"],
    answer:
      "Depende de la aseguradora y la complejidad del caso, pero generalmente entre 3 y 15 días hábiles una vez que entregás toda la documentación.",
  },
  {
    tipo_seguro: "auto",
    keywords: ["otros conductores", "otro conductor", "mi carro", "conductores ocasionales", "conductores frecuentes", "familia"],
    answer:
      "En general sí, si son conductores ocasionales y están dentro de tu hogar. Para conductores frecuentes que no son parte de tu familia, tu asesor puede necesitar agregarlos explícitamente a la póliza.",
  },
  {
    tipo_seguro: "auto",
    keywords: ["deducible", "deducibles", "pago mensual", "monto que pago"],
    answer:
      "Es el monto que pagás vos antes de que el seguro cubra el resto. A mayor deducible, menor tu pago mensual — tu asesor te ayuda a encontrar el balance que te convenga.",
  },
  {
    tipo_seguro: "vida",
    keywords: ["edad", "a que edad", "qué edad", "cuando sacar", "cuándo sacar", "prima"],
    answer:
      "Cuanto antes, más barata la prima — pero nunca es tarde. Muchas personas lo sacan al tener hijos, comprar casa, o empezar un negocio.",
  },
  {
    tipo_seguro: "vida",
    keywords: ["temporal", "term", "vida entera", "whole life", "diferencia", "valor en efectivo"],
    answer:
      "El temporal cubre un período fijo (10, 20, 30 años) y es más económico. El de vida entera dura toda tu vida y acumula valor en efectivo, pero cuesta más. Tu asesor te ayuda a elegir según tu situación.",
  },
  {
    tipo_seguro: "vida",
    keywords: ["examen medico", "examen médico", "monto de cobertura", "edad", "aseguradoras no lo piden"],
    answer:
      "Depende del monto de cobertura y tu edad. Para montos más chicos, muchas aseguradoras no lo piden.",
  },
  {
    tipo_seguro: "vida",
    keywords: ["beneficiario", "beneficiarios", "cambiar beneficiario", "costo adicional"],
    answer:
      "Sí, en cualquier momento, sin costo adicional en la mayoría de los casos.",
  },
  {
    tipo_seguro: "vida",
    keywords: ["cuanta cobertura", "cuánta cobertura", "cobertura necesito", "cuanto cubren", "cuánto cubren", "cuanto cubre", "cuánto cubre", "ingreso anual", "dependientes", "deudas"],
    answer:
      "Una regla común es entre 5 y 10 veces tu ingreso anual, pero depende de tus deudas, dependientes, y objetivos — tu asesor te ayuda a calcularlo.",
  },
  {
    tipo_seguro: "casa",
    keywords: ["inundacion", "inundación", "inundaciones", "zona de riesgo", "poliza basica", "póliza básica"],
    answer:
      "Generalmente no está incluido en la póliza básica — es una cobertura aparte que se puede agregar, especialmente importante si estás en zona de riesgo.",
  },
  {
    tipo_seguro: "casa",
    keywords: ["pertenencias", "contenido", "muebles", "electronica", "electrónica", "ropa", "joyas", "arte"],
    answer:
      "Sí, la mayoría de las pólizas incluyen cobertura de contenido (muebles, electrónica, ropa) hasta un límite — objetos de alto valor (joyas, arte) a veces necesitan cobertura adicional.",
  },
  {
    tipo_seguro: "casa",
    keywords: ["alquilo", "rento", "landlord", "casa alquilada", "no vivo en ella"],
    answer:
      'Necesitás una póliza distinta ("landlord insurance"), no la póliza de casa habitada — tu asesor te orienta sobre cuál te corresponde.',
  },
  {
    tipo_seguro: "casa",
    keywords: ["robo", "robos", "danos por robo", "daños por robo", "estructura"],
    answer:
      "Sí, la cobertura estándar de casa generalmente incluye robo, tanto de la estructura como de tus pertenencias.",
  },
  {
    tipo_seguro: "casa",
    keywords: ["inquilino", "renters", "renters insurance", "seguro de inquilino", "dueño"],
    answer:
      "Sí — el seguro del dueño cubre el edificio, no tus pertenencias. El seguro de inquilino (renters insurance) es aparte y suele ser bastante económico.",
  },
  {
    tipo_seguro: "negocio",
    keywords: ["responsabilidad civil", "demanda", "gastos legales", "cliente", "proveedor", "tercero"],
    answer:
      "Te protege si un cliente, proveedor, o tercero sufre un daño o pérdida relacionada con tu negocio y te demanda — cubre gastos legales y compensación.",
  },
  {
    tipo_seguro: "negocio",
    keywords: ["trabajo desde casa", "desde casa", "actividad comercial", "poliza de negocio", "póliza de negocio"],
    answer:
      "Sí, en la mayoría de los casos — el seguro de tu casa no cubre actividad comercial, así que necesitás una póliza de negocio separada, aunque sea pequeña.",
  },
  {
    tipo_seguro: "negocio",
    keywords: ["empleados", "workers comp", "compensacion laboral", "compensación laboral", "lesiones", "obligatorio"],
    answer:
      "El seguro de compensación laboral (workers' comp) es el que cubre lesiones de empleados en el trabajo — es distinto a la responsabilidad civil general, y en muchos estados es obligatorio si tenés empleados.",
  },
  {
    tipo_seguro: "negocio",
    keywords: ["cerrar temporalmente", "desastre", "interrupcion de negocio", "interrupción de negocio", "ingresos perdidos"],
    answer:
      'Existe cobertura de "interrupción de negocio" que reemplaza ingresos perdidos durante el cierre — se puede agregar según tu rubro y riesgo.',
  },
  {
    tipo_seguro: "negocio",
    keywords: ["inventario", "equipo", "maquinaria", "propiedad comercial", "incendio", "robo"],
    answer:
      "Sí, generalmente como parte de la cobertura de propiedad comercial — cubre daño o pérdida de inventario, maquinaria, y equipo por eventos como incendio o robo.",
  },
];

export function findInsuranceFaqMatch(args: {
  text: string;
  tipoSeguroId?: string | null;
}): InsuranceFaqEntry | null {
  const normalized = normalizeText(args.text);
  if (!normalized) return null;
  const type = normalizeText(safeStr(args.tipoSeguroId));
  const entries = type
    ? [
      ...INSURANCE_FAQ_ENTRIES.filter((entry) => entry.tipo_seguro === type),
      ...INSURANCE_FAQ_ENTRIES.filter((entry) => entry.tipo_seguro !== type),
    ]
    : INSURANCE_FAQ_ENTRIES;
  return entries.find((entry) =>
    entry.keywords.some((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      return normalizedKeyword && normalized.includes(normalizedKeyword);
    })
  ) ?? null;
}
