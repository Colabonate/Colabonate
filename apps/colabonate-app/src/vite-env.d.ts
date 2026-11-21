/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Notification/Ticket-Polling Intervall in ms (default: 30000) */
  readonly VITE_POLL_INTERVAL_MS?: string
  /** Ticket-Detail Auto-Refresh in ms (default: 3000) */
  readonly VITE_TICKET_REFRESH_MS?: string
  /** Lightning Payment-Status Poll in ms (default: 5000) */
  readonly VITE_PAYMENT_POLL_MS?: string
  /** Home Offers Refresh in ms (default: 30000) */
  readonly VITE_HOME_REFRESH_MS?: string
  /** Comma-separated Nostr relay URLs (default: ws://localhost:4001 for dev) */
  readonly VITE_NOSTR_RELAY_URLS?: string
  /** Default Ollama model for AI assistant (default: qwen2.5:7b-instruct-q4_K_M) */
  readonly VITE_OLLAMA_DEFAULT_MODEL?: string
  /** Temperature (default: 0.7) */
  readonly VITE_OLLAMA_TEMPERATURE?: string
  /** Top P / nucleus sampling (default: 0.9) */
  readonly VITE_OLLAMA_TOP_P?: string
  /** Top K (default: 40) */
  readonly VITE_OLLAMA_TOP_K?: string
  /** Context window size (default: 4096) */
  readonly VITE_OLLAMA_NUM_CTX?: string
  /** Repeat penalty (default: 1.1) */
  readonly VITE_OLLAMA_REPEAT_PENALTY?: string
  /** Fixed seed for reproducibility (default: random) */
  readonly VITE_OLLAMA_SEED?: string
  /** Frequency penalty (default: 0) */
  readonly VITE_OLLAMA_FREQUENCY_PENALTY?: string
  /** Presence penalty (default: 0) */
  readonly VITE_OLLAMA_PRESENCE_PENALTY?: string
  /** Enable the non-custodial Cashu eCash wallet surface (ADR-187). Off = zero behavioural change. */
  readonly VITE_CASHU_ENABLED?: string
  /** Enable the Escrow Trade Desk (ADR-355-362, `/trade/*`) — no live IC-mainnet canister exists yet. Default off; every environment must opt in explicitly (Product-Launch-Masterplan FU-662). */
  readonly VITE_ESCROW_TRADE_DESK?: string
  /** Kill switch for the public NIP-28 community chat (default: enabled). Set to 'false' to hide it without a redeploy. */
  readonly VITE_COMMUNITY_CHAT_ENABLED?: string
  /** Kind-40 event id (64-hex) of the Colabonate community channel. Defaults to the deployed channel. */
  readonly VITE_COMMUNITY_CHANNEL_ID?: string
  /** Comma-separated relay URLs the community channel is hosted on (default: wss://relay.damus.io,wss://relay.primal.net). */
  readonly VITE_COMMUNITY_RELAYS?: string
  /** Comma-separated blocked pubkeys (64-hex) hidden from the community chat. */
  readonly VITE_COMMUNITY_BLOCKED_PUBKEYS?: string
  /** Lightning Address (LUD-16, e.g. "name@domain") that receives "Support Colabonate" tips on Home. Unset = card hidden. */
  readonly VITE_PROJECT_LN_ADDRESS?: string
  /** Canonical public origin for absolute SEO URLs (canonical/og:url/og:image, ADR-287). Production passes SITE_URL; unset falls back to https://colabonate.app. */
  readonly VITE_SITE_URL?: string
  /** IC boundary-node host for browser-side canister trust verification (default: https://icp-api.io). */
  readonly VITE_ICP_HOST?: string
  /** Escrow canister id verified by default on /trade/verify (unset until the P7 pilot canister exists). */
  readonly VITE_ICP_ESCROW_CANISTER_ID?: string
  /** Declared DAO multisig controller principal for the escrow canister (unset until FU-253-H). */
  readonly VITE_ICP_ESCROW_DAO_CONTROLLER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string

interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nostr?: any;
}

declare module '*.css' {
  const content: string
  export default content
}
