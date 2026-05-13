export type BarbershopPriceType = "fixed" | "from" | "variable";

export type BarbershopService = {
  id: string;
  name: string;
  aliases: string[];
  durationMinutes: number;
  priceType: BarbershopPriceType;
  basePriceHnl?: number;
};

export type DetectedBarbershopRequest = {
  matchedService: BarbershopService | null;
  preferredBarber: string | null;
  confidence: number;
};
