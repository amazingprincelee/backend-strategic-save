import { exchanges } from '../../config/Arbitrage/ccxtExchanges.js';







// with order 

export async function fetchPrices(symbol) { 
  const prices = [];
  for (const [name, exchange] of Object.entries(exchanges)) {
    try {
      // Fetch ticker and orderBook in parallel
      const [ticker, orderBook] = await Promise.all([
        exchange.fetchTicker(symbol),
        exchange.fetchOrderBook(symbol, 10)
      ]);
      
      prices.push({
        exchange: name,
        bids: orderBook.bids.slice(0, 2), 
        asks: orderBook.asks.slice(0, 2), 
        last: ticker.last,
        volume: ticker.quoteVolume || 0,
      });
    } catch (err) {
      console.log(`Error fetching ${symbol} from ${name}:`, err.message);
    }
  }
  return prices;
}

// Test it and log the results
const prices = await fetchPrices('BTC/USDT');
console.log('Prices:', JSON.stringify(prices, null, 2));



// export async function fetchPrices(symbol) { 
//   const prices = [];
//   for (const [name, exchange] of Object.entries(exchanges)) {
//     try {
//       const ticker = await exchange.fetchTicker(symbol);
//       prices.push({
//         exchange: name,
//         bid: ticker.bid,
//         ask: ticker.ask,
//         last: ticker.last,
//         volume: ticker.quoteVolume,
//       });
//     } catch (err) {
//       console.log("Error fetching prices", err);
      
//     }
//   }
//   return prices;
// }

// // Test it and log the results
// const prices = await fetchPrices('BTC/USDT');
// console.log('Prices:', prices)