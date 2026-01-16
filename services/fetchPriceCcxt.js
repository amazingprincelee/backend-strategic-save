import ccxt from "ccxt";

const selectedExchanges = ["apex", "arkham", "aster", "backpack", "bequant", "bigone", "bit2c", "bitstamp", "blofin", "btcmarkets", "cex", "coincheck", "coinmate", "coinspot", "defx", "dydx", "foxbit", "gate", "gateio", "hibachi", "huobi", "hyperliquid", "independentreserve", "lbank", "mercado", "modetrade", "ndax", "onetrading", "p2b", "paradex", "paymium", "poloniex", "timex", "wavesexchange", "woo", "woofipro", "zonda"]


export const fetchCcxtPrice = async (exchangeList) => {
  for (const id of exchangeList) {   // <-- FIXED HERE
    try {
      if (!ccxt[id]) {
        console.log(id, "not supported by CCXT");
        continue;
      }

      const exchange = new ccxt[id]();

      const markets = await exchange.loadMarkets();

      console.log(id, "markets loaded:");
    } catch (error) {
      console.log(id, "error:", error.message);
    }
  }
};

fetchCcxtPrice(selectedExchanges);
