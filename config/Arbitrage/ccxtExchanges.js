import ccxt from "ccxt";

// const selectedExchanges = [
//   "apex",
//   "arkham",
//   "aster",
//   "backpack",
//   "bequant",
//   "bigone",
//   "bit2c",
//   "bitstamp",
//   "blofin",
//   "btcmarkets",
//   "cex",
//   "coincheck",
//   "coinmate",
//   "coinspot",
//   "defx",
//   "dydx",
//   "foxbit",
//   "gate",
//   "gateio",
//   "hibachi",
//   "huobi",
//   "hyperliquid",
//   "independentreserve",
//   "lbank",
//   "mercado",
//   "modetrade",
//   "ndax",
//   "onetrading",
//   "p2b",
//   "paradex",
//   "paymium",
//   "poloniex",
//   "timex",
//   "wavesexchange",
//   "woo",
//   "woofipro",
//   "zonda",
// ];

export const exchanges = {
  lbank: new ccxt.lbank(),
  gateio: new ccxt.gateio(),
  bigone: new ccxt.bigone(),
};

console.log("Exchanges instantiated:", Object.keys(exchanges));
