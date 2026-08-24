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
// xStocks' 8). This block: xStocks tickers that had no real $1,000
// liquidity but do have a working Ondo equivalent, individually verified
// via Jupiter Ultra before pinning — see ONDO_ADD_RAW below for tickers
// xStocks never had at all, which does NOT have that same per-symbol
// liquidity verification.
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

// Ondo tickers xStocks never had at all — same sourcing/verification as
// ONDO_RAW above (Jupiter verified list, tag "ondo", cdn.ondo.finance icon,
// shared mintAuthority cross-check), but liquidity at any real trade size
// is NOT individually verified here — the earlier per-symbol Jupiter Ultra
// sweep hit sustained rate-limiting on the production key partway through
// and was stopped rather than continuing to load a key real trades depend
// on. Added anyway per explicit direction to assume liquidity rather than
// wait. If a symbol here turns out to have none, it will surface the same
// way any other zero-liquidity registry entry already does (buy/sell just
// fails with Jupiter's own "no route"/"not tradable" error) — nothing
// silently breaks, this is a completeness/UX risk, not a safety one.
const ONDO_ADD_RAW = {
  AALon:  { name: "American Airlines Group",            mint: "9wYZetvT8J2ptfsRca5gzLBGvcUug38mp9yT3xaondo" },
  AAOIon: { name: "Applied Optoelectronics",            mint: "YuFZvc8JCN3a6BUAqwnbY4AnhuVEXD4V7QnBTmwondo" },
  AAONon: { name: "AAON",                               mint: "nwPWRVFCbU3cdXWdJsuwomC5u459xPFdP2vYsmVondo" },
  ABNBon: { name: "Airbnb",                             mint: "128qNYovdGv2YqayErcJgU7gDwbNVX1VuoxbtWz8ondo" },
  ACHRon: { name: "Archer Aviation",                    mint: "KcCVQxG9LhFYP5o9DWFKTFgFShPPQkDEemVbiFyondo" },
  ACLSon: { name: "Axcelis Technologies",               mint: "jDoTgDRKSgVzkKdkaHZL3DiVmDM4YtYWwRG6Tgfondo" },
  ACMRon: { name: "ACM Research",                       mint: "nkbH2doD7nU4CkKVwzmd6UV4d2AaGy24NHzsh6tondo" },
  ADIon:  { name: "Analog Devices",                     mint: "LmTMwmZLNZszn3qpjmnbhfP12U4qWDivaEBwSBSondo" },
  AEHRon: { name: "Aehr Test Systems",                  mint: "ZWUSgDGQTQPGJyipzgJKcPhxgZzSBi4q6dqQbgCondo" },
  AGGon:  { name: "iShares Core US Aggregate Bond ETF", mint: "13qTjKx53y6LKGGStiKeieGbnVx3fx1bbwopKFb3ondo" },
  AGon:   { name: "First Majestic Silver",              mint: "hrZ5vs6c6v1iWyvEXjGSHs3sQuuj58VzXikNyRWondo" },
  AIPon:  { name: "Arteris",                            mint: "jmnrdSzu293vKTWyEx3A2ZRVxxytJKW1wD3CLzkondo" },
  AIQon:  { name: "Global X Artificial Intelligence & Technology ETF", mint: "uwh6Z6c2F8WZfUSK1A8VBfA9AwJKN5T2bvQwVFLondo" },
  ALABon: { name: "Astera Labs",                        mint: "cskxd6aqyqJMYgLZmFYfYecWkjasRJDEtm1QVxsondo" },
  ALBon:  { name: "Albemarle",                          mint: "B5KufqHkskgGYwMXtL8FSHgREAkMQvE3ykhH5Kmondo" },
  ALOYon: { name: "REalloys",                           mint: "ndHvUEgrvZquSR6wZv2cG1AiBr7e7HGuWvfPULcondo" },
  AMCon:  { name: "AMC Entertainment",                  mint: "C9xNaNujcF1a5fidWAAFReFYqhLRVbyk4yPyGqzondo" },
  AMEon:  { name: "AMETEK",                             mint: "ko48myqhBuXyL9WAp6pTzHWsdKsGKSditJVoGTSondo" },
  AMGNon: { name: "Amgen",                              mint: "SS6AEWhzRrxhL2cXzKKjhFt3rCzmHHGKmFyugDTondo" },
  AMKRon: { name: "Amkor Technology",                   mint: "nvvoP8gFyY2aZp6Cxu9Qq4MQqGrMebjtCxWrYfbondo" },
  AOSLon: { name: "Alpha and Omega Semiconductor",      mint: "b98FynyBEkdhP4Y3QUvKG36nms4oMsxEZUrCBMvondo" },
  APHon:  { name: "Amphenol",                           mint: "fFTZ9Jckm2X811mdqRBS4ckMz5bRAJVjH4Jwofwondo" },
  APOon:  { name: "Apollo Global Management",           mint: "14VXAhoa1R74vi1ZuiQyGLJrnDMfoFBPJSCpGVz3ondo" },
  ARGTon: { name: "Global X MSCI Argentina ETF",        mint: "rki25TZmDh94spjeoyyGWjkVEYSzcVvaAbddXGuondo" },
  ARMon:  { name: "Arm Holdings plc",                   mint: "15SsCZqCsM9fZGhTmP4rdJTPT9WGZKazDSsgeQ8ondo" },
  ARQQon: { name: "Arqit Quantum",                      mint: "crakmaGKTuVRYqSBsFsuqio5CmpEQnpibDrVLbDondo" },
  ATKRon: { name: "Atkore",                             mint: "ZsCDHjWFyndwgbHMs4AHYwJZQMgmAn72ESQj2b5ondo" },
  AURon:  { name: "Aurora Innovation",                  mint: "eGbh3V9R5ujWYwKJZAyM4Eg3sfzLhwKyr4bGbTsondo" },
  AXPon:  { name: "American Express",                   mint: "1WxT6NdK7uqpfXuKpALxL2n3f7Rq61XXeHA8UM4ondo" },
  AXTIon: { name: "AXT",                                mint: "Z1K14ngynqmrmfRSC2dRZGs1ghmnDKiiahjaM2condo" },
  BABAon: { name: "Alibaba",                            mint: "1zvb9ELBFShBCWKEk5jRTJAaPAwtVt7quEXx1X4ondo" },
  BAIon:  { name: "iShares A.I. Innovation and Tech Active ETF", mint: "gKkrSgVjRjdQX4LFErBka1izQhoW2VHXFcCS5Vbondo" },
  BAon:   { name: "Boeing",                             mint: "1YVZ4LGpq8CAhpdpm3mgy7GgPb83gJczCpxLUQ3ondo" },
  BBAIon: { name: "BigBear.ai Holdings",                mint: "YXE7mph6XhsgnyezkMEcTuohSuWhbLWfwx2Hh6mondo" },
  BEon:   { name: "Bloom Energy",                       mint: "bBMTGF7atoCizHMT3KCeqJzqR2gXFSUXr53AEDgondo" },
  BIDUon: { name: "Baidu",                              mint: "54CoRF2FYMZNJg9tS36xq5BUcLZ7rju1r59jGc2ondo" },
  BILIon: { name: "Bilibili",                           mint: "14kLsQVmc64qZexYuR4XGop9y8BeMkd77pJUm1Rhondo" },
  BILon:  { name: "SPDR Bloomberg 1-3 Month T-Bill ETF", mint: "wtwpt5yJbButAhjpYhtg4uvUgCQN4LVgvLq2AxEondo" },
  BINCon: { name: "iShares Flexible Income Active ETF", mint: "mhZ69E1vDnAsQJXAwarLYSX5tmgeMajXBJ2rXAcondo" },
  BKCHon: { name: "Global X Blockchain ETF",            mint: "uyWDgDZqL6x2V86i7vwJTKPuyg2u79UYaBe5yt7ondo" },
  BLCRon: { name: "iShares Large Cap Core Active ETF",  mint: "g3jQMP79SxnH1KisVw3C4SBpa8gSbPAocNJruJFondo" },
  BLKon:  { name: "Blackrock, Inc.",                    mint: "5H1VpMzRuoNtRbPTRCz35ETtEUtnkt8hJuQb9v7ondo" },
  BLSHon: { name: "Bullish",                            mint: "A9PFmw9Hu8zzxDUoU351pio1E1XWBWBfWnjT9qoondo" },
  BNOon:  { name: "US Brent Oil Fund",                  mint: "BAU83kqEqhyiexfAMQhZZE5KnGogSqh17fJc44Sondo" },
  BOTZon: { name: "Global X Robotics & Artificial Intelligence ETF", mint: "soLM6jRVdG1PdurSAQDz5qRtwWxXPM6EBvwrkBjondo" },
  BRHYon: { name: "iShares High Yield Active ETF",      mint: "fznj92AnTcQ6mAFvt68JgLJS5pHag5uPmJ7LmSLondo" },
  BRLNon: { name: "iShares Floating Rate Loan Active ETF", mint: "fcfpT8y5fpEBJjqmjKLpscZYzVjxR95ErJsb31jondo" },
  BRTRon: { name: "iShares Total Return Active ETF",    mint: "gPwmyo4BM4qgYYCTVgA4eJmzsnYNVMUJYBecYkCondo" },
  BTDRon: { name: "Bitdeer Technologies",               mint: "kBUAHgGHFthfnwarWxqYxHqVDnqqieJkXb6kvroondo" },
  BTGon:  { name: "B2Gold",                             mint: "cBnVXDyZgaaLZM18wAmqsUKnRUFAEJWbq6VuUoaondo" },
  BWETon: { name: "Breakwave Tanker Shipping ETF",      mint: "m7mWfvhyPikY3esNwTk8U1JRbcBijmzHgqiqx3xondo" },
  BZon:   { name: "Kanzhun",                            mint: "doPqjCxi6UkANkvMz5fSuYGEo5PGppVpTZMeB5vondo" },
  CAMTon: { name: "Camtek",                             mint: "ZcS6FuJ1nAjgwJejUsxkasM6JpEDkdowVyohBCzondo" },
  CAPRon: { name: "Capricor Therapeutics",              mint: "BS8zoc6pmALQnBhBDFak6eFhgGHjpebnHzsxApgondo" },
  CATon:  { name: "Caterpillar",                        mint: "AErxJJxGbc9cZzZoZepN62BNfg5RXns8tmEc3Zpondo" },
  CBRSon: { name: "Cerebras Systems",                   mint: "c7KEKjzaTQYpTrHM2db8yq3bikPpcXrHgBV8Qcgondo" },
  CCJon:  { name: "Cameco",                             mint: "fVPj4hHHVEeUrzVnad5fvxFEPGAXD5X6wkw1Xjdondo" },
  CEVAon: { name: "CEVA",                               mint: "nLTgFdT7x37oXMbZoZxbQ1787qSPVRLXo7JPRkLondo" },
  CIBRon: { name: "First Trust NASDAQ Cybersecurity ETF", mint: "BVdL3WUxtxUD4vXRWwqChJLbGxvfzZjBGPp63Wtondo" },
  CIENon: { name: "Ciena",                              mint: "cY3kDrNWP6DUZcWSQmA6Y4Nf7q5qS5kZ8zF9iLnondo" },
  CIFRon: { name: "Cipher Mining",                      mint: "WNZBSkNBNP3Ct1pcFn6Fu4sZQFhnu48EsM9voCEondo" },
  CLFon:  { name: "Cleveland-Cliffs",                   mint: "fTuoE9pWbVK7EUpUEENBn8Vu226T7kF3YJBTRLPondo" },
  CLOAon: { name: "iShares AAA CLO Active ETF",         mint: "t71FyTYHVkPAb5g48adDHmkVxXYbUuP2eq6jDZLondo" },
  CLOIon: { name: "VanEck CLO ETF",                     mint: "ucQ3VfWAx9pkCN4Kg84zE56FtB4FJN2kQH4ArYYondo" },
  CLSon:  { name: "Celestica",                          mint: "eL1buL9zFxFhfRbjMfyPu2q9HSAJkUUnHVUgkPdondo" },
  CMGon:  { name: "Chipotle",                           mint: "5owVsVFSHACQuippFYdLp3qWRobp2EGcwxMmsr6ondo" },
  COFon:  { name: "Capital One",                        mint: "R2uDbMtmHq5xSS5SserrovdRKdpiqnVBCd2AHLhondo" },
  COHRon: { name: "Coherent",                           mint: "BXMkru8ded26p71gJ3AMMwJmwZaYYfQjRo8vbZzondo" },
  COHUon: { name: "Cohu",                               mint: "jYMxpcgARQCdvQ15H1vvRCnBUbUEEQgSnS6SsfTondo" },
  Con:    { name: "Citigroup",                          mint: "PjtfUiw6Hwd8PZ94EcUw8mBSYxp7SjjzSLeNTDKondo" },
  COPon:  { name: "ConocoPhillips",                     mint: "X68p9qTpEMkR1TLpXUP2ZJo8PG4Qge2Y2ZLdjA2ondo" },
  COROon: { name: "iShares International Country Rotation Active ETF", mint: "gNhrgh21pQozQoc7YtvhdKF7eJnSKwWa9dzHnaxondo" },
  COSTon: { name: "Costco",                             mint: "6btaz134wjHkR8sqhAYrtSM6tavftfxnRvnyMd8ondo" },
  CPERon: { name: "US Copper Index Fund",               mint: "hpkpc1Xenv5oEpVefk3woWjZa9rxaJxaEaVVA4Fondo" },
  CPNGon: { name: "Coupang",                            mint: "NKyzy31w2J7odLb2CW3Ft4fpKXkW3LBt1pvpkVLondo" },
  CRDOon: { name: "Credo Technology Group Holding",     mint: "d4Rc6KvP3nQT8zC86Z31zM1DJCSfUD6y424cKnZondo" },
  CRWVon: { name: "CoreWeave",                          mint: "BfPGpgNyxe6rjAru1EJarjSBAcCABuMF5L32v7nondo" },
  CVNAon: { name: "Carvana",                            mint: "FGmUDXqA3AbWfo5b3NUcsvwoUFCF4tr9ea6uercondo" },
  DASHon: { name: "DoorDash",                           mint: "83P1gCFBZfGRCwJuBt9juxJKEsZwejJoG66eTZ6ondo" },
  DBCon:  { name: "Invesco DB Commodity Index Tracking Fund", mint: "td1aY5AvYQuwGD75qNq9aPipMexraN9mQXJwqifondo" },
  DEon:   { name: "Deere",                              mint: "CqQyAZjB9LGFTG95eiadGTkfhd9QA12ProeKsQmondo" },
  DGRWon: { name: "WisdomTree US Quality Dividend Growth Fund", mint: "gnoSQSNTNZHViqVfxCcPDVxcRA29mrJL7C6JqYLondo" },
  DGXXon: { name: "Digi Power X",                       mint: "jwCKwGoJfx1p4K5XCwqPrq1xyJU1g26Tmf6UcDcondo" },
  DISon:  { name: "Disney",                             mint: "mJf1xT3suXtkXBCfZcE9oUUuyxkvSgqYBWiX7v1ondo" },
  DNNon:  { name: "Denison Mines",                      mint: "12J2LD3tuLfdiVKnWZMHRMrbnXDY9rM4yqVLUa5yondo" },
  DRAMon: { name: "Roundhill Memory ETF",               mint: "oXeD5ZesXfJQ3mxtuZdMaccUsWrE8r1SnpYRP2Bondo" },
  DRSon:  { name: "Leonardo DRS",                       mint: "gtKc3PtKfUH7vbvYLJ1HCRXCpQK1Wpgevn8e6gUondo" },
  DTCRon: { name: "Global X Data Center & Digital Infrastructure ETF", mint: "t29YBAB7g6xzgRJkzmc5NkQ7YRjE3NF8mhsLgppondo" },
  DYNFon: { name: "iShares US Equity Factor Rotation Active ETF", mint: "g7vMfs5FrR8JjieeGC3c9sJaYPp4G3jGPfF4tkyondo" },
  ECHon:  { name: "iShares MSCI Chile ETF",             mint: "BmXVAFyfpW7VuVYeWDtbFtLx7sek2mZt3BEsGgAondo" },
  ECOon:  { name: "Okeanis Eco Tankers",                mint: "mnYetf4bWKX8HihNk1XLNYj8BPPy9PdkDFPV97Zondo" },
  EEMon:  { name: "iShares MSCI Emerging Markets ETF",  mint: "916SDKz7y5ZcEZC9CtnQ5Djs1Y8Yv3UAPb6bak8ondo" },
  EFAon:  { name: "iShares MSCI EAFE ETF",              mint: "AbvryMGnaba9oADMZk8Vp2Av6MtczsncGyfWaC4ondo" },
  EFVon:  { name: "iShares MSCI EAFE Value ETF",        mint: "uzQx2MnWr7drR5gdNXssJrFKQkLFSdw4EpfaQ5Nondo" },
  EMRon:  { name: "Emerson Electric",                   mint: "nNyVbs9Qty6wU2YcP5KFh4SUxNWTdPtL2W1bTMrondo" },
  ENBon:  { name: "Enbridge",                           mint: "aqEnHXRnXEQwDXEiFSEU4xHziw3Fco4b5JPkTtnondo" },
  ENLVon: { name: "Enlivex Therapeutics",               mint: "BncvtBGs4JqgYZwUoq3EN9q9HUFqJKTfWpvCsHCondo" },
  ENPHon: { name: "Enphase Energy",                     mint: "Bp26APthMuM46gMFTo5KYpo7b92GN2xSCor7f9oondo" },
  ENTGon: { name: "Entegris",                           mint: "awCwGaVNbYJH2SyQJzgE3mB54gxa6SQEZSKZaHQondo" },
  EQIXon: { name: "Equinix",                            mint: "aheEdmuryJU8ymy8LjYheZH5i2BW1UMsfuWQKD2ondo" },
  EQTon:  { name: "EQT",                                mint: "bWrYATfytuRwGoDbpxy16aQbMbCZDv8DURuLCAhondo" },
  ETHAon: { name: "iShares Ethereum Trust",             mint: "LitNUakTges74cjDJm6HHfFNKGPdySkp3MWSYzYondo" },
  EUHYon: { name: "iShares Euro High Yield Corporate Bond USD Hedged ETF", mint: "teUYhoQUgqsFp9ZwYBUHfuUHdVvbNx9N8spESGqondo" },
  EWJon:  { name: "iShares MSCI Japan ETF",             mint: "C6c7VcxuUYcV5YTsky5HM4PUmfwHTwsDD5DNwwPondo" },
  EWZon:  { name: "iShares MSCI Brazil ETF",            mint: "CBKcmEvVg5EgE3W5hVSPcBYWh6TFVjQwbmYod9Pondo" },
  EXODon: { name: "Exodus Movement",                    mint: "CJRoTbu98waCCuLFfLuJ2kXawLk889fqW4UAAbwondo" },
  EXTRon: { name: "Extreme Networks",                   mint: "js1cCZRNx8ircYiQJuhBNMnsA9owr6ZLYx6z2uNondo" },
  FCELon: { name: "FuelCell Energy",                    mint: "dYDS22uTX8CtiyixnXY9fMVGAkxbemVAjbCaWVbondo" },
  FCXon:  { name: "Freeport-McMoRan",                   mint: "CY8ttw5rYCT6fFBJwqXofefqa7Ji9E8zfLmhRLmondo" },
  FFOGon: { name: "Franklin Focused Growth ETF",        mint: "CYAwMGyuNSDu7NpuccNwcxMNS5Bu9akxU2Jooyiondo" },
  FGDLon: { name: "Franklin Responsibly Sourced Gold ETF", mint: "CYqLHM92EhmF83iNgfN4A1j2ckjsHigRvXu7xHCondo" },
  FIGon:  { name: "Figma",                              mint: "aLDdFsr3VTUQaHFK6yNvQxztvxQ8nxW4AMuSGC7ondo" },
  FIGRon: { name: "Figure Technology Solutions",        mint: "ZmHxc6Gt27RJKxD2ay6UL4n9yQ7mKAq4XZQUeVhondo" },
  FLEXon: { name: "Flex",                               mint: "iicfp8Efr4WfGAP9gXmYzdxmNFi1LV3iVudAmCnondo" },
  FLHYon: { name: "Franklin High Yield Corporate ETF",  mint: "CZ3FxxSto7tsjkSkqMek1C5p3RCFFmkwKqW57nbondo" },
  FLNCon: { name: "Fluence Energy",                     mint: "bzoe1epsQLx65zmez4pWfBumYzpaFwRTvnmCjZVondo" },
  FLQLon: { name: "Franklin US Large Cap Multifactor Index ETF", mint: "CZ9GBn1okotqKNUUqoxk4PF2JVi59bw5GWvVo6Dondo" },
  FNon:   { name: "Fabrinet",                           mint: "cfxyRHXjqoKN6hF3oEGu1bpEEFGcEiVXoNG4UUCondo" },
  Fon:    { name: "Ford Motor",                         mint: "5hT2o25X9tGXipwhLckaUdgnxrZ6Y8eiUwdhpLeondo" },
  FORMon: { name: "FormFactor",                         mint: "ZDnkXeN5awDioQjP691XFLdgZwDAv19g3fCr9KWondo" },
  FPSon:  { name: "Forgent Power Solutions",            mint: "m3XghfWMqmVE81LKLVxd1FVCKjqYAUxH8bMHGhzondo" },
  FSOLon: { name: "Fidelity Solana Fund",               mint: "BJhPr9SM7uZTZXHeSLYmUk7CjGQq1esFkVxPF5tondo" },
  FTGCon: { name: "First Trust Global Tactical Commodity Strategy Fund", mint: "ivBnfPTyuHDNWmMSnbavckhJK6SHZW8h77nZKsEondo" },
  FUTUon: { name: "Futu Holdings",                      mint: "Ao5rKFRQ54W3DKSAtqfhBRPNHewwWRLNLao2JL9ondo" },
  FXIon:  { name: "iShares China Large-Cap ETF",        mint: "CeFbGYXDmkyfo1TXXzzZ512mtnCCewNohu6V15vondo" },
  GDon:   { name: "General Dynamics",                   mint: "hESwwvKsJH4p7Xib5rrM921Ng19cwcQGtxyrgSJondo" },
  GEMIon: { name: "Gemini Space Station",               mint: "NrTdGMA3ujUvWXkwXyZKnhoByb32KTjRh5Vo47yondo" },
  GEon:   { name: "General Electric",                   mint: "aTBfDuLRqYHBiG82bHA7DzwjSDTFre2dRtGH3S5ondo" },
  GFSon:  { name: "GlobalFoundries",                    mint: "etnBzce6pkJq67QUv78PefkVyCEaA6YBE4hvx1Gondo" },
  GGOVon: { name: "iShares Global Government Bond USD Hedged Active ETF", mint: "tzuC3sZnHg7spuAFhdCqivx9qtJg15qUBUpCJx1ondo" },
  GLTRon: { name: "abrdn Physical Precious Metals Basket Shares ETF", mint: "CgnZbDNzBfaLyJqUtd4esKLShRp7RznQuwP4uQaondo" },
  GLWon:  { name: "Corning",                            mint: "YQzNQh2YSFQ6nh91E8Ja71U6JuZDLap5jJCsELGondo" },
  GNRCon: { name: "Generac Holdings",                   mint: "eqzwohR9oCR6sravF4y5HyUwyvCDbnfSYqiiFrXondo" },
  GRABon: { name: "Grab Holdings",                      mint: "m9GcsVgdjaL3KsdtSFHimnhtsUMpTHkjtwEG4Tzondo" },
  GRNDon: { name: "Grindr",                             mint: "Gc1aT3ay7FXL3qdAW7cNSXYPDsGavy7qiACuxwxondo" },
  HALon:  { name: "Halliburton",                        mint: "iFcwEB2LfeYLWKgZ2vogEzC5dP7s7xbhVX81XFwondo" },
  HIIon:  { name: "Huntington Ingalls Industries",      mint: "h73FNVBDq95fqGBy5eunHm2FVfu2jWZNkeXHDieondo" },
  HIMXon: { name: "Himax Technologies",                 mint: "aCx5G8ewGTSzozEn8KmSsr9cvfyFWzGnr22GjFXondo" },
  HIVEon: { name: "HIVE Digital Technologies",          mint: "kTMQKHhnWPTvZsfiZfcdeHdG6dMgZV27wXSiC3Yondo" },
  HLITon: { name: "Harmonic",                           mint: "o3pnLke4uti6hY3LTfb2wVBpHeWG7znjJHj6VXtondo" },
  HPEon:  { name: "Hewlett Packard Enterprise",         mint: "axbgKgUMscTJ34DjA69kBJuf6UYq4Pzb8B8numYondo" },
  HSAIon: { name: "Hesai Group",                        mint: "nagL8iWMNLZVuKFk3bUGDaHyT5ZY4bNfUzsdtGHondo" },
  HUBBon: { name: "Hubbell",                            mint: "ZmiDoowvkpp1Qgx4mmY3qtsHbNV1oE12ApKCbZNondo" },
  HYGon:  { name: "iBoxx $ High Yield Corporate Bond ETF", mint: "c5ug15fwZRfQhhVa6LHscFY33ebVDHcVCezYpj7ondo" },
  HYGWon: { name: "iShares High Yield Corporate Bond BuyWrite Strategy ETF", mint: "ZKzkbFi4n3NQmRA9i5T7jVPSN2XERwxfHUf4p2pondo" },
  HYSon:  { name: "PIMCO 0-5 Year High Yield Corporate Bond Index ETF", mint: "CsN1Tyz467bSFLPGd6MJyZhPNtwDaWZtX8ixHWyondo" },
  IALTon: { name: "iShares Systematic Alternatives Active ETF", mint: "gfKuBLive7Q35MYgxPgNx7qx524zQJ9RiDZJFZoondo" },
  IAUon:  { name: "iShares Gold Trust",                 mint: "M77ZvkZ8zW5udRbuJCbuwSwavRa7bGAZYMTwru8ondo" },
  IBITon: { name: "iShares Bitcoin Trust",              mint: "6JLG8iUkAuqiBhL3j2ckDMDf5oWAa6awmyaWezKondo" },
  ICHRon: { name: "Ichor Holdings",                     mint: "ZTABSukbFUFcuCYpMFHxN18aB4kPL2NkpZpgnXPondo" },
  IDEFon: { name: "iShares Defense Industrials Active ETF", mint: "th3tot4SRq6jgEyJ568NEh42MM82RSJ3NkiWeNzondo" },
  IEFAon: { name: "iShares Core MSCI EAFE ETF",         mint: "C9J9vZ8N79GzzxFoRkPWCkGtMKU8akg4FhUk4r9ondo" },
  IEFon:  { name: "iShares 7-10 Year Treasury Bond ETF", mint: "D4uWxzR5StYC6sTRhVts8Eboy3pmVtHeNC62dnQondo" },
  IEIon:  { name: "iShares 3-7 Year Treasury Bond ETF", mint: "wuzf2FDZTRbRY3ZnndMeQ38Wk9YTDGGXTA63nUyondo" },
  IGEBon: { name: "iShares Investment Grade Systematic Bond ETF", mint: "feZXF2iFspS6QKE4LSXeSESRXgrtvzbE3dZSyydondo" },
  IGVon:  { name: "iShares Expanded Tech-Software ETF", mint: "jYxKRFuXr6PEkzPpf1wWF7DhLL4gxGJ95Pv2NGrondo" },
  IJHon:  { name: "iShares Core S&P MidCap ETF",        mint: "cfPLN9WXD2BTkbZhRZMVXPmVSiRo44hJWRtnaC8ondo" },
  IJSon:  { name: "iShares S&P Small-Cap 600 Value ETF", mint: "v34vtrbcjDswpFDixpVFThmUWeM1RTZwtWcp5FBondo" },
  INCEon: { name: "Franklin Income Equity Focus ETF",   mint: "D8KT4Jd8qiKKTfkM8ejSKCpWGR1o3GFvnQGp5ERondo" },
  INDAon: { name: "iShares MSCI India ETF",             mint: "DBNwt3FoYCKQWdfzxKFNZ4mzuz4Jz1iRzFf7HFzondo" },
  INODon: { name: "Innodata",                           mint: "nTUjRdtzGCy8FXHK8w1n11pHABX6Dc7L7WSpzdBondo" },
  INROon: { name: "iShares US Industry Rotation Active ETF", mint: "g4kT9HEg7rN4e5ZaEGHmzpkdM8qMbsZSHJojKeCondo" },
  INSWon: { name: "International Seaways",              mint: "mV5mof9x8nDirrHwT7g16MarvHbnRvz2zN2S4Cspyon" },
  INTUon: { name: "Intuit",                             mint: "CozoH5HBTyyeYSQxHcWpGzd4Sq5XBaKzBzvTtN3ondo" },
  IONQon: { name: "IonQ",                               mint: "DDZQijTbaSd3Kas1r1bgCnHPayk8vTP8SfZWp5Tondo" },
  IRDMon: { name: "Iridium Communications",             mint: "go6DXMdM5zHTC9G16BwAYA8rKwGRhy9M5uudNdBondo" },
  ISRGon: { name: "Intuitive Surgical",                 mint: "1MGRpPrkhEsCm2GCWD3rsvEU77xTTLAzfKXeFgFondo" },
  ITOTon: { name: "iShares Core S&P Total US Stock Market ETF", mint: "CPWkMURVvcnX8hGjqCTb8i5LkzV3VSvyk7SeJi8ondo" },
  IVVon:  { name: "iShares Core S&P 500 ETF",           mint: "CqW2pd6dCPG9xKZfAsTovzDsMmAGKJSDBNcwM96ondo" },
  IWFon:  { name: "iShares Russell 1000 Growth ETF",    mint: "dSHPFuMMjZqt7xDYGWrexXTSkdEZAiZngqymQF2ondo" },
  IWNon:  { name: "iShares Russell 2000 Value ETF",     mint: "DX7g7WNjDpVzNK9CG81v7wb6ZbiNzYfkdzH2Xs5ondo" },
  IYWon:  { name: "iShares US Technology ETF",          mint: "vr8RQPDmYQBruiYsFSV3KZyoWFEsEejxzMCdWrBondo" },
  JBLon:  { name: "Jabil",                              mint: "igWFQo1W64cQN6QUWYRXhM1UvpPuYTYtLELbDYqqqon" },
  JDon:   { name: "JD.com",                             mint: "E1aUS5nyv7kaBzdQzPVJW5zfaMgoUJpKYzdnFS2ondo" },
  KEELon: { name: "Keel Infrastructure",                mint: "kSbeWEe64qpoVb1ZSVxgRnekZ1PwGNJkLyL5gJWondo" },
  KEYSon: { name: "Keysight Technologies",              mint: "jYcn4hHgyq1fS46YgecQY9N1gLU3sAxKA3DZVAPondo" },
  KOPNon: { name: "Kopin",                              mint: "eSu547weHVErV8nax42PyJzPT8JodhBfXLDp5vyondo" },
  KWEBon: { name: "KraneShares CSI China Internet ETF", mint: "DVPSYdqWPLvNa8afnEqa3B9eDfTTWpGyUZeXvdMondo" },
  LASRon: { name: "nLIGHT",                             mint: "Z8aFb6uQJgwFJ4KYKrT8n53aP66xqihodfAu4AKondo" },
  LECOon: { name: "Lincoln Electric",                   mint: "kmppRwWb2odH6D4JWj8Lq9WshMyyUeCYssWQFhiondo" },
  LEMBon: { name: "iShares J.P. Morgan EM Local Currency Bond ETF", mint: "teZfcA6zpP476eKzED1daqBWDtuwbk9e2Ejk2cpondo" },
  LIon:   { name: "Li Auto",                            mint: "v12TwfofSbvVqQ5N5KGG4d3J8rtEi4BjGfn2apyondo" },
  LITon:  { name: "Global X Lithium & Battery Tech ETF", mint: "syb82jXkHWbcWgxoRqrvAcoCdsAb3y1fnCYo561ondo" },
  LMTon:  { name: "Lockheed",                           mint: "EoReHwUnGGekbXFHLj5rbCVKiwWqu32GrETMfw4ondo" },
  LOWon:  { name: "Lowe's",                             mint: "edLdFJVVR532qhcrNTJjLAmhmyV7NsctbWVokMBondo" },
  LPTHon: { name: "LightPath Technologies",             mint: "dhEXYTmQKbYBH3wbWTMqeZZpADSRprM4jiGYbUMondo" },
  LSCCon: { name: "Lattice Semiconductor",              mint: "nDetEKBEk9chztCXSYNrU5F63s2RCEQCxT7BhxDondo" },
  LUNRon: { name: "Intuitive Machines",                 mint: "DiDWPZ7vQXfpaeQ8BX68XuDYeiQLv7diDxdeUpaondo" },
  LWLGon: { name: "Lightwave Logic",                    mint: "dKGNHXGsZL4GZ4UBTCjpPbaMerqe1EdZ7aFdCxHondo" },
  MBLYon: { name: "Mobileye Global",                    mint: "eCSPcjdpdKL1546PU3RM6BXkebuKn8iH4iuMcTBondo" },
  MEIon:  { name: "Methode Electronics",                mint: "jiwgLgWJ8f6aEsM6hcSCrXLNnGpYfjmCVbqqAcwondo" },
  MELIon: { name: "MercadoLibre",                       mint: "EWwdgGshGngcMpDV34pWZRSu5bkAuiKuKTTHKQ8ondo" },
  MKSIon: { name: "MKS Inc.",                           mint: "ZNkQTVtc4WRMQfVCC23PmwYX41577tPcvs2AiXAondo" },
  MPon:   { name: "MP Materials",                       mint: "XwFm5GiKPVTvPiEbQpdc6vJbFEpsUXRMf6TcSxnondo" },
  MRNAon: { name: "Moderna",                            mint: "14VP7DvCAdBCc5XGNZkPt6zhtPzJrWWS64Koxtxyondo" },
  MTSIon: { name: "MACOM Technology Solutions Holdings", mint: "dAc8yWUrVra9v2PGsn3LT18oybsM62ysQ4ikWcpondo" },
  MTZon:  { name: "MasTec",                             mint: "R3ywbVQ5t8LNmjQsn2Ngv43dSqyZscQwNag9G3Eondo" },
  MXLon:  { name: "MaxLinear",                          mint: "aGn43ed4kjATwbVqsAuwAT24XcG9xABCcyQsFpqondo" },
  MYRGon: { name: "MYR Group",                          mint: "auLvQAhUzPuy2SQBSq2T6AofPGNkR4nZ83P8pjuondo" },
  NATon:  { name: "Nordic American Tankers",            mint: "mmy8WbFRNrjoDsPGqpYmzQAVu7PfGhMCdSRLxZLondo" },
  NBISon: { name: "Nebius Group",                       mint: "DiRshqNDE68bWbGdLHm1GwQ76MvWQG3af6w1NdQondo" },
  NEEon:  { name: "NextEra Energy",                     mint: "t7eN6cGwRMFaZvsNW2SmVwkedmHtDdrxA4ycNE5ondo" },
  NEMon:  { name: "Newmont",                            mint: "Dig28Tf1ufhCBAsjTmFkXCgcNgMqDMYj5A2rDQmondo" },
  NIKLon: { name: "Sprott Nickel Miners ETF",           mint: "V8LRV7kWjrx6Prke9oHEHNUiR122BVtyuPciTCTondo" },
  NIOon:  { name: "NIO",                                mint: "yQ37dFiGAbzrb2FRAEhGNzRy5zFfoYGWYhAepFEondo" },
  NKEon:  { name: "Nike",                               mint: "g646pcdG2Rt5DH9WZzL7VVnVDWCCMTTrnktwE74ondo" },
  NNEon:  { name: "NANO Nuclear Energy",                mint: "bz2iUTXWkutnfwG32ziABcTzXoM91sdcgdiJJJdondo" },
  NOCon:  { name: "Northrop Grumman",                   mint: "Dm6FpQ76SsbVmAZ4NvD2mjZP7cxbw1CASr4WwCiondo" },
  NOKon:  { name: "Nokia",                              mint: "amE2ANm5dyG6RTkJHdtzvWcuR8ChBZCEm5Jiqwdondo" },
  NOWon:  { name: "ServiceNow",                         mint: "G7pTVoSECz5RQWubEnTP7AC83KHUsSyoiqYR1R2ondo" },
  NTESon: { name: "NetEase",                            mint: "YeK2TdPtGLAme3Phg4pb1GBN2YxKgX5UNVyD4asondo" },
  NUEon:  { name: "Nucor",                              mint: "mvAUPvwKPW4rbbTXkqCvcZEG45XCeRHSVcLVym8ondo" },
  NVMIon: { name: "Nova",                               mint: "nupQ2BuCfoVeCHVLRDhTjLJanaf5cxZ81KVFqs6ondo" },
  NVTon:  { name: "nVent Electric",                     mint: "Z7G1bRFYH47se4g1ppqSgtMzeJs4JjzzFPmt7iAondo" },
  NVTSon: { name: "Navitas Semiconductor",              mint: "fXXYmrdSAwVmtNo1ZwrkxVep7BxTsusGzmUZJSPondo" },
  OIHon:  { name: "VanEck Oil Services ETF",            mint: "DnvbCqRuUYssmKVRBRNwkUnptHitH4ZZTt1KVuZondo" },
  OIIon:  { name: "Oceaneering International",          mint: "gfTDvjLp8K5gNDFaLMvoTZWJJY6PmVQfdPaUU7eondo" },
  ONon:   { name: "ON Semiconductor",                   mint: "13qtwy5fZi9Przz14pzo9xqFSr8QHmLyUpUCvP1xondo" },
  ONTOon: { name: "Onto Innovation",                    mint: "aHFrgfBHMGEScG8j64cN324jeoQ4EVXLmiHxtuPondo" },
  OPRAon: { name: "Opera",                              mint: "gbHFTMkuMQUy5xrgoCBdaQ2XYvNyjWAYcnRPh9Condo" },
  ORBXon: { name: "Global X Space Tech ETF",            mint: "t5XWftMCacS1p3xrg14ARaxgEvEM5R241kxHGqrondo" },
  OSCRon: { name: "Oscar Health",                       mint: "ThwGDsXZ6iKubWuEQjmDxGwF3bUERDGbBXvcbjFondo" },
  OUSTon: { name: "Ouster",                             mint: "aV3R9NPU6TkyA6r9NPF5bmAw5XXsjUU7r2whgBqondo" },
  OXYon:  { name: "Occidental Petroleum",               mint: "1GNFMryQ6c9ZpMhgNimmsbtgYM21qnBJgRAFoNiondo" },
  PAVEon: { name: "Global X US Infrastructure Development ETF", mint: "DsLQ18ooPjiHYuiuQ5Jz8PNCpVaKe3FhAYpvMxWondo" },
  PBRon:  { name: "Petrobras",                          mint: "GRciFCqJ5y2hbiD6U5mGkohY65BZTXGuGUrCqf7ondo" },
  PCGon:  { name: "PG&E",                               mint: "UP5s1srLaHDc4SwJqLPa3A48x5R7ofN3hZWxWEZondo" },
  PDBCon: { name: "Invesco Optimum Yld Dvsfd Cmd Str No K-1 ETF", mint: "M6agiXbNgy8Xon9ngiW4ZDPbMFcNCTMkMMkshZyondo" },
  PDDon:  { name: "PDD Holdings",                       mint: "PnjETBCLC318DRejo9cMQKAmET9PvW8AEFGWMNtondo" },
  PENGon: { name: "Penguin Solutions",                  mint: "dWFwjcUKdc7bPH9GEebpJVmEmUjvQTgEWGVR9WYondo" },
  PINSon: { name: "Pinterest",                          mint: "sxyg1VTSzy5zYANUK7hntNtmFAWoXGJq95AcHuVondo" },
  PLUGon: { name: "Plug Power",                         mint: "TnfswqdE1jAJ8sfnf5J7kSVLEH1cfpAYZ8MWmKfondo" },
  POWIon: { name: "Power Integrations",                 mint: "ZifkbVBh94FSETjAfoLw587nxmGsYtXayAAUQgzondo" },
  POWLon: { name: "Powell Industries",                  mint: "fRFzaZfGSXPf2r4oBgBBXpisRovMaJZjv1aCQBsondo" },
  PRIMon: { name: "Primoris Services",                  mint: "kcc5QzXDCQ61qQ5Nbpi2RppnRSzhG1XQNXkjXwoondo" },
  PSQon:  { name: "ProShares Short QQQ",                mint: "qKtU9A7ij34XmtxaSzYfxCpkgAZzzFsqnUb2kW2ondo" },
  PURRon: { name: "Hyperliquid Strategies",             mint: "rsiKbHCdsvmExvDfkYWypAXFsqKz6V8XuoxbkHtondo" },
  QBTSon: { name: "D-Wave Quantum",                     mint: "hqJXutLF6f7DxStrWCrnZDfXzbNTZmvi3KheVi6ondo" },
  QCOMon: { name: "Qualcomm",                           mint: "hrmX7MV5hifoaBVjnrdpz698yABxrbBNAcWtWo9ondo" },
  QLTAon: { name: "iShares Aaa - A Rated Corporate Bond ETF", mint: "fkznXN9GALK7f9zVr2RwRHWCPhwoima4zB3JbbNondo" },
  QTUMon: { name: "Defiance Quantum ETF",               mint: "iJAAwDNzJHbgKm5pksL3kXHc3zZewYm37dsZNCPondo" },
  QUBTon: { name: "Quantum Computing",                  mint: "E4YowrHx5wm4RtSjfuvTqtNH3Wf7NEj5tYZGD9Bondo" },
  QYLDon: { name: "Global X NASDAQ 100 Covered Call ETF", mint: "ueEYw3Djy9GVu9mrP6jum8qNpxshgcy7gMfmntWondo" },
  RDDTon: { name: "Reddit",                             mint: "HXFrTf9v9NdjGUTnx4sojR3Cf92hoBsQFUxKTN7ondo" },
  RDWon:  { name: "Redwire",                            mint: "E6KSaqjvqe2HiUpbEweRxLK4RimQddigm95H9Jaondo" },
  REGNon: { name: "Regeneron Pharmaceuticals",          mint: "E86mX2yb3HLbJM6gRtZQ6dCYmLh6MSDZadu9SCPondo" },
  REMXon: { name: "VanEck Rare Earth and Strategic Metals ETF", mint: "tiitb2Z1HtpB2DpVr6V7tdCFS3jmTinLeuGj9EVondo" },
  RGTIon: { name: "Rigetti Computing",                  mint: "dwEPNKQab3iwRmjGvZPXhAmws1W5NsQGwuXwi8oondo" },
  RIVNon: { name: "Rivian Automotive",                  mint: "AXRsYFt7TXNQ3DcY6BkvRgPV6VsYMURyDtaeudjondo" },
  RKLBon: { name: "Rocket Lab",                         mint: "E9VQY3VnrpVSekFByzRmfeK1kxgM3UiKCoVVbdUondo" },
  RMBSon: { name: "Rambus",                             mint: "jjnSEAsi8UbCez7x9XCbWntLWRHBdc2tWSdC3uoondo" },
  ROKon:  { name: "Rockwell Automation",                mint: "e83tWWrVsVk1hRGNz5BCwNr9TMBNWixmoUhWgYcondo" },
  RTXon:  { name: "RTX",                                mint: "12BvLZtzjdssAycxPeBQUjukhmgQpULAvy6SroYdondo" },
  SAPon:  { name: "SAP",                                mint: "bjbrNi96mXAzgvxSuGJ2SRJ5U4N8agbG7wUAKAjondo" },
  SBUXon: { name: "Starbucks",                          mint: "iPFqjcZQTNMNXA4kbShbMhfAVD8yr8Uq9UtXMV6ondo" },
  SCCOon: { name: "Southern Copper",                    mint: "EANjzFjj3nPXHdzN5CE3Z8LLVn69Ce77FE8X4cvondo" },
  SCHWon: { name: "Charles Schwab",                     mint: "cnc6M1zXLdrGR5LAQVcaJDfgezMiVWNtGQsVy1Kondo" },
  SECUon: { name: "iShares Securitized Income Active ETF", mint: "sDtEN5uwUJJCFJ95x2rPjPqNx5UWUbHQ2ucceUzondo" },
  SEDGon: { name: "SolarEdge Technologies",             mint: "EAwP9LGNjTkQ2YeKE6CGKqBYtrJ6APFvRe7KCMmondo" },
  SHLDon: { name: "Global X Defense Tech ETF",          mint: "siVse6kjZb9ihaXHaqoG3mhHyTPEnNCkvSDTheoondo" },
  SHOPon: { name: "Shopify",                            mint: "ivdDracs2s7jCP698dJXKSEQdVrNj9hasJL1Uq1ondo" },
  SHYon:  { name: "iShares 1-3 Year Treasury Bond ETF", mint: "EEy57xbaLcUrN1HXj2vz8VWxeWFK1eZQZo4aWbrondo" },
  SILon:  { name: "Global X Silver Miners ETF",         mint: "uiSLmtLdqxtbQq5gkwYBvBrZpnSNXZn8h6sjLsDondo" },
  SKHYon: { name: "SK Hynix",                           mint: "Huyb2fyDDjSuDKCRWsN9ci2rmcgPo6NFiLbx9ZDondo" },
  SLBon:  { name: "SLB",                                mint: "i7ZS13SF6BCKbzvLujp2UqLNMgM1XVnZ7A7wC6tondo" },
  SNAPon: { name: "Snap",                               mint: "a2cXfonVgQ6cKB4Lm8YZsPry39VZSA562bwmRSiondo" },
  SNOWon: { name: "Snowflake",                          mint: "JmFLCBwoNvcXy6B2VqABg6m784ubkXpaEx3p7S5ondo" },
  SOFIon: { name: "SoFi Technologies",                  mint: "mqL8yXQpeSvc7NgrAtLLPtRvUiWyLoG5RWLv16iondo" },
  SOon:   { name: "Southern",                           mint: "aKzjn2ZdWySSGPSSDTY2HUpcSCmemSahTXihrpyondo" },
  SOUNon: { name: "SoundHound AI",                      mint: "vE2qArmjto6VfeMngyGAnzp2ipLYeXsxiARDnnXondo" },
  SOXQon: { name: "Invesco PHLX Semiconductor ETF",     mint: "io3eLhnjT1a94JpzAUMWKqwMYHZRwvtGXjkkXsPondo" },
  SOXSon: { name: "Direxion Daily Semiconductor Bear 3X ETF", mint: "ivnSAcjCqEtWYTKFbqYe8YoqRZqCBfT4BGP5G1nondo" },
  SPGIon: { name: "S&P Global",                         mint: "JrTYw7A9jihX5TwpRStYviEbsYf2X2VJpZ13719ondo" },
  SPOTon: { name: "Spotify",                            mint: "jzCvs2Pk8tDcfsFRqnEMjurgaQW4iQfEkandUR8ondo" },
  SQQQon: { name: "ProShares UltraPro Short QQQ",       mint: "D1tu7Fnm3cCpKyyPXrqm5GXShPqMj7a2SEjjq9fondo" },
  STLDon: { name: "Steel Dynamics",                     mint: "n7DwzSkv1SBkcA9qj8LU9sZ9sRn72Z6spU2w2b9ondo" },
  STMon:  { name: "STMicroelectronics",                 mint: "bM2VSRfbYPt29YRD9F2wTCSCSQaHtNCuz1znNDCondo" },
  STNGon: { name: "Scorpio Tankers",                    mint: "mFyszXnJf8BFR8H4o33pCZS1T36BH9LjtG3gTpdondo" },
  STXon:  { name: "Seagate",                            mint: "EXtprP1wzrNo2bByrU9JyzqEg2hQMSCVJakeHHYondo" },
  SWKSon: { name: "Skyworks Solutions",                 mint: "iJtKb1CWnWdgJhs7HgSZvLmSJABGGMc97QeuG7tondo" },
  SYMon:  { name: "Symbotic",                           mint: "nP42LxpSZkUfnBUxiFsHxL5GKYWRZ1VxqGkMTNwondo" },
  SYSBon: { name: "iShares Systematic Bond ETF",        mint: "5U9o49BoQNU6bBMswvmBs3R4GZmYSyrnTN4ncX4ondo" },
  TASKon: { name: "TaskUs",                             mint: "nQysX1ZsRJ8yTJg8smZTZ91rWcVBabDRqdUEKZHondo" },
  TCOMon: { name: "Trip.com Group",                     mint: "9PMjLqd8zPdKkJUXarnit5t7tPL3cCscwHzy7ATondo" },
  TELon:  { name: "TE Connectivity",                    mint: "ZjYCwYeG85TbV5oXkCkvWQTNPh2PgTQ8X4nxpbyondo" },
  TENon:  { name: "Tsakos Energy Navigation",           mint: "micfqeFfvD9iDKKzuqRHXerFxG8K5VfY8CgrcQoondo" },
  TIPon:  { name: "iShares TIPS Bond ETF",              mint: "k6BPp2Xmf2TYgrZiUyWfUoZBKeqaDbvPoAVgSx2ondo" },
  TLNon:  { name: "Talen Energy",                       mint: "RTb54gpqAx6RpLAHRGnqQ3ciQ845CHqhg21ZzEJondo" },
  TLTon:  { name: "iShares 20+ Year Treasury Bond ETF", mint: "KaSLSWByKy6b9FrCYXPEJoHmLpuFZtTCJk1F1Z9ondo" },
  TMon:   { name: "Toyota",                             mint: "kbmF7ERJWMaaDswMprrH9gHSLya5D2RMBNgKqg3ondo" },
  TNKon:  { name: "Teekay Tankers",                     mint: "mPAqB3y5N7fWmEh1BoVtrLhZKBkQe7LjBCrYUNbondo" },
  Ton:    { name: "AT&T",                               mint: "WKMZummev5UcXz5nNKQZvTD6QjNSM2X58uwmDReondo" },
  TSEMon: { name: "Tower Semiconductor",                mint: "cRx9VtwwPTZbVk1DjbMyKzrMWn7nJA22UpMyzFYondo" },
  TTMIon: { name: "TTM Technologies",                   mint: "kWmjV2XdK5tbV6kZrM8grS6EGFmuH5i5HFW3YyLondo" },
  TTon:   { name: "Trane Technologies",                 mint: "erp2t2My8UoFgyRt39EmnnSiDUwUM5aNKw5piBKondo" },
  TXNon:  { name: "Texas Instruments",                  mint: "81xLFvCzFaUM3KDxSHC75pXu3RPCeSeCbmGBY8aondo" },
  UAMYon: { name: "United States Antimony",             mint: "nbwNoPaFYNY2c3u4iK6U59ySC2ehFrpjdpfbyLDondo" },
  UCTTon: { name: "Ultra Clean Holdings",               mint: "jCPs1JpVKAwevND3jzeDGAUBBFkJ5TUtiu2SxLbondo" },
  UECon:  { name: "Uranium Energy",                     mint: "EYo8D3cLdF1CDeGms5M5VHyU52HJYinkMZ1cqvYondo" },
  UMCon:  { name: "United Microelectronics",            mint: "ieocA48cBX3oiVECgosMGxG649wnf7R8EkVrA5fondo" },
  UNGon:  { name: "US Natural Gas Fund",                mint: "Es2ipHL7qXBcLmZ4N7LP9PHBHaWaTMTAkxDwGGjondo" },
  UNPon:  { name: "Union Pacific Corporation",          mint: "EvsME8gdnEwPLbTnhrGVDwrY35zBuB8hEGCq59Hondo" },
  URNMon: { name: "Sprott Uranium Miners ETF",          mint: "hieZTEZNBU67bMGULK9hWCB9h5jBPKdpRWiXpwkondo" },
  USFRon: { name: "WisdomTree Floating Rate Treasury Fund", mint: "o6U1Sm6Vd7EofMyCrL28mrp2QLzgYGgjveHiEQ5ondo" },
  USOon:  { name: "United States Oil Fund",             mint: "rpydAzWdCy85HEmoQkH5PVxYtDYQWjmLxgHHadxondo" },
  VDEon:  { name: "Vanguard Energy ETF",                mint: "hKVpWfYwP1VJ9BcBTPRcovcSpEkvnaN8eXwFoCMondo" },
  VFSon:  { name: "VinFast Auto",                       mint: "F3V1fKLKv7H8aNdt9TC6GQ3X4LayEfGHsPi8Umaondo" },
  VICRon: { name: "Vicor",                              mint: "f9nfUo4SdhCGfHmm81m3ArgDsatwo2jLjEcgCcYondo" },
  VNQon:  { name: "Vanguard Real Estate ETF",           mint: "F3dMJ9H137YUNc9cpN3gBWDSq4MSRbTFtojH65Uondo" },
  VPGon:  { name: "Vishay Precision Group",             mint: "dYF78b65HS62V3pku2uYFyektYzAhx9YACv4hWfondo" },
  VRSNon: { name: "VeriSign",                           mint: "ja4bMvHL3Hw9Ey33VGWyDeXvrHvQWyBnK4GSmCUondo" },
  VRTXon: { name: "Vertex Pharmaceuticals",             mint: "FL7QzUq58pvkDxkftJm7RqRWgqYEFZwXuvAMsUnondo" },
  VSHon:  { name: "Vishay Intertechnology",             mint: "jbzBdFNddeEiJXGcVH4DE2qUyYfTtyY2vaHJDEZondo" },
  VSTon:  { name: "Vistra",                             mint: "h6MW8GFpfzxFa1JNn6hZNnBF3t4fj9SHAXKy6LXondo" },
  VTVon:  { name: "Vanguard Value ETF",                 mint: "KuiYLPVq65qixD9TgvxBC576C4gG6vVTCdbh2zFondo" },
  VZon:   { name: "Verizon",                            mint: "igu1coP6n3GPaWmbd8J9Z7UAyLpV254uQFFNfydondo" },
  WCCon:  { name: "WESCO International",                mint: "m3m2HAANsAf2Y3BkdBixDgtrrFHnZDp4NqVh9obondo" },
  WDCon:  { name: "Western Digital",                    mint: "FLqH2jB2DZPJP5nnVFAakRKaNTcDZtq71Pnpp6Aondo" },
  WFCon:  { name: "Wells Fargo",                        mint: "L6ZE5qCpVVSqLePz64CrwkgyWoPF9M7tB8BeFH4ondo" },
  WLKon:  { name: "Westlake",                           mint: "mrNSd1y72F7Dx2Uip4vidtsJKKd8iJatTKGX6Pvondo" },
  WMBon:  { name: "Williams",                           mint: "bvjmEwQBqbMr6rnx5a74boBz6nmA1DNThujPnNAondo" },
  WMon:   { name: "Waste Management",                   mint: "FPvKvWzSzDZqgYmSZUetrkpUXSwo2VtpR4BynVYondo" },
  WOLFon: { name: "Wolfspeed",                          mint: "Zfb5PTVfGa8AV6VxrTQJuP8CjMXFPMVkVVNpcAWondo" },
  WSon:   { name: "Worthington Steel",                  mint: "ZpJpMhWKCr4m9ZzxApJJwDc5cHiHp2hG1RZdJyvondo" },
  WYFIon: { name: "WhiteFiber",                         mint: "jtnRMv1U3bJHQCsi47E6Lf8Nzkaqsisef7SkHBgondo" },
  XYLDon: { name: "Global X S&P 500 Covered Call ETF",  mint: "wCr7YFeYDWyYSebsoMY75g8c9pguGeVB3rT6kYjondo" },
  XYZon:  { name: "Block",                              mint: "BWxe2FVciUbwrCUZQPUKiREBh5LmVa5AiUqNLAkondo" },
  YEARon: { name: "AB Ultra Short Income ETF",          mint: "wxPFbh4dVrTWPGHHbVVeTHH7GK2uQwnTm5C8X3Fondo" },
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
  for (const [symbol, { name, mint }] of Object.entries(ONDO_ADD_RAW)) {
    bySymbol[symbol] = { symbol, name, mint, decimals: 9 };
  }
  const byMint = {};
  for (const t of Object.values(bySymbol)) byMint[t.mint] = t;
  registry = { bySymbol, byMint };
  const xCount = Object.keys(XSTOCKS_RAW).length;
  const oCount = Object.keys(ONDO_RAW).length + Object.keys(ONDO_ADD_RAW).length;
  console.log(`[tokens] registry loaded: ${xCount} xStocks + ${oCount} Ondo Stocks + USDY + 4 Etherfuse Stablebonds + BTC + EURC + USDC`);
  return registry;
}

function jupHeaders() {
  return JUP_KEY ? { "x-api-key": JUP_KEY } : {};
}

export { JUP_BASE, jupHeaders, NON_XSTOCK_SYMBOLS };
