// The Telegram Trading Bot's public @username (matches TELEGRAM_BOT_TOKEN
// on the server — confirmed live via the Bot API's getMe). Shared between
// App.jsx's Settings modal and the Trading Agent page's connect card so
// there's one source of truth for "which bot" if it's ever renamed.
export const TELEGRAM_BOT_USERNAME = "BonzaiTradingBot";
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
