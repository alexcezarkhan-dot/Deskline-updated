// DeskTerminal — shared instrument metadata.
// Every /forex, /commodities, /crypto, /indices page reads from this single
// config so nothing is duplicated across pages (per project architecture).
window.INSTRUMENTS = {
  'eur-usd': {
    category: 'forex', name: 'EUR/USD', fullName: 'Euro vs US Dollar',
    tvSymbol: 'FX:EURUSD', priceSource: 'frankfurter', base: 'EUR', quote: 'USD',
    newsKeywords: ['EUR/USD','euro','ECB','eurozone'], calendarCountries: ['EUR','USD'],
    related: [
      { key:'gbp-usd', cat:'forex', label:'GBP/USD' },
      { key:'usd-jpy', cat:'forex', label:'USD/JPY' },
      { key:'gold', cat:'commodities', label:'Gold' },
    ],
    session: 'forex',
  },
  'gbp-usd': {
    category: 'forex', name: 'GBP/USD', fullName: 'British Pound vs US Dollar',
    tvSymbol: 'FX:GBPUSD', priceSource: 'frankfurter', base: 'GBP', quote: 'USD',
    newsKeywords: ['GBP/USD','pound','sterling','Bank of England','BoE'], calendarCountries: ['GBP','USD'],
    related: [
      { key:'eur-usd', cat:'forex', label:'EUR/USD' },
      { key:'usd-jpy', cat:'forex', label:'USD/JPY' },
      { key:'gold', cat:'commodities', label:'Gold' },
    ],
    session: 'forex',
  },
  'usd-jpy': {
    category: 'forex', name: 'USD/JPY', fullName: 'US Dollar vs Japanese Yen',
    tvSymbol: 'FX:USDJPY', priceSource: 'frankfurter', base: 'USD', quote: 'JPY',
    newsKeywords: ['USD/JPY','yen','Bank of Japan','BoJ'], calendarCountries: ['USD','JPY'],
    related: [
      { key:'eur-usd', cat:'forex', label:'EUR/USD' },
      { key:'usd-cad', cat:'forex', label:'USD/CAD' },
      { key:'gold', cat:'commodities', label:'Gold' },
    ],
    session: 'forex',
  },
  'usd-cad': {
    category: 'forex', name: 'USD/CAD', fullName: 'US Dollar vs Canadian Dollar',
    tvSymbol: 'FX:USDCAD', priceSource: 'frankfurter', base: 'USD', quote: 'CAD',
    newsKeywords: ['USD/CAD','loonie','Bank of Canada','crude oil'], calendarCountries: ['USD','CAD'],
    related: [
      { key:'usd-jpy', cat:'forex', label:'USD/JPY' },
      { key:'crude-oil', cat:'commodities', label:'Crude Oil' },
      { key:'gold', cat:'commodities', label:'Gold' },
    ],
    session: 'forex',
  },
  'gold': {
    category: 'commodities', name: 'Gold (XAUUSD)', fullName: 'Gold Spot / US Dollar',
    tvSymbol: 'OANDA:XAUUSD', priceSource: 'goldapi', goldApiCode: 'XAU',
    newsKeywords: ['gold','XAUUSD','bullion','safe haven'], calendarCountries: ['USD'],
    related: [
      { key:'silver', cat:'commodities', label:'Silver' },
      { key:'eur-usd', cat:'forex', label:'EUR/USD' },
      { key:'bitcoin', cat:'crypto', label:'Bitcoin' },
    ],
    session: 'commodities',
  },
  'silver': {
    category: 'commodities', name: 'Silver (XAGUSD)', fullName: 'Silver Spot / US Dollar',
    tvSymbol: 'OANDA:XAGUSD', priceSource: 'goldapi', goldApiCode: 'XAG',
    newsKeywords: ['silver','XAGUSD','precious metals'], calendarCountries: ['USD'],
    related: [
      { key:'gold', cat:'commodities', label:'Gold' },
      { key:'eur-usd', cat:'forex', label:'EUR/USD' },
      { key:'bitcoin', cat:'crypto', label:'Bitcoin' },
    ],
    session: 'commodities',
  },
  'crude-oil': {
    category: 'commodities', name: 'Crude Oil (WTI)', fullName: 'WTI Crude Oil Futures',
    tvSymbol: 'TVC:USOIL', priceSource: 'none',
    newsKeywords: ['crude oil','WTI','OPEC','oil price'], calendarCountries: ['USD'],
    related: [
      { key:'usd-cad', cat:'forex', label:'USD/CAD' },
      { key:'gold', cat:'commodities', label:'Gold' },
      { key:'sp500', cat:'indices', label:'S&P 500' },
    ],
    session: 'commodities',
  },
  'bitcoin': {
    category: 'crypto', name: 'Bitcoin (BTC)', fullName: 'Bitcoin / US Dollar',
    tvSymbol: 'BITSTAMP:BTCUSD', priceSource: 'binance', binanceSymbol: 'BTCUSDT',
    newsKeywords: ['bitcoin','BTC','crypto'], calendarCountries: ['USD'],
    related: [
      { key:'ethereum', cat:'crypto', label:'Ethereum' },
      { key:'gold', cat:'commodities', label:'Gold' },
      { key:'sp500', cat:'indices', label:'S&P 500' },
    ],
    session: 'crypto',
  },
  'ethereum': {
    category: 'crypto', name: 'Ethereum (ETH)', fullName: 'Ethereum / US Dollar',
    tvSymbol: 'BITSTAMP:ETHUSD', priceSource: 'binance', binanceSymbol: 'ETHUSDT',
    newsKeywords: ['ethereum','ETH','crypto'], calendarCountries: ['USD'],
    related: [
      { key:'bitcoin', cat:'crypto', label:'Bitcoin' },
      { key:'gold', cat:'commodities', label:'Gold' },
      { key:'sp500', cat:'indices', label:'S&P 500' },
    ],
    session: 'crypto',
  },
  'sp500': {
    category: 'indices', name: 'S&P 500', fullName: 'S&P 500 Index',
    tvSymbol: 'FOREXCOM:SPXUSD', priceSource: 'none',
    newsKeywords: ['S&P 500','stock market','Wall Street'], calendarCountries: ['USD'],
    related: [
      { key:'nasdaq', cat:'indices', label:'Nasdaq' },
      { key:'bitcoin', cat:'crypto', label:'Bitcoin' },
      { key:'gold', cat:'commodities', label:'Gold' },
    ],
    session: 'indices',
  },
  'nasdaq': {
    category: 'indices', name: 'Nasdaq 100', fullName: 'Nasdaq 100 Index',
    tvSymbol: 'FOREXCOM:NSXUSD', priceSource: 'none',
    newsKeywords: ['Nasdaq','tech stocks','Wall Street'], calendarCountries: ['USD'],
    related: [
      { key:'sp500', cat:'indices', label:'S&P 500' },
      { key:'bitcoin', cat:'crypto', label:'Bitcoin' },
      { key:'gold', cat:'commodities', label:'Gold' },
    ],
    session: 'indices',
  },
};
