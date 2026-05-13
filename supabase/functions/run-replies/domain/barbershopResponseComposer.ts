export function composeBarbershopNaturalFallback(args: {
  nextExpected?: string | null;
}): string {
  const nextExpected = String(args.nextExpected ?? "");
  if (nextExpected === "date_time") {
    return "Decime el día y la hora para revisar.";
  }
  if (nextExpected === "barber_preference") {
    return "¿Querés con algún barbero en especial o con cualquiera?";
  }
  return "No te entendí completo. Podés escribirme algo como: quiero cita mañana a las 5.";
}

