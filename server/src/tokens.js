/**
 * Token registry for Longview.
 * xStock Solana mints are pinned from the official xstocks.fi product list.
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
// decimals: 8 for all xStocks (Backed standard).
const XSTOCKS_RAW = {
  AAPLx:   { name: "Apple",                                  mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  ABBVx:   { name: "AbbVie",                                 mint: "XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie" },
  ABTx:    { name: "Abbott",                                  mint: "XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7" },
  ACNx:    { name: "Accenture",                               mint: "Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU" },
  ADBEx:   { name: "Adobe",                                   mint: "XsDZMGEU8zadWFCkTtPBoPWYcUX3JHVmghnwf2Mve2q" },
  AMATx:   { name: "Applied Materials",                       mint: "XsQZdaWUAGC4R3fgD2N1fupKvJfJq6YM51ccnsLUWFA" },
  AMBRx:   { name: "Amber",                                   mint: "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb" },
  AMDx:    { name: "AMD",                                     mint: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF" },
  AMZNx:   { name: "Amazon",                                  mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  ANETx:   { name: "Arista Networks",                         mint: "XsrsM2RgtYxXqxmy4iWgxQJUkkHG1U5wzi74sVNUW8m" },
  APLDx:   { name: "Applied Digital",                         mint: "Xs2ZEuDVSQkNnXHqfqEYKVShLHpecyKfdfpEYwiHtQE" },
  APPx:    { name: "AppLovin",                                mint: "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV" },
  ASMLx:   { name: "ASML",                                    mint: "XshuHQ6o6SVpUNawvnnTMxsZ4tacZsNgVCLorv7TkFq" },
  ASTSx:   { name: "AST SpaceMobile",                         mint: "XsR4LAtaBgTKTRUhiijY1ba13nx4bepeEcag2Pr4dZ1" },
  AVGOx:   { name: "Broadcom",                                mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo" },
  AZNx:    { name: "AstraZeneca",                             mint: "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU" },
  BACx:    { name: "Bank of America",                         mint: "XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP" },
  BITXx:   { name: "2x Bitcoin Strategy ETF",                 mint: "XsraCsjDB8cYn672MZSxCzZBhrodEPXD7pWd5EiRUhm" },
  BMNRx:   { name: "Bitmine",                                 mint: "XsrBCwaH8c46xiqXBChzobgufRKxQxAWUWbndgBNzFn" },
  BOTx:    { name: "RoboStrategy",                            mint: "Xsi8P9r7ZWDBBnBj9JTfnKWqyKNV19X2CQPWQsGdjnS" },
  "BRK.Bx":{ name: "Berkshire Hathaway",                      mint: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x" },
  BSPx:    { name: "Bending Spoons",                          mint: "XsYMHtwJcWon5GkPHzdDbCCztKtKzEurJnbydxgjsqS" },
  BTBTx:   { name: "Bit Digital",                             mint: "XsPLBFy59Q3hY59KLAJur8QyvziMF4xUxGTxXqXE7cT" },
  BTGOx:   { name: "BitGo",                                   mint: "XsvHMmbDcd14DHHW16PkxPGW7ks77ehxUv1E9Zmxgj4" },
  CEGx:    { name: "Constellation Energy",                    mint: "Xssu2cDLdZXZYrq17frTVrb3meumRCAzEf7pXyxoWVN" },
  CLSKx:   { name: "CleanSpark",                              mint: "Xsn3H7ACEpSF2ULxeiD6kW4jRZXpurh8ZPttyfoS56W" },
  CMCSAx:  { name: "Comcast",                                 mint: "XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8" },
  COINx:   { name: "Coinbase",                                mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" },
  COPXx:   { name: "Global X Copper Miners ETF",              mint: "XsybfiKkD4UmjkAGT2uR8X2sq9AWFtvGJM2KTffoALZ" },
  CORZx:   { name: "Core Scientific",                         mint: "XsBGEXxbBcuu8Nrokj14G8v4ezT3JYWWLneTzXK8t6Z" },
  CRCLx:   { name: "Circle",                                  mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  CRMx:    { name: "Salesforce",                              mint: "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN" },
  CRWDx:   { name: "CrowdStrike",                             mint: "Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw" },
  CSCOx:   { name: "Cisco",                                   mint: "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf" },
  CVXx:    { name: "Chevron",                                 mint: "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts" },
  DAXx:    { name: "Global X DAX Germany ETF",                mint: "XsKbKZ6e1BtERDn2cF11WkpVwvzSWCrf83AMafgnMQT" },
  DELLx:   { name: "Dell Technologies",                       mint: "Xsu7Tc5J2fVUE4H5vYAiSr34cvLJeCsYPMjAYnayQn6" },
  DFDVx:   { name: "DFDV",                                    mint: "Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy" },
  DHRx:    { name: "Danaher",                                 mint: "Xseo8tgCZfkHxWS9xbFYeKFyMSbWEvZGFV1Gh53GtCV" },
  ENHAx:   { name: "Enhanced Group",                          mint: "XsGAnis8BY5TLxEGdPY1LeeqY1DHPcUkkBQWRyQaJya" },
  ETNx:    { name: "Eaton Corporation",                       mint: "Xs8S5L4HkJpeBWF1J4oyUX6rVwGHmG7GZ7PiChPt7nY" },
  EWGx:    { name: "iShares MSCI Germany ETF",                mint: "XsM51PKxDNQBZR65VRxRjNqcMWUBoYwHeVn2FR6WXi9" },
  EWQx:    { name: "iShares MSCI France ETF",                 mint: "Xs1neEMHNaDDSHqE9nvDGkmuX73ZASKcLtQqwmVAQde" },
  EWUx:    { name: "iShares MSCI United Kingdom ETF",         mint: "XsbWCMXPzLdZMLpPtiiWE7M99fySmsnK5eFCWGWfDQ8" },
  EWYx:    { name: "iShares MSCI South Korea ETF",            mint: "XswenHXJtDWYMh89uRYx2tZcABxwXSn7j3jidDPS1Yo" },
  FAAAx:   { name: "Fidelity AAA CLO ETF",                    mint: "Xs8rb8QG9mEuQ41g2cUzuJLZt3xEPQFhvgb9s4obXSn" },
  FEZx:    { name: "SPDR Euro Stoxx 50 ETF",                  mint: "XsbZDdYJKxEBQASz4KBj23NRgymXw2NK6mbNQ6PYhC7" },
  FLBLx:   { name: "Franklin Senior Loan ETF",                mint: "XsCZJYnCmjs5cYZDMLVxVzvMy5AK2oqsWpobS6SYno8" },
  FLQMx:   { name: "Franklin US Mid Cap Multi-Factor ETF",    mint: "XsZdwvwEAn7KH8bCCo8AkxJmSm4MbaRxcDeh9Gt2VTF" },
  FSMLx:   { name: "Franklin Small Cap Enhanced ETF",         mint: "Xs9nAeuqjogYHy2UfL6jYqGmM5MPrRjuz6UYk8H79mZ" },
  GDXx:    { name: "VanEck Gold Miners ETF",                  mint: "XsVRhRg9eRE9PrsoPsAt5Mifa8mfjm9R3vdw6orp54j" },
  GEVx:    { name: "GE Vernova",                              mint: "XswXzAsMV9kebQjCVtr1btvrQgQ7C4C9kKgH4QYAVzw" },
  GLDx:    { name: "Gold ETF",                                mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re" },
  GLXYx:   { name: "Galaxy Digital",                          mint: "Xs3c2aZenyRQwXjki5MDxJEJ2km27ef2rWQMFWx7QKJ" },
  GMEx:    { name: "GameStop",                                mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc" },
  GOOGLx:  { name: "Alphabet",                                mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  GSx:     { name: "Goldman Sachs",                           mint: "XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1" },
  HDx:     { name: "Home Depot",                              mint: "XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3" },
  HIMSx:   { name: "Hims & Hers",                             mint: "XsprHSJzwz3qmHcEf7j7WcUk6hMUL4sPLuAdWaSY1oh" },
  HONx:    { name: "Honeywell",                               mint: "XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2" },
  HOODx:   { name: "Robinhood",                               mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg" },
  HUTx:    { name: "Hut 8",                                   mint: "XsG5QyZTQnVSpsXRpD92K5ZGoxXjsmfTyx7fW7r18DV" },
  IBMx:    { name: "IBM",                                     mint: "XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr" },
  IEMGx:   { name: "iShares Core MSCI Emerging Markets ETF",  mint: "XsFnZawJdLdXfBSEt5Vw29K5vdBiHotdPLjUPafpfHs" },
  IJRx:    { name: "S&P Small Cap 600 ETF",                   mint: "XsyZcb97BzETAqi9BoP2C9D196MiMNBisGMVNje2Thz" },
  INTCx:   { name: "Intel",                                   mint: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM" },
  IQMx:    { name: "Franklin Intelligent Machines ETF",       mint: "XsGqU2JhofxjZBBhuXAroJGdiyZdvbx64tPx1Mu6DVK" },
  IRENx:   { name: "IREN",                                    mint: "Xshh1dRsnxatP45yBfrzU9MrvrFCvxHQGTrWjgdA81E" },
  ITAx:    { name: "iShares US Aerospace & Defense ETF",      mint: "XsXoAR52Q2NYFkYiNqhCq4FauvyA1tdRsrmEYNf9fuh" },
  IWMx:    { name: "Russell 2000 ETF",                        mint: "XsbELVbLGBkn7xfMfyYuUipKGt1iRUc2B7pYRvFTFu3" },
  JAAAx:   { name: "Janus Henderson AAA CLO ETF",             mint: "XsEYQJtVa51Ww3y28jV1FwheMgmDj8BpxYiCPThcLWW" },
  JNJx:    { name: "Johnson & Johnson",                       mint: "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn" },
  JPMx:    { name: "JPMorgan Chase",                          mint: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C" },
  JPSTx:   { name: "JPMorgan Ultra-Short Income ETF",         mint: "XsCAXu7xTaZMG9b9KJhNWYapuvNjxPuE4SysZq8uvMq" },
  KLACx:   { name: "KLA Corporation",                         mint: "Xsw2uU1i8tHjbgstUbtt3m6kg7BS7AgG5aj8z7ddmmN" },
  KOx:     { name: "Coca-Cola",                               mint: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ" },
  KRAQx:   { name: "KRAQ",                                    mint: "XsAiRejKuvLAdq9KtedrMSrabz7SWdzKoVK6Qgac1Ki" },
  LINx:    { name: "Linde",                                   mint: "XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z" },
  LITEx:   { name: "Lumentum Holdings",                       mint: "XsexQ9qqNbDkLE6XwCN9ceVhLo8Lxc7UheVR6eBkKyo" },
  LLYx:    { name: "Eli Lilly",                               mint: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH" },
  LNGx:    { name: "Cheniere Energy",                         mint: "XsYLZdcMYST418xZhTV6KaHqr8BWqaKS3J45ywqigF9" },
  LRCXx:   { name: "Lam Research",                            mint: "XsSN912SN4Whn2xn59vWZHt1uLbw9WnoNGp5MigmHFf" },
  MARAx:   { name: "MARA Holdings",                           mint: "XsguBZPkM9BDmxspmWe29EmrYZBv21ENcC27Pqh7grB" },
  MAx:     { name: "Mastercard",                              mint: "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC" },
  MCDx:    { name: "McDonald's",                              mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2" },
  MDLNx:   { name: "Medline",                                 mint: "XsxaiepK535fVqavwRvJVTC64KaCLTtCgQT5jpR3rJt" },
  MDTx:    { name: "Medtronic",                               mint: "XsDgw22qRLTv5Uwuzn6T63cW69exG41T6gwQhEK22u2" },
  METAx:   { name: "Meta",                                    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  MOOx:    { name: "VanEck Agribusiness ETF",                 mint: "Xs72K1Ta1D5ccNy3RzSyQWGgZywWvphX78pL8WBk1Bo" },
  MRKx:    { name: "Merck",                                   mint: "XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X" },
  MRVLx:   { name: "Marvell Technology",                      mint: "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA" },
  MSFTx:   { name: "Microsoft",                               mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  MSTRx:   { name: "Strategy",                                mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ" },
  MUx:     { name: "Micron Technology",                       mint: "XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav" },
  NETx:    { name: "Cloudflare",                              mint: "XsR3LAMkzuPP8DnfYaiB2grTWqkBVy286gjJVErK1bi" },
  NFLXx:   { name: "Netflix",                                 mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL" },
  NLRx:    { name: "VanEck Uranium and Nuclear ETF",          mint: "XsTSfxoQry8okZoGMN5t6mExibDq3gA2NDLJeLztX7E" },
  NVDAx:   { name: "NVIDIA",                                  mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  NVOx:    { name: "Novo Nordisk",                            mint: "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n" },
  OKLOx:   { name: "Oklo",                                    mint: "XsJb1p4Ks6VFggq68JyMz7S3kdRfkqh4wA6EMyxi4DD" },
  ONDSx:   { name: "Ondas",                                   mint: "Xsgc9YTqdAH1GzDLBGQcScCMgkKsVBn4hBmqtNRospY" },
  OPENx:   { name: "Opendoor Technologies",                   mint: "XsGtpmjhmC8kyjVSWL4VicGu36ceq9u55PTgF8bhGv6" },
  ORCLx:   { name: "Oracle",                                  mint: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL" },
  PALLx:   { name: "Palladium ETF",                           mint: "XsTTtPA5V19YwHKDv4xeVXNM6kdsQNJvg3MyWkRUckt" },
  PANWx:   { name: "Palo Alto Networks",                      mint: "XsQ6NfzzLH8nspjrB9X8R2K64Zz7Tnxqu12juDiMPMW" },
  PEPx:    { name: "PepsiCo",                                 mint: "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF" },
  PFEx:    { name: "Pfizer",                                  mint: "XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw" },
  PGx:     { name: "Procter & Gamble",                        mint: "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV" },
  PLTRx:   { name: "Palantir",                                mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4" },
  PLx:     { name: "Planet Labs",                             mint: "XsMJtFbb8BwzQtck3oRXyAfs7SAPRuTXnSEDNd7BAVz" },
  PMx:     { name: "Philip Morris",                           mint: "Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3" },
  PPLTx:   { name: "Platinum ETF",                            mint: "Xst6eFD4YT6sz9RLMysN9SyvaZWtraSdVJQGu5ZkAme" },
  PWRx:    { name: "Quanta Services",                         mint: "XsLR2VCGNzYVLfJGEwwNZsRYDZBGyBnoQH5rPGvwodA" },
  PYPLx:   { name: "PayPal",                                  mint: "XshWQWYVp5ff8CrAEsGmLVKD47nBWi3Ygn5v8wXK27G" },
  QQQx:    { name: "Nasdaq-100 ETF",                          mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" },
  RBLXx:   { name: "Roblox",                                  mint: "Xss5RAku5EH6UViFdvW7ss9xQjwQLsrs2opPMhb3k43" },
  RCATx:   { name: "Red Cat",                                 mint: "Xs6yCfUGbkjcvivWr4crLR7pJGxEXspsuuUMhxNEEUw" },
  RIOTx:   { name: "Riot Platforms",                          mint: "Xs31mE5EiqjSHEaiX9QDKCN6NvSGCqpJ6f1FNq2wri5" },
  SATAx:   { name: "Strive Series A Preferred",               mint: "XsAxB3xLnt7xto5ChiSbVNHBoXcXzKuzS7FieiNYwtY" },
  SBETx:   { name: "SharpLink Gaming",                        mint: "XsEoih2x6nZuUjFwzGoba6MFmtzCkzW2c4YAm6baQbq" },
  SCHFx:   { name: "Schwab International Equity ETF",         mint: "XsWAnFM77x6YvpdaZoos79R12o4Yj4r7EVkaTWddzhU" },
  SGOVx:   { name: "iShares 0-3 Month Treasury Bond ETF",     mint: "XsYD72ntjj7ZwoFDZCDmN2gamTcLpnywqvG7PQN5vCN" },
  SLMTx:   { name: "Brera",                                   mint: "XsPHkGBbztHCCe1RMhiAs7CxVqoghmyd6zDUfrbfVWG" },
  SLVx:    { name: "Silver ETF",                              mint: "XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm" },
  SMCIx:   { name: "Super Micro Computer",                    mint: "XsMxAoJP47FQGLsVUvSS2QfBaHdNsd7DRU6nWRL8RSa" },
  SMHx:    { name: "VanEck Semiconductor ETF",                mint: "XstuBvLo7soZzj3beCCPonHpR3eUfPNSeQzw35Swons" },
  SMRx:    { name: "NuScale Power",                           mint: "XsrwdnwLHjVnyy7fgE2Pdwjp3czEm73jPjkSC5xzUBw" },
  SNDKx:   { name: "Sandisk",                                 mint: "Xswbpc8UqU6e1j9QZEWCjBMjyvz4twqD7PCy6j2e7jj" },
  SOXLx:   { name: "Direxion Semiconductor Bull 3X ETF",      mint: "XsdZDkoMdUb6iKDAKKappuM7C1Q2HmTqC8jNujbfmCu" },
  SOXXx:   { name: "iShares Semiconductor ETF",               mint: "XsEsHeiNZf88sABxu74TPuXbQThdaQGdzPVZUBicjtQ" },
  SPCEx:   { name: "Virgin Galactic",                         mint: "Xsgrm4D6VBTfDx5bs7GNdjtmWDgZ8V79r3YpsYwf5py" },
  SPCXx:   { name: "SpaceX",                                  mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8" },
  SPYx:    { name: "S&P 500 ETF",                             mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  STRCx:   { name: "Strategy PP Variable",                    mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH" },
  STRKx:   { name: "Strategy PP Fixed",                       mint: "XsaQGz41BEQkS9xAB44uvUtuXcdLJAXEU1dogEzWMZ8" },
  TBLLx:   { name: "TBLL",                                    mint: "XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp" },
  TERx:    { name: "Teradyne",                                mint: "Xsbe4fwmjVQEWEPkzfyxqNdPUUK7X9dKfTJrZdDbNgx" },
  TMOx:    { name: "Thermo Fisher Scientific",                mint: "Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57" },
  TMUSx:   { name: "T-Mobile",                                mint: "XswCi2U1G6Ppbw1QhG45yKb8UKuR1FKLJrquv2FZSD4" },
  TONXx:   { name: "TON",                                     mint: "XscE4GUcsYhcyZu5ATiGUMmhxYa1D5fwbpJw4K6K4dp" },
  TQQQx:   { name: "ProShares UltraPro QQQ ETF",              mint: "XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc" },
  TSLAx:   { name: "Tesla",                                   mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  TSMx:    { name: "TSMC",                                    mint: "XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV" },
  UBERx:   { name: "Uber",                                    mint: "XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB" },
  UNHx:    { name: "UnitedHealth",                            mint: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe" },
  URAx:    { name: "Global X Uranium ETF",                    mint: "Xsq9sEQjYiUTSZ55RrbHAzVfz8HotwFGrqgxkgiv4LB" },
  USARx:   { name: "USA Rare Earth",                          mint: "XsJJneENiaBPqqcdK1gMsfwi9cbw111azigzRYHoctX" },
  USPXx:   { name: "Franklin US Equity Index ETF",            mint: "XsBNz5UKYqcALjS5Xnm7HesMapyKLxkmfWPGHBek36x" },
  UUUUx:   { name: "Energy Fuels",                            mint: "XsYHvpLWfTfqdLkPbCc4eUT21eH521BRTXBypgzpEDH" },
  VCXx:    { name: "Fundrise Innovation Fund",                mint: "Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x" },
  VGKx:    { name: "Vanguard FTSE Europe ETF",                mint: "XsosCAu1L8Ebpr4SdBDV1EboYDRTWCH8j79UnHYzvbN" },
  VIDAx:   { name: "Vida Global",                             mint: "XsfCC9VL4DamVGNgdJpfLXB3sBVa158Gbx8sh7NzmTk" },
  VOOx:    { name: "Vanguard S&P 500 ETF",                    mint: "Xsd7TduTbjuYCFL7Uoujb8SbkZLmUsuYNLn7KdvX21x" },
  VRTx:    { name: "Vertiv Holdings",                         mint: "XsLUiVEwYeoneKpgR1C2Q4DBUZhX4xDktSCfQqq8zmn" },
  VTIx:    { name: "Vanguard Total Stock Market ETF",         mint: "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9" },
  VTx:     { name: "Vanguard Total World ETF",                mint: "XsEdDDTcVGJU6nvdRdVnj53eKTrsCkvtrVfXGmUK68V" },
  VUGx:    { name: "Vanguard Growth ETF",                     mint: "XsNVBwVGqtDqmA2Waoiux5mfykH8nepLK74z3ZoQWK2" },
  Vx:      { name: "Visa",                                    mint: "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p" },
  VXUSx:   { name: "Vanguard Total International Stock ETF",  mint: "XsLT5v4DAd1kwViPQh3SZiT5kzJfNLxzJxJN1dySZTe" },
  WBDx:    { name: "Warner Bros. Discovery",                  mint: "XsZUSqxAXKJkEimvD4CoVvEb4WUC92TFgj5zRtBxFeL" },
  WENx:    { name: "Wendy's",                                 mint: "Xs4uNhvBDAcp2mz3g9XR5q3vzLgmF1ANWxJgWk2d5u3" },
  WMTx:    { name: "Walmart",                                 mint: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci" },
  WULFx:   { name: "TeraWulf",                                mint: "XsuwUbQSzCJN2wZabD1Gxf1MER2Ypa7hMzVMYB2WawJ" },
  XLEx:    { name: "Energy Select Sector SPDR ETF",           mint: "Xs54CrhmpVp6uxZXwgSTegrRH2kShh88XFPzgf4BExu" },
  XOMx:    { name: "Exxon Mobil",                             mint: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh" },
  XOPx:    { name: "SPDR S&P Oil & Gas E&P ETF",              mint: "XsAk6BoV4kBXUM6WXodKyM21CN92G9jArwAzFvbh3LX" },
  YLDEx:   { name: "Franklin ClearBridge Enhanced Income ETF",mint: "Xs4uZnG2mzZQKgnmuYboj1PRBtascAvWh5NdVMfz2aW" },
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
  const byMint = {};
  for (const t of Object.values(bySymbol)) byMint[t.mint] = t;
  registry = { bySymbol, byMint };
  const xCount = Object.keys(bySymbol).filter((s) => !NON_XSTOCK_SYMBOLS.includes(s)).length;
  console.log(`[tokens] registry loaded: ${xCount} xStocks + USDY + 4 Etherfuse Stablebonds + BTC + EURC + USDC`);
  return registry;
}

function jupHeaders() {
  return JUP_KEY ? { "x-api-key": JUP_KEY } : {};
}

export { JUP_BASE, jupHeaders, NON_XSTOCK_SYMBOLS };
