export const fmt = {
  money: (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
  num: (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }),
  pct: (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`,
  price: (n: number, symbol?: string) => {
    if (!symbol) return n.toFixed(5);
    if (symbol === "XAUUSD") return n.toFixed(2);
    if (symbol?.endsWith("JPY")) return n.toFixed(3);
    return n.toFixed(5);
  },
};

export const SYMBOLS = [
  "XAUUSD",
  // Majors
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
  // JPY crosses
  "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY",
  // EUR crosses
  "EURGBP", "EURAUD", "EURCAD", "EURCHF", "EURNZD",
  // GBP crosses
  "GBPAUD", "GBPCAD", "GBPCHF", "GBPNZD",
  // Others
  "AUDCAD", "AUDCHF", "AUDNZD", "NZDCAD", "NZDCHF", "CADCHF",
] as const;
export type Symbol = (typeof SYMBOLS)[number];
