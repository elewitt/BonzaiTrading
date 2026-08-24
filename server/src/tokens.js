/**
 * Token registry for Longview.
 * xStock Solana mints are pinned from the official xstocks.fi product list.
 * Ondo Global Markets ("Ondo Stocks") mints are pinned from Jupiter's own
 * verified token list, filtered and cross-checked as documented at ONDO_RAW
 * below (Ondo has no public mint-address API without a developer key).
 * Using pinned mints avoids copycat-token risk and removes the need for
 * runtime Jupiter symbol searches.
 */

const JUP_BASE = process.env.JUPITER_BASE_URL || "https://lite-api.jup.ag";
const JUP_KEY  = process.env.JUPITER_API_KEY  || "";

export const USDC = {
  symbol: "USDC", name: "USD Coin",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6,
};

// Pinned by mint — many USDY copycats exist on Solana.
export const USDY = {
  symbol: "USDY", name: "US Dollar Yield",
  mint: "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6", decimals: 6, category: "yield",
};

// Etherfuse Stablebonds — tokenized sovereign treasury bonds, each backed
// 1:1 by the real underlying bond and held via regulated custodians (e.g.
// INDEVAL for CETES — see app.etherfuse.com/legal). Verified directly
// on-chain before pinning: real Token-2022 mints with InterestBearingConfig
// + MetadataPointer extensions (no PermanentDelegate or TransferHook — the
// two dangerous Token-2022 extensions that let an issuer move or intercept
// a holder's tokens), Metaplex metadata naming Etherfuse as issuer with a
// working app.etherfuse.com/bonds/{slug} product page, and live Jupiter
// swap routes with real holder counts (41-4,102 each, confirmed via
// Jupiter's own token API). Etherfuse itself is independently documented —
// founded 2021, presented at Solana Breakpoint 2023, covered by CoinGecko/
// CoinMarketCap/Coinbase and Solana's own official media.
//
// UNLIKE USDY, these carry real currency exposure on top of the sovereign
// yield — a Tesouro's price moves with BRL, not just with interest rates —
// so they deliberately do NOT get USDY's cash-equivalent treatment
// anywhere (Yield Mode's auto-sweep, portfolio cash-bucketing, or the
// "$1 per unit" withdrawal shortcut all stay USDY-only; grep each of those
// for "USDY" before extending). `category: "yield"` here only drives
// discoverability (the Yield filter/badge, AI-prompt awareness) — it does
// not imply cash-equivalence.
export const KTB = {
  symbol: "KTB", name: "Korean Treasury Bond",
  mint: "KTBeXe7VMPMLxBsqDQu4KA9PdSajF3Hkw1y9qRsKqfL", decimals: 6, category: "yield",
};
export const CETES = {
  symbol: "CETES", name: "Mexican CETES",
  mint: "CETES7CKqqKQizuSN6iWQwmTeFRjbJR6Vw2XRKfEDR8f", decimals: 6, category: "yield",
};
export const TESOURO = {
  symbol: "TESOURO", name: "Brazilian Tesouro",
  mint: "BRNTNaZeTJANz9PeuD8drNbBHwGgg7ZTjiQYrFgWQ48p", decimals: 6, category: "yield",
};
export const GILTS = {
  symbol: "GILTS", name: "UK Gilts",
  mint: "GiLTSeSFnNse7xQVYeKdMyckGw66AoRmyggGg1NNd4yr", decimals: 6, category: "yield",
};

// Coinbase Wrapped BTC — verified against Jupiter's token list before pinning
// (isVerified: true, "verified" tag, ~$21M liquidity, 69k+ holders, tracked
// since Oct 2024). Displayed simply as "Bitcoin" / BTC in the app.
export const BTC = {
  symbol: "BTC", name: "Bitcoin",
  mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", decimals: 8, category: "crypto",
};

// Circle's Euro stablecoin — verified against Jupiter's token list before
// pinning (isVerified: true, "verified"/"stable" tags, circle.com icon,
// price tracking EUR/USD). Displayed as "Euro" / EURC.
export const EURC = {
  symbol: "EURC", name: "Euro",
  mint: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr", decimals: 6, category: "currency",
};

// All xStock assets — mints pinned from xstocks.fi/us/products (July 2026).
// decimals: 8 for all xStocks (Backed standard). 69 removed 2026-08-24: 35 had
// no liquidity at a $1,000 benchmark and no Ondo-issued equivalent exists yet
// (see ONDO_RAW below for the 34 that did have one, swapped in instead) —
// confirmed via a real Jupiter Ultra sweep, not the classic AMM-only quote
// endpoint (which misses RFQ-routed liquidity entirely for both xStocks and
// Ondo's Transfer-Hook-gated Token-2022 mints).
const XSTOCKS_RAW = {
  AAPLx:  { name: "Apple",                              mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  ABBVx:  { name: "AbbVie",                             mint: "XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie" },
  ABTx:   { name: "Abbott",                             mint: "XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7" },
  ADBEx:  { name: "Adobe",                              mint: "XsDZMGEU8zadWFCkTtPBoPWYcUX3JHVmghnwf2Mve2q" },
  AMDx:   { name: "AMD",                                mint: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF" },
  AMZNx:  { name: "Amazon",                             mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  APPx:   { name: "AppLovin",                           mint: "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV" },
  ASMLx:  { name: "ASML",                               mint: "XshuHQ6o6SVpUNawvnnTMxsZ4tacZsNgVCLorv7TkFq" },
  AVGOx:  { name: "Broadcom",                           mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo" },
  AZNx:   { name: "AstraZeneca",                        mint: "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU" },
  BACx:   { name: "Bank of America",                    mint: "XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP" },
  BMNRx:  { name: "Bitmine",                            mint: "XsrBCwaH8c46xiqXBChzobgufRKxQxAWUWbndgBNzFn" },
  "BRK.Bx": { name: "Berkshire Hathaway",               mint: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x" },
  BSPx:   { name: "Bending Spoons",                     mint: "XsYMHtwJcWon5GkPHzdDbCCztKtKzEurJnbydxgjsqS" },
  BTBTx:  { name: "Bit Digital",                        mint: "XsPLBFy59Q3hY59KLAJur8QyvziMF4xUxGTxXqXE7cT" },
  BTGOx:  { name: "BitGo",                              mint: "XsvHMmbDcd14DHHW16PkxPGW7ks77ehxUv1E9Zmxgj4" },
  CEGx:   { name: "Constellation Energy",               mint: "Xssu2cDLdZXZYrq17frTVrb3meumRCAzEf7pXyxoWVN" },
  CMCSAx: { name: "Comcast",                            mint: "XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8" },
  COINx:  { name: "Coinbase",                           mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" },
  COPXx:  { name: "Global X Copper Miners ETF",         mint: "XsybfiKkD4UmjkAGT2uR8X2sq9AWFtvGJM2KTffoALZ" },
  CRCLx:  { name: "Circle",                             mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  CRMx:   { name: "Salesforce",                         mint: "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN" },
  CRWDx:  { name: "CrowdStrike",                        mint: "Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw" },
  CSCOx:  { name: "Cisco",                              mint: "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf" },
  CVXx:   { name: "Chevron",                            mint: "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts" },
  DELLx:  { name: "Dell Technologies",                  mint: "Xsu7Tc5J2fVUE4H5vYAiSr34cvLJeCsYPMjAYnayQn6" },
  DHRx:   { name: "Danaher",                            mint: "Xseo8tgCZfkHxWS9xbFYeKFyMSbWEvZGFV1Gh53GtCV" },
  GLDx:   { name: "Gold ETF",                           mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re" },
  GLXYx:  { name: "Galaxy Digital",                     mint: "Xs3c2aZenyRQwXjki5MDxJEJ2km27ef2rWQMFWx7QKJ" },
  GMEx:   { name: "GameStop",                           mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc" },
  GOOGLx: { name: "Alphabet",                           mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  GSx:    { name: "Goldman Sachs",                      mint: "XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1" },
  HDx:    { name: "Home Depot",                         mint: "XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3" },
  HONx:   { name: "Honeywell",                          mint: "XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2" },
  HOODx:  { name: "Robinhood",                          mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg" },
  IBMx:   { name: "IBM",                                mint: "XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr" },
  IEMGx:  { name: "iShares Core MSCI Emerging Markets ETF", mint: "XsFnZawJdLdXfBSEt5Vw29K5vdBiHotdPLjUPafpfHs" },
  IJRx:   { name: "S&P Small Cap 600 ETF",              mint: "XsyZcb97BzETAqi9BoP2C9D196MiMNBisGMVNje2Thz" },
  INTCx:  { name: "Intel",                              mint: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM" },
  ITAx:   { name: "iShares US Aerospace & Defense ETF", mint: "XsXoAR52Q2NYFkYiNqhCq4FauvyA1tdRsrmEYNf9fuh" },
  IWMx:   { name: "Russell 2000 ETF",                   mint: "XsbELVbLGBkn7xfMfyYuUipKGt1iRUc2B7pYRvFTFu3" },
  JNJx:   { name: "Johnson & Johnson",                  mint: "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn" },
  JPMx:   { name: "JPMorgan Chase",                     mint: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C" },
  KOx:    { name: "Coca-Cola",                          mint: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ" },
  LINx:   { name: "Linde",                              mint: "XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z" },
  LLYx:   { name: "Eli Lilly",                          mint: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH" },
  MARAx:  { name: "MARA Holdings",                      mint: "XsguBZPkM9BDmxspmWe29EmrYZBv21ENcC27Pqh7grB" },
  MAx:    { name: "Mastercard",                         mint: "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC" },
  MCDx:   { name: "McDonald's",                         mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2" },
  METAx:  { name: "Meta",                               mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  MOOx:   { name: "VanEck Agribusiness ETF",            mint: "Xs72K1Ta1D5ccNy3RzSyQWGgZywWvphX78pL8WBk1Bo" },
  MRKx:   { name: "Merck",                              mint: "XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X" },
  MRVLx:  { name: "Marvell Technology",                 mint: "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA" },
  MSFTx:  { name: "Microsoft",                          mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  MSTRx:  { name: "Strategy",                           mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ" },
  MUx:    { name: "Micron Technology",                  mint: "XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav" },
  NFLXx:  { name: "Netflix",                            mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL" },
  NVDAx:  { name: "NVIDIA",                             mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  NVOx:   { name: "Novo Nordisk",                       mint: "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n" },
  ORCLx:  { name: "Oracle",                             mint: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL" },
  PALLx:  { name: "Palladium ETF",                      mint: "XsTTtPA5V19YwHKDv4xeVXNM6kdsQNJvg3MyWkRUckt" },
  PEPx:   { name: "PepsiCo",                            mint: "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF" },
  PFEx:   { name: "Pfizer",                             mint: "XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw" },
  PGx:    { name: "Procter & Gamble",                   mint: "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV" },
  PLTRx:  { name: "Palantir",                           mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4" },
  PMx:    { name: "Philip Morris",                      mint: "Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3" },
  PPLTx:  { name: "Platinum ETF",                       mint: "Xst6eFD4YT6sz9RLMysN9SyvaZWtraSdVJQGu5ZkAme" },
  PYPLx:  { name: "PayPal",                             mint: "XshWQWYVp5ff8CrAEsGmLVKD47nBWi3Ygn5v8wXK27G" },
  QQQx:   { name: "Nasdaq-100 ETF",                     mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" },
  RBLXx:  { name: "Roblox",                             mint: "Xss5RAku5EH6UViFdvW7ss9xQjwQLsrs2opPMhb3k43" },
  RIOTx:  { name: "Riot Platforms",                     mint: "Xs31mE5EiqjSHEaiX9QDKCN6NvSGCqpJ6f1FNq2wri5" },
  SBETx:  { name: "SharpLink Gaming",                   mint: "XsEoih2x6nZuUjFwzGoba6MFmtzCkzW2c4YAm6baQbq" },
  SLVx:   { name: "Silver ETF",                         mint: "XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm" },
  SMCIx:  { name: "Super Micro Computer",               mint: "XsMxAoJP47FQGLsVUvSS2QfBaHdNsd7DRU6nWRL8RSa" },
  SMHx:   { name: "VanEck Semiconductor ETF",           mint: "XstuBvLo7soZzj3beCCPonHpR3eUfPNSeQzw35Swons" },
  SNDKx:  { name: "Sandisk",                            mint: "Xswbpc8UqU6e1j9QZEWCjBMjyvz4twqD7PCy6j2e7jj" },
  SPCXx:  { name: "SpaceX",                             mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8" },
  SPYx:   { name: "S&P 500 ETF",                        mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  STRCx:  { name: "Strategy PP Variable",               mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH" },
  STRKx:  { name: "Strategy PP Fixed",                  mint: "XsaQGz41BEQkS9xAB44uvUtuXcdLJAXEU1dogEzWMZ8" },
  TBLLx:  { name: "TBLL",                               mint: "XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp" },
  TMOx:   { name: "Thermo Fisher Scientific",           mint: "Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57" },
  TMUSx:  { name: "T-Mobile",                           mint: "XswCi2U1G6Ppbw1QhG45yKb8UKuR1FKLJrquv2FZSD4" },
  TSLAx:  { name: "Tesla",                              mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  TSMx:   { name: "TSMC",                               mint: "XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV" },
  UBERx:  { name: "Uber",                               mint: "XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB" },
  UNHx:   { name: "UnitedHealth",                       mint: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe" },
  URAx:   { name: "Global X Uranium ETF",               mint: "Xsq9sEQjYiUTSZ55RrbHAzVfz8HotwFGrqgxkgiv4LB" },
  USARx:  { name: "USA Rare Earth",                     mint: "XsJJneENiaBPqqcdK1gMsfwi9cbw111azigzRYHoctX" },
  VCXx:   { name: "Fundrise Innovation Fund",           mint: "Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x" },
  VGKx:   { name: "Vanguard FTSE Europe ETF",           mint: "XsosCAu1L8Ebpr4SdBDV1EboYDRTWCH8j79UnHYzvbN" },
  VTIx:   { name: "Vanguard Total Stock Market ETF",    mint: "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9" },
  VTx:    { name: "Vanguard Total World ETF",           mint: "XsEdDDTcVGJU6nvdRdVnj53eKTrsCkvtrVfXGmUK68V" },
  Vx:     { name: "Visa",                               mint: "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p" },
  WMTx:   { name: "Walmart",                            mint: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci" },
  XLEx:   { name: "Energy Select Sector SPDR ETF",      mint: "Xs54CrhmpVp6uxZXwgSTegrRH2kShh88XFPzgf4BExu" },
  XOMx:   { name: "Exxon Mobil",                        mint: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh" },
  XOPx:   { name: "SPDR S&P Oil & Gas E&P ETF",         mint: "XsAk6BoV4kBXUM6WXodKyM21CN92G9jArwAzFvbh3LX" },
};

// Ondo Global Markets ("Ondo Stocks") assets — mints pinned from Jupiter's
// own verified token list (tokens/v2/tag?query=verified), filtered to
// tag "ondo" + icon hosted on cdn.ondo.finance, and independently
// cross-checked against a single shared mintAuthority
// (9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD) across all 442 real Ondo
// Solana tokens found this way — a copycat can't replicate that without
// Ondo's own key. decimals: 9 for all Ondo tokens (their standard, vs
// xStocks' 8). Two purposes: (1) replacing xStocks tickers above that had
// no real $1,000 liquidity but do have a working Ondo equivalent, and
// (2) tickers xStocks doesn't offer at all — see the ADD block below this
// one once populated.
const ONDO_RAW = {
  ACNon:  { name: "Accenture",                          mint: "12LxMMJYVSf4LoeqjFE47BQQNRciaH9E3nbDfjH4ondo" },
  AMATon: { name: "Applied Materials",                  mint: "7eRX747PSbVtGVx3qD5UFdkNM2BfTy86ikUiCMhondo" },
  ANETon: { name: "Arista Networks",                    mint: "Cq6QtvHpXbJWtFaiMhUDtHy8YVZ95gcD1oZ1cohondo" },
  APLDon: { name: "Applied Digital",                    mint: "B6WqvLGXdGqpw7qgxeb5EGiRZEYo2apWpQybjYuondo" },
  ASTSon: { name: "AST SpaceMobile",                    mint: "B6ry9goGNvVbhq7gWHzs3p6emJ1gLaMhu4By9TTondo" },
  BOTon:  { name: "RoboStrategy",                       mint: "b8UDyp3Yx19rcdaBUNegoojyUdhPpiPQ46bFrtQQQon" },
  CORZon: { name: "Core Scientific",                    mint: "f4ucqqnktrkdDAnwqcAAiA9Lggz6NAHJ3zFwipnondo" },
  ETNon:  { name: "Eaton",                              mint: "BpYiU1dBXU1fdB64jbR93wHEw3Y47QeRLZvUyLQondo" },
  EWYon:  { name: "iShares MSCI South Korea ETF",       mint: "C8pSaSgjkiTWixS3GM6Hxd6HKnKrgAbY9WDgfVeondo" },
  GEVon:  { name: "GE Vernova",                         mint: "CgZSv89BL58ybWfWobANKEU8nV9jYfFw23G2DZEondo" },
  HIMSon: { name: "Hims & Hers Health",                 mint: "bdh3njeo19d2TBLAKTGvCWdSoArfVw8uZBAJHY4ondo" },
  HUTon:  { name: "Hut 8",                              mint: "f7iz4BQsnjw95EUyFiBKAnKgo7oBrycfzQdtmDwondo" },
  IRENon: { name: "IREN",                               mint: "13QHuepdhtJ3urNsV9i1hdL8nQoca2G7ZaLzb5FYondo" },
  JAAAon: { name: "Janus Henderson AAA CLO ETF",        mint: "KZtqx9BJbpcGY7vdzhqPXM3ECKChxE5YhXaDiwRondo" },
  KLACon: { name: "KLA",                                mint: "149o8ppQf9SzKCKXZ4v3dzHkwumvtQSRzSEkr29uondo" },
  LITEon: { name: "Lumentum Holdings",                  mint: "YrquZHx3f6sXsnZZAQiVsyQfvHwLmn2XTkDiZ1uondo" },
  LRCXon: { name: "Lam Research",                       mint: "wFJoeEYpKg9oRhyJy6BWTT3J95gmXBLvoeikDQNondo" },
  NETon:  { name: "Cloudflare",                         mint: "ZtAY65FCh3YB9H1wkbjRxxY5nXt9VfuTTz3Mzbuondo" },
  OKLOon: { name: "Oklo",                               mint: "m6oDLvJT7rY7M1TxuLWP3pWmAPg2cCWDQR1NKiEondo" },
  ONDSon: { name: "Ondas Holdings",                     mint: "7qy1j4Mechfyr6uAST3djH4vk4kiEYC2cjEytXdondo" },
  OPENon: { name: "Opendoor Technologies",              mint: "ou1uE526v7zmUYP2qCb2LJgfXAyWAtWS9SETtr8ondo" },
  PANWon: { name: "Palo Alto Networks",                 mint: "M7hVQomhw4Q2D2op3HvBrZjHu9SryjNvD5haEZ1ondo" },
  PLon:   { name: "Planet Labs",                        mint: "aq2zXUHqx7Zk6HSJH2GYsNajQJZj9f3dV7gAzfuondo" },
  PWRon:  { name: "Quanta Services",                    mint: "f1yQz2fo7S24NqrsfaWDkmQ8xoa8yU72c9rEEBdondo" },
  SATAon: { name: "Strive Series A Preferred",          mint: "vZVGEJfSM1hS4XdFVAZL2Fr1cbPzJty9vWyax68ondo" },
  SGOVon: { name: "iShares 0-3 Month Treasury Bond ETF", mint: "HjrN6ChZK2QRL6hMXayjGPLFvxhgjwKEy135VRjondo" },
  SMRon:  { name: "NuScale Power",                      mint: "bGy2covWNf5qyzoNdV1pWXuLmFi6Dq927o7JXzWondo" },
  SOXLon: { name: "Direxion Daily Semi Bull 3X ETF",    mint: "isRSJECP9yFPv9YejzGUdjzAGHbF2x5DpVeDqAiondo" },
  SOXXon: { name: "iShares Semiconductor ETF",          mint: "EN5pHc1LccUSojxb7kkyQi7v7iJN5RpDq6qz3DHondo" },
  TERon:  { name: "Teradyne",                           mint: "ahvtJqt6pkzjnYTMaCKrvjPQszSKyWraiXKvuWKondo" },
  TQQQon: { name: "ProShares UltraPro QQQ",             mint: "14W1itEkV7k1W819mLSknFTaMmkCtPokbF2tRkPUondo" },
  UUUUon: { name: "Energy Fuels",                       mint: "ey16y4Bk92zmPSvbRznuv3RioAXbVreBkQxrKGDondo" },
  VRTon:  { name: "Vertiv",                             mint: "MkN2TZSYTFBdMRLf9EVcfhstTwnazH8knd9hpepondo" },
  WULFon: { name: "Terawulf",                           mint: "exYfSJt6Fgfhfnp3bAD4roYy97hLF9npjYaLyEXondo" },
};

// Build registry synchronously — no network call needed.
let registry = null;

const NON_XSTOCK_SYMBOLS = ["USDC", "USDY", "KTB", "CETES", "TESOURO", "GILTS", "BTC", "EURC"];

export async function getRegistry() {
  if (registry) return registry;
  const bySymbol = { USDC, USDY, KTB, CETES, TESOURO, GILTS, BTC, EURC };
  for (const [symbol, { name, mint }] of Object.entries(XSTOCKS_RAW)) {
    bySymbol[symbol] = { symbol, name, mint, decimals: 8 };
  }
  for (const [symbol, { name, mint }] of Object.entries(ONDO_RAW)) {
    bySymbol[symbol] = { symbol, name, mint, decimals: 9 };
  }
  const byMint = {};
  for (const t of Object.values(bySymbol)) byMint[t.mint] = t;
  registry = { bySymbol, byMint };
  const xCount = Object.keys(XSTOCKS_RAW).length;
  const oCount = Object.keys(ONDO_RAW).length;
  console.log(`[tokens] registry loaded: ${xCount} xStocks + ${oCount} Ondo Stocks + USDY + 4 Etherfuse Stablebonds + BTC + EURC + USDC`);
  return registry;
}

function jupHeaders() {
  return JUP_KEY ? { "x-api-key": JUP_KEY } : {};
}

export { JUP_BASE, jupHeaders, NON_XSTOCK_SYMBOLS };
