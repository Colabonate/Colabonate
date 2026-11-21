// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import type { ReactNode } from 'react'
import {
  RocketLaunch,
  ShoppingCart,
  Store,
  Handshake,
  AccountBalanceWallet,
  Fingerprint,
  AccountBalance,
  ConfirmationNumber,
  Science,
  VpnKeyOutlined,
  SmartToy,
  Campaign,
  Forum,
} from '@mui/icons-material'

export interface HelpStep {
  label: string
  description: string
  link?: {
    url: string
    label: string
    subtext?: string
  }
}

export interface HelpTip {
  icon: 'lightbulb' | 'warning' | 'info'
  text: string
}

export interface HelpExpandedSection {
  title: string
  content: string
}

export interface HelpArticle {
  id: string
  layout?: 'open'
  title: string
  summary: string
  content: string
  steps?: HelpStep[]
  tips?: HelpTip[]
  expandedSections?: HelpExpandedSection[]
  tags: string[]
}

export interface HelpSectionDef {
  id: string
  title: string
  description: string
  icon: ReactNode
  color: string
  bgColor: string
  iconBg: string
  iconColor: string
  articles: HelpArticle[]
}

export const HELP_SECTIONS: HelpSectionDef[] = [
  {
    id: 'beta',
    title: 'Early Launch — Product Notes',
    description: 'What\'s live today, what\'s still being built, and what to know before you trade real sats.',
    icon: <Science sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-2)',
    bgColor: 'color-mix(in srgb, var(--color-accent-2) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-2) 15%, transparent)',
    iconColor: 'var(--color-accent-2)',
    articles: [
      {
        id: 'beta-1',
        title: 'Colabonate is live — what that means',
        summary: 'Real Nostr identities, real signatures, real Bitcoin. Nothing here is simulated.',
        content:
          'Colabonate is a live marketplace built on Nostr and Lightning. Every identity is a real Nostr keypair, every listing and trade event is a real cryptographically-signed Nostr event, and every payment moves real sats. There is no test network, no demo wallet, and no simulated money anywhere on this platform.',
        steps: [
          { label: 'Trade', description: 'Buy, sell, and cooperate — for real, with your own wallet' },
          { label: 'Check reputation', description: 'Look at a seller\'s reviews and history before you pay — see the next article for why this matters today' },
          { label: 'Feedback', description: 'Use the feedback widget to report bugs, rough edges, or ideas' },
          { label: 'Expect change', description: 'The platform is young — features, the catalog, and this help section are all still growing' },
        ],
        tips: [
          { icon: 'info', text: 'This is real money. Treat every trade the way you would on any other marketplace — nothing here is a sandbox.' },
          { icon: 'lightbulb', text: 'Colabonate is early. If something feels rough or missing, it probably is — tell us.' },
        ],
        expandedSections: [
          {
            title: 'We do not custody your Nostr key',
            content:
              'Your Nostr private key lives in your own browser extension (Alby, nos2x, Nostr Signer, etc.) or your NIP-46 bunker. Colabonate only ever sees your public key. We cannot sign anything on your behalf, and we cannot recover a lost key for you.',
          },
          {
            title: 'We collect error logs and feedback',
            content:
              'We collect error logs and feedback submissions to improve the platform. Logs include request metadata, error stack traces, and the Nostr pubkey associated with an action. This data is used only to diagnose issues and prioritise fixes.',
          },
        ],
        tags: ['launch', 'notice', 'real money', 'nostr', 'identity'],
      },
      {
        id: 'beta-2',
        title: 'Payments today: Direct-Pay, no platform escrow yet',
        summary: 'How you pay, what Colabonate does and doesn\'t hold, and why reputation matters right now.',
        content:
          'Colabonate uses Stage 1 Direct-Pay: when you buy something, you pay the seller\'s own Lightning address, NWC wallet, or Cashu eCash wallet directly. The platform never touches or holds your funds for these trades — it is fully non-custodial by design.',
        steps: [
          { label: 'Connect your wallet', description: 'A real Lightning wallet (WebLN, e.g. Alby) or Nostr Wallet Connect (NWC) is required to pay' },
          { label: 'Pay the seller directly', description: 'Your payment goes straight to the seller\'s configured rail — Colabonate is not in the money path' },
          { label: 'No forced refund today', description: 'Because the platform never holds the funds, it cannot claw back a payment if a trade goes wrong' },
          { label: 'A safety cap applies', description: 'Every transaction is capped at 210,000 sats while the platform is early — this is a deliberate, temporary limit, not a bug' },
        ],
        tips: [
          { icon: 'warning', text: 'There is no built-in refund mechanism for a Direct-Pay trade gone wrong — check a seller\'s reputation and reviews before paying, the same way you would on any peer-to-peer marketplace.' },
          { icon: 'info', text: 'A held, on-chain Bitcoin escrow for higher-value trades (via an ICP canister) is planned but not yet available to buyers — see the section below.' },
        ],
        expandedSections: [
          {
            title: 'Escrow is planned, not live yet for everyday trades',
            content:
              'A second, non-custodial escrow mechanism — Bitcoin held by a verifiable, open-source ICP smart-contract canister rather than by Colabonate — is designed and substantially built, intended for higher-value trades. It is not yet turned on for buyers. Until it is, every trade on the platform runs on Direct-Pay: no held funds, no platform-mediated reversal.',
          },
          {
            title: 'Disputes today',
            content:
              'Colabonate has a DAO Arbitration Council for reviewing disputes on completed tickets. For an un-escrowed Direct-Pay trade, though, the Council can rule on a dispute but cannot force money back from a seller who has already been paid — there is nothing held to release or return. Resolution today rests on reputation, reviews, and goodwill, the same trust model most peer-to-peer marketplaces run on before an escrow layer exists.',
          },
        ],
        tags: ['payments', 'direct-pay', 'escrow', 'non-custodial', 'disputes', 'safety cap'],
      },
      {
        id: 'beta-3',
        title: 'Cashu eCash wallet (opt-in)',
        summary: 'A second, fully client-side balance — real value, with a real, disclosed risk profile.',
        content:
          'Alongside your Lightning wallet, Colabonate offers an opt-in, fully non-custodial Cashu eCash wallet (NIP-60/61). Enable it under Settings → Wallet → "Enable non-custodial eCash (Cashu)".',
        tips: [
          { icon: 'info', text: 'The app ships two default mints: mint.minibits.cash (the Colabonate-recommended mint, real value) and testnut.cashu.space (a public test mint with no real value, useful for exploring the feature risk-free).' },
          { icon: 'warning', text: 'Cashu proofs are bearer tokens you hold yourself — losing your wallet state (e.g. clearing browser storage) means losing the balance, with no way for Colabonate to recover it.' },
        ],
        expandedSections: [
          {
            title: 'Non-custodial by design',
            content:
              'You hold the Cashu proofs — the Colabonate server never stores or sees them. You can add mints beyond the two defaults yourself; any mint outside the two shipped defaults is shown as unvetted.',
          },
          {
            title: 'No mint publishes an audited proof-of-reserves',
            content:
              'This is a disclosed, ecosystem-wide gap today — no Cashu mint, including the recommended one, currently publishes an independently audited proof-of-reserves. Treat mint balances with the same caution you would apply to any custodial-adjacent bearer-token system.',
          },
        ],
        tags: ['cashu', 'ecash', 'nip-60', 'nip-61', 'non-custodial', 'known limitations'],
      },
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'Set up your account and learn the basics of Colabonate.',
    icon: <RocketLaunch sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-1)',
    bgColor: 'color-mix(in srgb, var(--color-accent-1) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-1) 15%, transparent)',
    iconColor: 'var(--color-accent-1)',
    articles: [
      {
        id: 'gs-1',
        layout: 'open',
        title: 'Create your account',
        summary: 'How Lightning and Nostr authentication works and what you need to get started.',
        content:
          'Colabonate uses Lightning Network and Nostr protocol for authentication. No email or password required. Simply connect with a Lightning-compatible wallet (like Alby) or a Nostr extension (like nos2x). Your identity is tied to your public key — secure, decentralized, and portable.',
        steps: [
          {
            label: 'Install Alby',
            description: 'Get a Lightning wallet browser extension',
            link: {
              url: 'https://getalby.com/alby-extension',
              label: 'Guided setup with Alby',
              subtext: 'Free Nostr signer and Lightning wallet for Chrome, Firefox, Edge, Safari and Opera.',
            },
          },
          { label: 'Connect', description: 'Click "Login" and approve the connection' },
          { label: 'Set up profile', description: 'Add your name and optional avatar' },
          { label: 'Choose Identity Level', description: 'Start at L0 or upgrade to L1 for more trust' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Your pubkey is your identity — keep your NIP-07 extension secure.' },
        ],
        tags: ['account', 'auth', 'nostr', 'lightning'],
      },
      {
        id: 'gs-6',
        layout: 'open',
        title: 'Get started with Nostr',
        summary: 'New to Nostr? Generate your keys, install a signer, fund Lightning, and connect to Colabonate — your complete first-time guide.',
        content:
          'Welcome! Nostr is the decentralized protocol behind your Colabonate identity. Nostr itself has no email and no password: a cryptographic keypair IS your account. Colabonate\'s onboarding can create that keypair for you right in the browser — with an email or completely without one — and shows you the nsec to back up. This guide walks a complete newcomer from "what is a key?" all the way to logging in to Colabonate and making your first move.',
        steps: [
          {
            label: 'Get your Nostr identity',
            description: 'Your keypair is your account. npub is the public address others follow; nsec is the secret — never share it',
            link: {
              url: 'https://nosta.me/',
              label: 'Create your identity with nosta.me',
              subtext: 'Generates your Nostr keypair and profile in one simple flow — perfect for your first identity.',
            },
          },
          { label: 'Back up your nsec', description: 'Your nsec is the password to your identity. Onboarding shows it to you and asks you to save it — write it down or store it in a password manager immediately. There is no password reset: lose it, lose the account forever' },
          {
            label: 'Install a signer (recommended)',
            description: 'A signer like Alby, nos2x, or Amber holds your key and signs for every app, so your nsec never leaves it. Prefer a guided setup? Tools like nosta.me walk you through creating a profile and connecting a signer in one flow.',
            link: {
              url: 'https://getalby.com/alby-extension',
              label: 'Guided setup with Alby',
              subtext: 'Free Nostr signer and Lightning wallet for Chrome, Firefox, Edge, Safari and Opera.',
            },
          },
          {
            label: 'Fund a Lightning wallet',
            description: 'Colabonate runs on Bitcoin Lightning. Connect a wallet to pay for offers and receive payments',
            link: {
              url: 'https://getalby.com/',
              label: 'Top up your Alby wallet',
              subtext: 'Receive sats to your Alby Lightning address, or buy Bitcoin inside the extension.',
            },
          },
          { label: 'Connect to Colabonate', description: 'On the login screen choose "via Signer" and approve the prompt — your signer signs without exposing your key' },
          { label: 'Build your network', description: 'Set a profile name, avatar, and optional NIP-05 so your Colabonate reputation travels across all Nostr apps' },
        ],
        tips: [
          { icon: 'warning', text: 'CRITICAL: never share your nsec or paste it into a website. If someone gets it they can impersonate you completely; if you lose it, your account and reputation are gone forever — there is no password reset. A signer app keeps it out of harm\'s way.' },
          { icon: 'lightbulb', text: 'Your npub is portable: the same identity works in Damus, Amethyst, Iris, Primal, and every Nostr app — not just Colabonate.' },
          { icon: 'info', text: 'No Nostr key yet? Email login gives you an instant L0 account; attach a real signer later from Account → Identity & Security.' },
        ],
        expandedSections: [
          {
            title: 'Create your identity on Colabonate — with or without email',
            content:
              'Colabonate’s onboarding offers two ways in. With email: you get a one-tap sign-in link, your Colabonate account is created, and then your Nostr identity is generated in the browser (the newsletter is a separate, optional checkbox). Without email: only your Nostr identity is generated — nothing is sent to us and no newsletter is involved. Both paths show your 12-word recovery phrase and your nsec; they are two encodings of the same key, and the nsec is your password. You can also download both as a backup file. After the backup, the email-less path lets you choose: "Continue with this identity" creates a Colabonate account for it without any email, or "Save my identity and finish" stops there and leaves you with a standalone Nostr identity you can use in any Nostr app. Once your identity is linked to your Colabonate account, signing in later with a signer that holds it (recommended) or with the nsec login brings you back to that same account on any device. On a new device, in-app actions are signed by that device’s own key unless you connect your signer.',
          },
          {
            title: 'What is Nostr (and why Colabonate runs on it)?',
            content:
              'Nostr ("Notes and Other Stuff Transmitted by Relays") is a simple, censorship-resistant protocol for publishing signed events. Instead of one company holding your account, you hold a keypair and everything you publish is cryptographically signed by it. Colabonate builds on Nostr so your identity, offers, tickets, and reviews stay portable, verifiable, and impossible to silently revoke — the same key works across the whole ecosystem, so you are never locked in.',
          },
          {
            title: 'Two ways to get your keys',
            content:
              'Option 1 — generate keys inside a Nostr client app (e.g. Damus on iOS, Primal, Amethyst on Android): the app creates the keypair for you, but you must back up the nsec it shows immediately. Option 2 — use a signer first (recommended for security): install a dedicated signer such as Alby (browser extension), Amber (Android), nsec.app, or Nostore, generate your keys within it, back up the nsec, then connect to clients including Colabonate by choosing "Login with signer / extension". The signer signs on your behalf and your private key never leaves it — the safest way to use many apps. Colabonate login uses the NIP-07 signer path (Option 2).',
          },
          {
            title: 'NIP-07 vs NIP-46 — which signer?',
            content:
              'NIP-07 keeps your private key inside a browser extension (Alby, nos2x, Nostr Signer, Flint) and signs locally — easiest for desktop. NIP-46 (Nostr Connect) keeps the key on a remote "bunker" such as Alby Hub, Amber, or nsecBunker; your browser asks the bunker to sign over a Nostr message, so the key never enters the browser. Pick NIP-07 for a quick desktop setup; pick NIP-46 for the strongest day-to-day security and mobile support. Both are first-class on Colabonate.',
          },
          {
            title: 'Relays and Zaps — the basics',
            content:
              'Relays are the servers that store and distribute Nostr messages. Your client connects to several relays to send and receive notes and events — you can add or remove them anytime, which gives you control over where your data lives. Zaps are Bitcoin Lightning payments sent directly through Nostr, an easy way to support creators and show appreciation. Colabonate\'s escrow and peer-to-peer payments are built on the same Lightning layer, so the wallet you fund in Step 4 is what powers every payment on the platform.',
          },
        ],
        tags: ['nostr', 'get started', 'onboarding', 'npub', 'nsec', 'nip-07', 'nip-46', 'signer', 'identity', 'keys', 'alby', 'lightning', 'zaps', 'relays'],
      },
      {
        id: 'gs-2',
        title: 'Identity levels explained',
        summary: 'L0 (Anonymous) to L3 (HID Verified) — what each level enables and how to climb the ladder.',
        content:
          'Colabonate uses a four-tier identity system to balance privacy, trust, and access. L0 (Anonymous) is where every account starts, no matter which login provider you use. L1 (Nostr Profile) links your account to a Nostr public key so you can trade. L2 (Peer Verified) adds in-person community verification and unlocks governance. L3 (HID Verified) is the highest tier: a zero-knowledge biometric proof via Humanode Biomapper that guarantees one person, one account.',
        steps: [
          { label: 'L0 Anonymous', description: 'Default after login — browse only, no trading' },
          { label: 'L1 Nostr Profile', description: 'Link a Nostr key via NIP-07 (Alby, nos2x, etc.) to create offers and tickets' },
          { label: 'L2 Peer Verified', description: 'Two independent verifiers confirm your identity — unlocks DAO governance and higher limits' },
          { label: 'L3 HID Verified', description: 'Humanode Biomapper ZK biometric proof — 1-person-1-vote and arbitrator eligibility' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Login providers (Nostr, Lightning, Alby, MetaMask, Email, Nostr Connect) all create an L0 account. Upgrade to L1 to unlock trading.' },
          { icon: 'info', text: 'L2 currently has a mock upgrade path in the UI; the full protocol requires two in-person verifiers and a proximity proof.' },
          { icon: 'warning', text: 'L3 is not yet implemented; the Humanode HID flow is planned for a later phase.' },
        ],
        expandedSections: [
          {
            title: 'L0 Anonymous — browse before you trust',
            content:
              'When you log in with any provider — Nostr (NIP-07), Lightning/LNURL-auth, Alby OAuth, MetaMask, Email magic link, or Nostr Connect (NIP-46) — your account starts at L0. This level lets you browse the marketplace, view offers and vendors, and create a basic profile, but you cannot create offers, start or accept tickets, or participate in governance. L0 is designed for exploration with minimal commitment.',
          },
          {
            title: 'L1 Nostr Profile — how to unlock trading',
            content:
              'To reach L1 you link a Nostr profile to your Colabonate account. Go to Account → Identity & Security → Identity Levels and choose "Connect Nostr Profile → Level 1". You need a NIP-07 browser extension such as Alby or nos2x. The flow has three steps: (1) publish a Nostr Kind-0 profile with your display name and Lightning address (lud16), (2) publish a Kind-30021 identity credential that binds your Nostr pubkey to your Colabonate LNURL-auth pubkey, and (3) sign a NIP-98 auth event and call POST /api/identity/upgrade-l1. Once verified, you can create offers, open and accept tickets, and build public reputation.',
          },
          {
            title: 'L2 Peer Verified — governance and higher limits',
            content:
              'Level 2 is reached when two independent community verifiers confirm your identity through an in-person proximity proof. The protocol requires you to post a security deposit, meet both verifiers in person, and have each verifier publish a Kind-30026 Proximity Proof event. When the protocol confirms both proofs, a Kind-30021 identity_level_2 credential is issued and your account is upgraded. In the current implementation this is exposed as a mock button ("Start Peer Verification (Mock)"); completing it also awards 50 COL-Points. L2 unlocks DAO governance votes, higher trade limits, priority matching, and reduced dispute risk.',
          },
          {
            title: 'L3 HID Verified — one person, one account',
            content:
              'L3 is the highest trust tier. It uses Humanode Biomapper to generate a zero-knowledge biometric proof that you are a unique human, without revealing your identity or storing biometric data on Colabonate servers. The planned flow requires an L2 account, the Colabonate app with the Humanode Biomapper SDK, an on-device fingerprint scan, submission of an anonymous ZK commitment, and publication of a Kind-30023 HID attestation event. L3 unlocks 1-person-1-vote governance weight, arbitrator eligibility, maximum ticket limits, and the full trust multiplier. This level is currently shown as "Phase 4 – Coming soon" and is not yet available.',
          },
          {
            title: 'How login providers relate to your identity level',
            content:
              'Your login method determines how you authenticate, not your identity level. Nostr (NIP-07) and Nostr Connect (NIP-46) sign challenges with your Nostr private key. Lightning/LNURL-auth and Alby OAuth prove control of a Lightning wallet. MetaMask derives a Nostr identity from your Ethereum address after two signatures. Email sends a magic link. All of these create or access an L0 account. To trade, you still need to upgrade to L1 by linking a Nostr profile, because offers, tickets, reviews, and reputation on Colabonate are Nostr events signed by your pubkey.',
          },
          {
            title: 'Why identity levels matter',
            content:
              'Identity levels are Colabonate\'s sybil-resistance and trust layer. Higher levels make it harder for one person to operate many fake accounts, which protects reviews, votes, and escrow. They also signal trust to other users: buyers prefer L2/L3 sellers for high-value orders, and the platform requires L3 for sensitive roles such as arbitration. Each level is additive — L1 proves key ownership, L2 adds social verification, and L3 adds biometric uniqueness — so you only share as much information as needed for the features you want to use.',
          },
        ],
        tags: ['identity', 'verification', 'hid', 'trust', 'login', 'nostr', 'peer verification'],
      },
      {
        id: 'gs-3',
        title: 'Your first steps',
        summary: 'Navigate the app, explore the marketplace, and set up your profile.',
        content:
          'After login you will land on the Home screen. Use the bottom navigation to browse Buy, Sell, and Cooperate sections. Tap your profile to add a photo and description. Explore categories in the Buy tab to discover what is available nearby.',
        tips: [
          { icon: 'lightbulb', text: 'Use the search bar on Home to find specific products or services.' },
          { icon: 'info', text: 'Set up your profile before creating your first offer to build trust faster.' },
        ],
        tags: ['navigation', 'profile', 'explore'],
      },
      {
        id: 'gs-4',
        title: 'Onboarding walkthrough',
        summary: 'What each onboarding screen means and how to skip or complete it.',
        content:
          'The onboarding flow guides new users through profile setup, identity verification, and key features. You can skip individual screens and return later. Completed screens are marked with a checkmark. Finish onboarding to unlock full platform features.',
        tips: [
          { icon: 'info', text: 'You can restart the onboarding from Settings at any time.' },
        ],
        tags: ['onboarding', 'setup'],
      },
      {
        id: 'gs-5',
        title: 'Sign in with MetaMask',
        summary: 'Use your MetaMask browser extension as a login method.',
        content:
          'If you already have MetaMask installed, you can use it to log in to Colabonate. The app asks you to sign two messages: one to derive your Nostr identity, and one to authenticate the session. Neither message spends gas or sends a transaction. Once signed, Colabonate creates an account linked to your Ethereum address and the derived Nostr public key.',
        steps: [
          { label: 'Install MetaMask', description: 'Add the MetaMask extension to your browser' },
          { label: 'Choose MetaMask tab', description: 'On the login screen, select the MetaMask tab' },
          { label: 'Sign derivation', description: 'Approve the "derive identity" signature (one-time per address)' },
          { label: 'Sign authentication', description: 'Approve the session signature to log in' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Your Nostr identity is reproducible from your MetaMask seed — keep your recovery phrase safe.' },
          { icon: 'warning', text: 'MetaMask is not a Lightning wallet. You still need a Lightning wallet for payments.' },
        ],
        tags: ['metamask', 'auth', 'evm', 'login'],
      },
    ],
  },
  {
    id: 'login-providers',
    title: 'Login providers',
    description: 'How you sign in to Colabonate — Nostr, Lightning, Email, Alby, MetaMask. Each has a different key, recovery, and signing story.',
    icon: <VpnKeyOutlined sx={{ fontSize: 22 }} />,
    color: 'var(--color-primary-50)',
    bgColor: 'color-mix(in srgb, var(--color-primary-50) 7%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-primary-50) 14%, transparent)',
    iconColor: 'var(--color-primary-50)',
    articles: [
      {
        id: 'lp-1',
        title: 'Login providers — overview',
        summary: 'A login provider decides how you prove who you are. Colabonate currently supports six, each with a different key custody and recovery story.',
        content:
          'A login provider is the method you use to authenticate when you open Colabonate. It determines where your identity private key lives (extension, NIP-46 bunker, Lightning wallet, browser cache, or nowhere on the client at all), how you recover access on a new device, and what events you can sign. Colabonate currently supports Nostr (NIP-07 and NIP-46), Lightning / LNURL-auth, Alby OAuth, Email magic link, and MetaMask — six entry points that all share the same trust backbone. None of them set your identity level on its own: every login lands you at L0 (Anonymous); climbing to L1, L2, and L3 is a separate flow covered in Identity levels explained (gs-2).',
        steps: [
          { label: 'Pick a provider', description: 'Choose based on how you currently sign Nostr events and where you want your key to live' },
          { label: 'Sign in', description: 'Approve one challenge (NIP-07), one signature (MetaMask), or click a magic link (Email)' },
          { label: 'Land at L0', description: 'Every provider gives you an anonymous account — no trading yet' },
          { label: 'Upgrade to L1+', description: 'Link a real Nostr profile so you can create offers, sign tickets, and build reputation' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Login provider = how you authenticate. Identity level = how much trust you carry. They are independent: you can sign in via Email and later link a Nostr extension to reach L1.' },
          { icon: 'info', text: 'You can link multiple providers to the same account (e.g. sign in with Email, then connect a NIP-46 bunker and a Lightning wallet). The originating email always remains your fallback.' },
        ],
        expandedSections: [
          {
            title: 'Why so many providers?',
            content:
              'Different communities trust different ecosystems. Nostr-native users prefer NIP-07 / NIP-46 because the private key never leaves their extension or bunker. Lightning-only users authenticate with LNURL-auth and never touch a Nostr keypair. Crypto-curious users coming from EVM chains expect MetaMask. New users coming from the mainstream web expect email. Colabonate meets them all at the same gate and binds every provider to the same account, the same trust ladder, and the same offer/ticket/reputation graph on the back end.',
          },
          {
            title: 'What a login provider actually decides',
            content:
              'Three things. (1) Where the secret lives — an extension in your browser, a remote NIP-46 bunker, a Lightning wallet on your phone, a server-side random placeholder for Email, or a deterministic derivation from a MetaMask signature. (2) Whether the secret ever touches the client at all — Email login generates a random pubkey and the privkey is thrown away; the account is bound to the email address only. (3) Whether the user can sign Nostr events from a new device without help — Nostr/extension and Lightning wallets can, Email cannot without re-upgrading.',
          },
        ],
        tags: ['login', 'auth', 'providers', 'overview', 'nostr', 'lightning', 'email'],
      },
      {
        id: 'lp-2',
        title: 'Sign in with Nostr (NIP-07 & NIP-46)',
        summary: 'The native Colabonate login — your Nostr key stays in your extension or remote bunker and signs every action.',
        content:
          'Nostr authentication comes in two flavours. NIP-07 keeps the private key inside a browser extension (Alby, nos2x, Nostr Signer, Flint, Damus) and signs challenges locally. NIP-46 (Nostr Connect) keeps the key on a remote "bunker" (Alby Hub, Amber, nsecBunker) and the browser signs by asking the bunker over a Nostr DM. Both are first-class providers and Colabonate uses them to sign every event the same way the rest of the Nostr ecosystem does.',
        steps: [
          { label: 'NIP-07', description: 'Install an extension like Alby or nos2x and click Login → Nostr. The extension prompts you to approve a NIP-98 auth event.' },
          { label: 'NIP-46', description: 'Open the Connect tab, paste a bunker connection string (bunker://...) or scan a QR code. Alby Hub or Amber holds the key.' },
          { label: 'Approve', description: 'One prompt, one signature. No transaction, no fee, no email.' },
          { label: 'Published profile', description: 'If your NIP-05 identifier is set in your extension, Colabonate reads it for the username field on your profile.' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'NIP-46 (bunker) is the strongest option for day-to-day use: the key never enters your browser, so a compromised browser cannot steal it.' },
          { icon: 'info', text: 'Nostr login also lets you skip the "publish profile then upgrade" flow — if you already have Kind-0 metadata you are one click from L1.' },
          { icon: 'warning', text: 'Connecting a new signer creates a new public key. Reputation does not transfer automatically — migrate early, before you build reputation.' },
        ],
        expandedSections: [
          {
            title: 'Key custody and recovery',
            content:
              'NIP-07: your private key lives in the extension. Back it up using the extension\'s own export flow (usually a 12-word seed or nsec string). Never paste that seed into another website — Colabonate staff will never ask for it. NIP-46: the key lives on your bunker (phone, server, hardware wallet). Loss of the bunker plus its recovery phrase is loss of identity; the protocol is designed to make accidental loss harder than for a browser extension by requiring explicit connect-URI rotation.',
          },
          {
            title: 'Why Nostr login is the recommended baseline',
            content:
              'Two reasons. First, Colabonate\'s marketplace, tickets, reviews, and COL-Points are all signed Nostr events — the same kind-30000 / kind-1 / kind-30023 events used across the wider Nostr ecosystem. A Nostr-native login signs those natively with no extra step. Second, Nostr keys are portable: the same npub works in Damus, Amethyst, Snort, Iris, and any other Nostr client, so your identity is never locked to Colabonate.',
          },
        ],
        tags: ['nostr', 'nip-07', 'nip-46', 'bunker', 'alby', 'extension', 'auth'],
      },
      {
        id: 'lp-3',
        title: 'Sign in with Lightning (LNURL-auth)',
        summary: 'Authenticate by signing a challenge with your Lightning node — your wallet becomes your identity, no Nostr required.',
        content:
          'Lightning / LNURL-auth proves control of a Lightning node by signing a one-time challenge. The private key lives inside the wallet (LNBits custodial, Alby Hub self-custodial, Zeus, BlueWallet, etc. — not every Lightning wallet supports LNURL-auth login; Phoenix, for example, does not) and never leaves the device. On Colabonate, this provider creates an LNURL-auth identity pubkey that the wallet keeps custody of — separate from the Nostr key space — and that pubkey is what signs escrow holds and Lightning-authenticated actions.',
        steps: [
          { label: 'Open the Lightning tab', description: 'On the login screen, choose Lightning. A QR code or lnurl-auth:// URL appears.' },
          { label: 'Approve in your wallet', description: 'Scan the code with Alby, Zeus, BlueWallet, or any other LNURL-auth-capable wallet. Note: Phoenix does not support LNURL-auth login.' },
          { label: 'Wait for confirmation', description: 'Your wallet signs the challenge, the server verifies the signature, and you are in.' },
          { label: 'Same identity on next visit', description: 'Subsequent logins use the same LNURL-auth flow — your key is locked to that wallet.' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Best when your Lightning wallet is your primary tool — you do not need a Nostr extension just to log in.' },
          { icon: 'info', text: 'The LNURL-auth pubkey is distinct from a Nostr pubkey. To reach L1 (and create offers / tickets / reviews), link a Nostr profile separately via Account → Identity & Security.' },
          { icon: 'warning', text: 'Lose your Lightning wallet seed → lose the LNURL-auth identity. Back it up the way your wallet recommends.' },
        ],
        expandedSections: [
          {
            title: 'Custodial vs. non-custodial Lightning login',
            content:
              'Two distinct stories. Custodial (LNBits, hosted wallets): you trust the operator with the seed; losing your account password means losing identity. Recovery is via the custodian\'s account-recovery flow. Non-custodial (Alby Hub self-hosted, Zeus, BlueWallet mobile): you hold the seed, just like with a Nostr extension; recovery is by seed phrase. Colabonate supports both; pick whichever wallet you already trust — as long as it supports LNURL-auth login specifically (many popular wallets, including Phoenix, only support LNURL-pay/withdraw, not LNURL-auth). The LNURL-auth pubkey is generated deterministically from the node\'s identity pubkey, so the same wallet always produces the same Colabonate identity.',
          },
          {
            title: 'Why Lightning-only users should add Nostr',
            content:
              'Colabonate\'s offer, ticket, and review events live in the Nostr event space. If your only login is Lightning, you can browse, pay, and receive sats — but to publish an offer or write a review you need a Nostr key. The recommended path is: log in with Lightning, then go to Account → Identity & Security → Signer / Bunker and add a Nostr signer (NIP-07 extension or NIP-46 bunker). Your Lightning identity remains linked; the Nostr key rides alongside it.',
          },
        ],
        tags: ['lightning', 'lnurl', 'lnurl-auth', 'wallet', 'alby', 'zeus', 'bluewallet'],
      },
      {
        id: 'lp-4',
        title: 'Sign in with Email (magic link)',
        summary: 'No extension, no wallet, no Nostr key — just an email address. Convenient, but L0 only and browser-bound until you upgrade.',
        content:
          'Email login is the most accessible provider in Colabonate: enter an address, receive a one-time link, click to sign in. There is no password and no extension to install. The trade-off is that you arrive at L0 (Anonymous) with a Nostr private key that lives only in your browser cache, and your account is only as portable as your email — so the account itself survives, but your offers, tickets, reviews, COL-Points, and reputation are tied to that browser key. The recommended path is to sign in once, then immediately link a Nostr extension or a Lightning wallet to lift your account to L1 and make your identity portable. The newsletter is optional: tick the box when you create your account if you want it, and turn it on or off any time under Settings → Account → Notifications. If you would rather not hand over an email at all, the onboarding offers a second path that creates a standalone Nostr identity in the browser and shows you the nsec (your password) to back up.',
        steps: [
          { label: 'Enter your email', description: 'Type any address you control. No password, no extension.' },
          { label: 'Open the magic link', description: 'Click the unique URL in the email within 15 minutes. It opens Colabonate and signs you in.' },
          { label: 'Land at L0 — anonymous', description: 'You can browse the marketplace and set up a profile, but you cannot yet create offers, open tickets, or join DAO votes.' },
          { label: 'Link a Nostr key to reach L1', description: 'Go to Account → Identity & Security → Identity Levels → Connect Nostr Profile → Level 1. Takes about a minute.' },
          { label: 'Optionally link a Lightning wallet', description: 'Required for paying and receiving sats without switching tabs.' },
        ],
        tips: [
          { icon: 'warning', text: 'Your Nostr private key lives in this browser only. Clear your browser data before connecting a Nostr extension or Lightning wallet and you lose your offers, tickets, reviews, and COL-Points — only your email-bound identity is kept on the server. Link a Nostr signer before clearing anything.' },
          { icon: 'info', text: 'You can sign in from as many devices as you like as long as you have the email — but each device gets its own Nostr key. Keep them in sync by always reconnecting the same Nostr extension.' },
          { icon: 'lightbulb', text: 'Email login is intentionally minimal. It is designed for first-time users and low-stakes browsing. Anyone who plans to trade, sell, or participate in governance should connect a Nostr extension or a Lightning wallet soon after signing in.' },
        ],
        expandedSections: [
          {
            title: 'What email login is — and what it is not',
            content:
              'IS: an address, a server-issued one-time link, a session token stored in localStorage. The server creates a User row keyed by your email address and a random Nostr pubkey for browser-side signing. After verify, your public key is published as your identity anchor. IS NOT: a password manager, a Nostr key backup, or a long-term identity solution. The nsec never leaves your browser. There is no "account recovery via email" — we cannot email you back a private key we have never held (ADR-141). If you lose the browser key, you can sign in again from scratch (same email, new nsec, empty reputation) and re-link any future offers from the new pubkey.',
          },
          {
            title: 'The honest custody story',
            content:
              'Under the hood, three things happen when you click the magic link. (1) The server creates or reuses a User row by email. (2) Your browser generates (or reuses) a nsec in localStorage and sends the corresponding pubkey along with the verify request. (3) A session token is written to localStorage. From this point on, every Nostr event you sign uses the nsec in your browser; none of those events can be re-signed from another device unless that device also has the same nsec. (4) Linking a Nostr extension or a NIP-46 bunker migrates your sign capability to a stronger holder; the email-bound user row is preserved, but the active signer becomes the extension.',
          },
          {
            title: 'When to choose Email login',
            content:
              'Choose Email when you want to try Colabonate with the lowest possible commitment, when you are on a device where you cannot install extensions (work computer, tablet), or when you are evaluating the marketplace before investing in a wallet. Upgrade to a Nostr or Lightning provider as soon as you decide to trade. You do not need to delete your email-bound account — linking keeps the history and adds the new signer alongside.',
          },
          {
            title: 'Security practices for Email login',
            content:
              'Use an email address you trust with security notifications (ideally one tied to a hardware-key 2FA). Never click a Colabonate magic link in a forwarded email chain — open it directly from your inbox and verify the sender domain. Do not use Email login on a shared or kiosk device: anyone with browser access can act as you until the session expires. Always sign out from Account → Sign out when finished on a borrowed machine.',
          },
        ],
        tags: ['email', 'magic link', 'login', 'recovery', 'l0', 'privacy', 'browser'],
      },
      {
        id: 'lp-5',
        title: 'Choosing your provider — comparison and recommendations',
        summary: 'A side-by-side comparison of all six Colabonate login providers plus a short decision guide.',
        content:
          'All six providers create the same kind of account and take you to the same trust ladder — the difference is where the private key lives, who can recover it on a new device, and what you can sign without an extra step. Use this comparison when you are choosing a provider for the first time or deciding whether to add a second one to your existing account.',
        steps: [
          { label: 'Read the table', description: 'Nine rows × six providers. Focus on "Primary holder", "Cross-device", and "What it signs".' },
          { label: 'Pick by use case', description: 'Active trader → Nostr (NIP-07/NIP-46). Wallet-first → LNURL-auth. First-look → Email.' },
          { label: 'Link a second provider', description: 'You can always add Nostr or Lightning later from Account → Identity & Security.' },
          { label: 'Always back up your key', description: 'Regardless of provider, the rule is the same: back it up offline before clearing browser data.' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Most active users end up with two providers: a primary Nostr or NIP-46 bunker for signing, and Email as a recovery / fallback. Both are linked to the same User row.' },
          { icon: 'info', text: 'Custody labels use these shorthands: extension = browser extension, bunker = NIP-46 remote signer, custodial = hosted wallet, non-custodial = self-hosted or hardware.' },
        ],
        expandedSections: [
          {
            title: 'Comparison table',
            content:
              'Provider | Where the key lives | How you recover | Signs Nostr events natively | Cross-device without help | Recommended for\n' +
              '\n' +
              'Nostr NIP-07 | Browser extension (Alby, nos2x) | Extension\'s seed/nsec export | Yes (NIP-07 call) | Yes — install extension on each device, same nsec | Native Nostr users\n' +
              '\n' +
              'Nostr NIP-46 (Connect) | Remote bunker (Alby Hub, Amber) | Bunker seed + bunker-URI rotation | Yes (NIP-46 over relay) | Yes — paste bunker:// on each device | Day-to-day "no key in browser" use\n' +
              '\n' +
              'Lightning / LNURL-auth | Inside your Lightning wallet (must support LNURL-auth specifically — not every wallet does, e.g. not Phoenix) | Wallet seed | No — separate LNURL-auth pubkey; Nostr events need an extra signer | Yes if wallet supports multiple devices (e.g. Zeus) | Wallet-first users, no Nostr client yet\n' +
              '\n' +
              'Alby OAuth | Alby account + linked wallet | Alby account credentials + 2FA | Limited — Alby acts as a hosted NIP-07 | Yes (hosted) | New users without a Nostr extension\n' +
              '\n' +
              'MetaMask | Derived deterministically from one signature + your EVM seed | MetaMask seed + re-sign derivation | Yes via window.ethereum adapter | Yes — sign derivation again on each device | EVM-native users\n' +
              '\n' +
              'Email (magic link) | Browser cache only; User row keyed by email on server | Re-request a magic link from any device; reputation does NOT transfer | Only on the browser that holds the nsec | The account does; the Nostr key and reputation do not | First-look, low-commitment exploration',
          },
          {
            title: 'Decision guide',
            content:
              'Ask three questions. (1) Do I already have a Nostr extension or NIP-46 bunker? Yes → Nostr login. (2) Do I have a Lightning wallet but no Nostr client? Yes → Lightning / LNURL-auth. (3) Do I have neither and just want to look around? Yes → Email, then upgrade as soon as you decide to trade. Once you have any of these, you can add the others from Account → Identity & Security without losing your data.',
          },
          {
            title: 'Linking more than one provider to the same account',
            content:
              'Every provider writes to the same User row. Adding a second one — for example connecting a NIP-46 bunker to an existing email account — does not change the row, it adds a new signer signature method. The order matters: the email remains the canonical recovery address; the added Nostr or Lightning key becomes the active signer for new events. Existing events stay pinned to whatever key signed them, so reputation is preserved event-by-event.',
          },
        ],
        tags: ['comparison', 'recommendation', 'decision', 'providers', 'custody', 'recovery', 'cross-device'],
      },
    ],
  },
  {
    id: 'ai-agents',
    title: 'AI & Agents',
    description: 'The Colabonate AI assistant, hosted credits, agent listings, workspaces, and connecting your own agent over MCP.',
    icon: <SmartToy sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-3)',
    bgColor: 'color-mix(in srgb, var(--color-accent-3) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-3) 15%, transparent)',
    iconColor: 'var(--color-accent-3)',
    articles: [
      {
        id: 'ai-1',
        title: 'The Colabonate AI Assistant',
        summary: 'Ask about offers, tickets, and cooperations — the assistant reads your marketplace data and can take simple actions.',
        content:
          'The AI assistant works with your Colabonate data. Open the chat from the floating button on Home or the full page at /ai (login required). Quick actions cover Buy, Sell, Cooperate, Insights, and Help — for example "Find offers", "My tickets", "Create offer", or "Dispute help". The assistant can look up offers and tickets, explain how things work, and help draft actions, but you confirm everything.',
        steps: [
          { label: 'Open it', description: 'Use the AI assistant button on Home, or open /ai from the navigation' },
          { label: 'Ask or pick a quick action', description: 'Type a question, or tap a chip such as Find offers, My tickets, or Dispute help' },
          { label: 'Review the answer', description: 'The assistant reads your marketplace data; you stay responsible for what you confirm' },
          { label: 'Change the model', description: 'Pick a different provider any time under Settings → AI' },
        ],
        tips: [
          { icon: 'warning', text: 'The assistant can be wrong. Verify prices, identities, and ticket states before you pay or publish anything.' },
          { icon: 'info', text: 'Guests can try the assistant from the Home page with session credits; the full /ai page and saved chat history need a login.' },
        ],
        tags: ['ai', 'assistant', 'chat', 'help', 'quick actions'],
      },
      {
        id: 'ai-2',
        title: 'AI providers — hosted or your own',
        summary: 'Run the assistant on Colabonate Hosted, a local Ollama model, any OpenAI-compatible endpoint, or an installed CLI agent.',
        content:
          'Settings → AI lets you choose how the assistant runs. Colabonate Hosted needs no setup and is paid per pack of requests. Local (Ollama) runs the model inside this deployment. OpenAI-compatible connects any OpenAI-style endpoint (OpenAI, Groq, LM Studio) with a key stored encrypted server-side. CLI Agent drives an installed command-line agent (OpenCode, Pi Agent, Hermes); it is text-only and one request equals one agent run.',
        steps: [
          { label: 'Open Settings → AI', description: 'Find the provider cards at the top of the AI tab' },
          { label: 'Pick a provider', description: 'Hosted, Local (Ollama), OpenAI-compatible, or CLI Agent' },
          { label: 'Configure if needed', description: 'Enter endpoint, model, or key for the non-hosted providers' },
          { label: 'Watch the badge', description: 'The current provider and remaining hosted credits show next to the input' },
        ],
        tips: [
          { icon: 'info', text: 'Colabonate Hosted may not be switched on for every deployment yet — the Settings card tells you when it is unavailable.' },
          { icon: 'lightbulb', text: 'Local (Ollama) keeps prompts on the platform, hosted is the easiest start, and a CLI agent is best if you already run one.' },
        ],
        tags: ['ai', 'providers', 'ollama', 'openai', 'cli agent', 'settings', 'hosted'],
      },
      {
        id: 'ai-3',
        title: 'Colabonate Hosted credits',
        summary: 'Request packs bought directly over Lightning — no subscription, and credits never expire.',
        content:
          'Colabonate Hosted runs the model for you and is metered in requests. Buy a pack in Settings → AI under the Colabonate Hosted card, or from the AI section on Home. Pay the Lightning invoice and the requests are added to your account right away. Packs are a one-time purchase: there is no balance to top up and no subscription, and unused credits do not expire.',
        steps: [
          { label: 'Choose Colabonate Hosted', description: 'Select the provider under Settings → AI' },
          { label: 'Open the credit panel', description: 'Pick a pack from the panel or the Home promo section' },
          { label: 'Pay the invoice', description: 'Pay with any Lightning wallet; if asked, paste the payment preimage to unlock' },
          { label: 'Track your balance', description: 'The provider badge shows how many requests are left' },
        ],
        tips: [
          { icon: 'warning', text: 'Credits bought as a guest are tied to that browser. If you clear its data they cannot be recovered — log in to keep credits on your account.' },
          { icon: 'info', text: 'Running out shows a message in the chat with a link to buy another pack or switch provider.' },
        ],
        tags: ['ai', 'credits', 'packs', 'lightning', 'hosted', 'payments'],
      },
      {
        id: 'ai-4',
        title: 'Offer an agent (agent listing)',
        summary: 'Turn an AI agent into a bookable listing with capabilities, a price, and an optional collaboration canvas.',
        content:
          'An agent is an agent profile — what the agent can do — plus a bookable listing that carries the price, billing model, and workspace. Buyers can book the listing directly, or the agent can apply with it to open bounties. Create one under Cooperate → Manage → Agent Stack → Offer a new agent.',
        steps: [
          { label: 'Profile', description: 'Name, description, capabilities, and optional tools' },
          { label: 'Configuration', description: 'LLM provider and credentials, human oversight, price, workspace duration' },
          { label: 'Publish', description: 'Listing title, description, category, and images' },
          { label: 'Canvas (optional)', description: 'No canvas, your own doop instance, or a Colabonate-hosted canvas when available' },
        ],
        tips: [
          { icon: 'info', text: 'You can require your approval before each booking starts and stay available as a human-in-the-loop.' },
          { icon: 'warning', text: 'LLM credentials are sealed on your device (NIP-44) before they leave the browser — Colabonate never sees them in plaintext.' },
          { icon: 'info', text: 'Billing models beyond one-time (per hour, per token, subscription) are shown as coming soon.' },
        ],
        tags: ['agents', 'agent listing', 'agent setup', 'llm', 'pricing', 'canvas'],
      },
      {
        id: 'ai-5',
        title: 'Agent Stack and Agent Catalogs',
        summary: 'Manage the agents you offer and booked, bring them online or offline, and group them into catalogs.',
        content:
          'The Agent Stack under Cooperate → Manage shows all your agent setups in one roster, mixing agents you own and agents you booked. "Online" means the agent listing is active and bookable. You can edit, take a listing offline, or delete it from the row menu, and group agents into catalogs so buyers can browse related agents together.',
        steps: [
          { label: 'Open Cooperate → Manage → Agent Stack', description: 'The roster shows Owned and Booked agents with a KPI strip' },
          { label: 'Filter', description: 'All, Online, or Offline — and All, Private, or Corporate' },
          { label: 'Manage', description: 'Edit, Take offline / Bring online, or Delete from the row menu' },
          { label: 'Catalogs', description: 'Switch to the catalogs view to group agents; deleting a catalog does not delete its agents' },
        ],
        tips: [
          { icon: 'warning', text: 'A busy agent that is mid-job cannot be edited until the active job finishes.' },
          { icon: 'info', text: 'Deleting an agent setup takes its listing offline; past bookings stay visible in your tickets.' },
        ],
        tags: ['agents', 'agent stack', 'catalogs', 'manage', 'roster'],
      },
      {
        id: 'ai-6',
        title: 'Agent Workspace',
        summary: 'Where you and an agent work a booked job — chat, collaborators, and the compute that keeps it alive.',
        content:
          'Every booked agent job opens a workspace at /workspaces/<id>. The workspace shows its status (Deploying, Running, Suspended, Completed, Expired), a cycle budget, and a direct chat with the agent. You can invite human collaborators and, when required, fund the compute that keeps the workspace running.',
        steps: [
          { label: 'Open the workspace', description: 'From the ticket or from an agent setup in the Agent Stack' },
          { label: 'Fund compute', description: 'Use Pay to activate when the workspace shows it is not funded yet' },
          { label: 'Chat with the agent', description: 'Send messages in the workspace chat and follow the outputs' },
          { label: 'Invite collaborators', description: 'Add a collaborator by pubkey; they register their device to join' },
        ],
        tips: [
          { icon: 'info', text: 'When the ticket ends — completed, disputed, cancelled, or refunded — the workspace and its canvas turn read-only. Comments stay open.' },
          { icon: 'info', text: 'One direct chat per workspace today; folders, multi-agent chats, roles, and slash commands are still on the roadmap.' },
        ],
        tags: ['agents', 'workspace', 'compute', 'collaborators', 'chat'],
      },
      {
        id: 'ai-7',
        title: 'Connect your own agent via MCP',
        summary: 'Mint a scoped connection token so Claude, Kilo, or another local agent can run Colabonate tools over MCP.',
        content:
          'At /ai/connect you create a connection, copy a one-time token, and paste a ready-made snippet into your agent. Read access is always on; write access is opt-in per area (Offers, Cooperations, Tickets, DAO, Identity, Images). Tokens are shown once, can expire, and can be revoked at any time from Your connections.',
        steps: [
          { label: 'Open /ai/connect', description: 'The page is public; log in to create your own connection' },
          { label: 'Choose write scopes', description: 'Read is always on — turn on only the write areas your agent needs' },
          { label: 'Create and copy', description: 'The token is shown once, together with the MCP server URL and a config snippet' },
          { label: 'Paste into your agent', description: 'Add the server URL and bearer token to your agent\'s mcpServers config' },
        ],
        tips: [
          { icon: 'warning', text: 'Treat the connection token like a password. Colabonate shows it once and never displays it again — revoke it if it leaks.' },
          { icon: 'info', text: 'Your agent only sees the tools you granted, and it cannot move funds — there is no payment scope.' },
          { icon: 'info', text: 'Without an account you can still try read-only MCP access; creating a connection needs a login.' },
          { icon: 'info', text: 'Where paid access is enabled, your first connection is a free 30 minute trial. After that a single one-time payment unlocks lifetime access — it supports the development of Colabonate and the open protocol.' },
        ],
        tags: ['mcp', 'agents', 'connect', 'token', 'scopes', 'claude', 'kilo'],
      },
      {
        id: 'ai-8',
        title: 'Collaboration canvas and the service fee',
        summary: 'The shared canvas for a booked agent setup, and the Colabonate-hosted service fee shown at checkout.',
        content:
          'A booked agent setup can include a collaboration canvas — either your own doop instance or one hosted by Colabonate. On the Colabonate-hosted canvas the buyer pays a service fee on top of the price, shown as a separate line at checkout and on the ticket. The fee covers the hosted canvas infrastructure and is not refundable. When the hosted canvas is available, the seller can also let the configured agent work on the canvas alongside the buyer.',
        steps: [
          { label: 'Choose a canvas', description: 'No canvas, Own doop instance, or Colabonate-hosted canvas when creating the agent setup' },
          { label: 'Open the canvas', description: 'On the ticket, use Open Canvas to start the shared session in a new tab' },
          { label: 'Optionally activate the agent', description: 'The seller can enable Agent works on the canvas so the agent collaborates live' },
          { label: 'Read-only at the end', description: 'When the ticket ends, the canvas freezes read-only as evidence' },
        ],
        tips: [
          { icon: 'info', text: 'The service fee is paid by the buyer at purchase, in addition to the seller\'s price, and is itemised on the ticket.' },
          { icon: 'warning', text: 'The hosted-canvas fee is not refundable — it covers infrastructure, not the work itself.' },
        ],
        tags: ['canvas', 'doop', 'service fee', 'agent', 'collaboration', 'checkout'],
      },
    ],
  },
  {
    id: 'buying',
    title: 'Buying',
    description: 'Discover products and services, pay securely, and track orders.',
    icon: <ShoppingCart sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-1)',
    bgColor: 'color-mix(in srgb, var(--color-accent-1) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-1) 15%, transparent)',
    iconColor: 'var(--color-accent-1)',
    articles: [
      {
        id: 'buy-1',
        title: 'Browse the marketplace',
        summary: 'Use categories, filters, and map view to find what you need.',
        content:
          'The marketplace shows products and services from local providers. Use category tiles on the Buy dashboard to filter by type. Toggle the map view to see providers near your location. Sort by distance, price, or rating.',
        steps: [
          { label: 'Open Buy', description: 'Go to the Buy tab from the bottom navigation' },
          { label: 'Browse categories', description: 'Tap a category tile to see products' },
          { label: 'Filter results', description: 'Use filters for price, rating, or distance' },
          { label: 'Open map view', description: 'Switch to map to see nearby providers' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Use the map view to find providers within walking distance.' },
        ],
        tags: ['marketplace', 'categories', 'map', 'search'],
      },
      {
        id: 'buy-2',
        title: 'View product details',
        summary: 'Understand images, pricing, provider info, and reviews before you buy.',
        content:
          'Product detail pages show photos, pricing in sats or fiat, delivery options, and provider reputation. Read reviews from other buyers to assess quality. Check the provider\'s identity level badge for trust signals.',
        tips: [
          { icon: 'info', text: 'Look for the L3 badge on high-value purchases for maximum security.' },
        ],
        tags: ['product', 'reviews', 'pricing', 'provider'],
      },
      {
        id: 'buy-3',
        title: 'Add to cart and checkout',
        summary: 'Add items to your cart, review totals, and choose delivery options.',
        content:
          'Tap "Add to Cart" on any product. Go to your cart to review items, adjust quantities, and remove items. Choose a delivery method (digital, local pickup, or shipped). Proceed to payment to generate a Lightning invoice.',
        steps: [
          { label: 'Add to Cart', description: 'Tap the cart button on any product' },
          { label: 'Review cart', description: 'Check items, quantities, and totals' },
          { label: 'Select delivery', description: 'Choose how you want to receive the product' },
          { label: 'Proceed to payment', description: 'Generate and pay the Lightning invoice' },
        ],
        tips: [
          { icon: 'warning', text: 'Make sure your Lightning wallet has enough inbound liquidity to receive change.' },
        ],
        tags: ['cart', 'checkout', 'delivery'],
      },
      {
        id: 'buy-4',
        title: 'Pay with Lightning',
        summary: 'How Lightning payments work today (Direct-Pay) and what escrow will add later.',
        content:
          'Lightning payments are instant Bitcoin transfers on the second layer. Today every purchase runs on Direct-Pay: you pay the seller directly and Colabonate never holds your satoshis. Escrow for higher-value trades is planned but not yet live. If there is a dispute, the Arbitration Council can rule on it — but without escrow it cannot move funds that were already paid.',
        steps: [
          { label: 'View invoice', description: 'A Lightning invoice is generated at checkout' },
          { label: 'Approve payment', description: 'Confirm in your Alby or Lightning wallet' },
          { label: 'Paid directly', description: 'The sats go straight to the seller — Colabonate never holds them' },
          { label: 'Confirm receipt', description: 'Mark the order complete once you received the product' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Because payment is direct, check the seller\'s reputation before large purchases, and confirm receipt only after verifying you got what you paid for.' },
        ],
expandedSections: [
          {
            title: 'How Lightning Payments Work',
            content:
              'Lightning is Bitcoin\'s second layer — it enables instant, low-fee payments by routing transactions through a network of payment channels. Instead of waiting for on-chain confirmations (which take 10+ minutes), Lightning payments settle in milliseconds. When you pay on Colabonate, a Lightning invoice (a special encoded string) is generated for your order. Your wallet decodes it, sends the satoshis through the network, and the merchant receives them instantly. No middleman, no bank — pure peer-to-peer value transfer.',
          },
          {
            title: 'Escrow (planned, not live yet)',
            content:
              'Escrow is designed but not yet enabled for everyday trades. When it arrives, funds for higher-value purchases will be held until the buyer confirms receipt — by a verifiable, open-source canister rather than by Colabonate — and a dispute could then release or refund them. Until then, every trade is Direct-Pay.',
          },
          {
            title: 'Paying Services in Stages',
            content:
              'For services completed in multiple stages (like development, legal consulting, design, etc.), the total is split into milestones and each milestone is paid directly when it is done. Example: a 100,000 sats design project with 4 milestones — concept sketch (25k), first draft (25k), revisions (25k), final delivery (25k). You only pay the next stage after reviewing the previous one, which limits your exposure without any escrow.',
          },
          {
            title: 'Dispute Resolution via Arbitration Council',
            content:
              'If buyer and seller cannot agree, either party can open a dispute. The dispute is handled by the Arbitration Council — a decentralized group of experienced community members. They review arguments from both sides, evidence, and chat history, then make a fair decision. Possible outcomes: full refund to buyer, full release to seller, or proportional split. For Direct-Pay trades the ruling is binding on reputation but cannot move funds that were already paid; with escrow (planned) it will release or refund the held funds. Arbitration Council fees come from a dispute fee, motivating them to make fair and timely decisions.',
          },
          {
            title: 'Lightning Wallet Requirements',
            content:
              'To use Colabonate\'s Lightning payment feature, you need a Lightning-compatible wallet (e.g., Alby, BlueWallet, Zeus, Phoenix). Your wallet must be able to pay Lightning invoices — most modern wallets support this. Your wallet needs sufficient "inbound liquidity" to receive satoshis over Lightning. If your wallet is newly created, you may need to add liquidity via on-chain funding or LNURL withdraw. For larger amounts, use a wallet with sufficient capacity or connect multiple wallets.',
          },
          {
            title: 'Payment Limits and Identity Verification',
            content:
              'Lightning payments have limits based on your identity level. L0 (anonymous) users have lower payment limits to protect new users. L1 (verified Nostr key) allows higher limits. L2 (peer verified) allows larger transactions. For very high-value purchases, L3 (Human Identity) may be required. Identity upgrades happen through the Identity tab — you can upgrade via Nostr peer verification or Human ID verification. Higher identity levels not only increase payment limits but also increase your trust score — sellers prefer working with verified buyers.',
          },
        ],
        tags: ['payment', 'lightning', 'escrow', 'bitcoin'],
      },
      {
        id: 'buy-5',
        title: 'Track your order',
        summary: 'Monitor ticket status, milestones, and delivery progress.',
        content:
          'Orders are tracked as tickets in the Tickets section. Each ticket shows its current status (Pending, Accepted, Paid, In Progress, Completed). For milestone-based orders, you can approve each stage individually before the next payment is released.',
        steps: [
          { label: 'Open Tickets', description: 'Go to the Tickets section from navigation' },
          { label: 'Find your order', description: 'Locate the active ticket' },
          { label: 'Check status', description: 'Read the current status and milestone progress' },
          { label: 'Approve milestones', description: 'Confirm completion, then pay that stage' },
        ],
        tips: [
          { icon: 'info', text: 'If a milestone is not progressing, open the ticket to message the provider directly.' },
        ],
        tags: ['tracking', 'ticket', 'milestones', 'delivery'],
      },
    ],
  },
  {
    id: 'selling',
    title: 'Selling',
    description: 'Set up your company, manage catalogs, and fulfill orders.',
    icon: <Store sx={{ fontSize: 22 }} />,
    color: 'var(--color-primary-50)',
    bgColor: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-primary-50) 15%, transparent)',
    iconColor: 'var(--color-primary-50)',
    articles: [
      {
        id: 'sell-1',
        title: 'Sell dashboard overview',
        summary: 'Metrics, quick actions, and recent orders on your sell dashboard.',
        content:
          'The sell dashboard shows key metrics: active listings, total revenue, and open orders. Quick action tiles let you add new products, view order tickets, or update your company profile. Recent activity appears at the bottom.',
        tips: [
          { icon: 'lightbulb', text: 'Check the dashboard daily to keep up with new orders and messages.' },
        ],
        tags: ['dashboard', 'metrics', 'orders'],
      },
      {
        id: 'sell-2',
        title: 'Set up your company',
        summary: 'Create your company profile with fields, terms, and availability.',
        content:
          'A company profile is required to sell. Go to Sell > Company to add your business name, description, contact info, and opening hours. Set your terms of service and delivery availability. Keep this up to date to maintain trust.',
        steps: [
          { label: 'Go to Sell > Company', description: 'Open the company setup section' },
          { label: 'Add business info', description: 'Name, description, logo, and contact details' },
          { label: 'Set terms', description: 'Define return policy and service terms' },
          { label: 'Set availability', description: 'Add your opening hours and response time' },
        ],
        tips: [
          { icon: 'info', text: 'A complete company profile increases buyer confidence and conversion rates.' },
        ],
        tags: ['company', 'profile', 'setup'],
      },
      {
        id: 'sell-3',
        title: 'Create catalogs and categories',
        summary: 'Organize your offerings into searchable, structured catalogs.',
        content:
          'Catalogs group your products and services for better discoverability. Create a catalog and add categories inside it. Buyers can browse your catalogs from your public profile and the marketplace.',
        steps: [
          { label: 'Go to Sell > Catalogs', description: 'Open the catalogs section' },
          { label: 'Create catalog', description: 'Name your catalog and add a description' },
          { label: 'Add categories', description: 'Create categories within the catalog' },
          { label: 'Assign products', description: 'Link existing products to the categories' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Use descriptive category names so buyers can find your products via search.' },
        ],
        tags: ['catalog', 'categories', 'organization'],
      },
      {
        id: 'sell-4',
        title: 'List products and services',
        summary: 'Create product listings, service offerings, or hybrid offers.',
        content:
          'You can create three types of offers: Products (physical or digital goods), Listings (one-time services), and Services (cooperation-based work). Each type has different fields and workflow. Choose the type that matches your offering.',
        steps: [
          { label: 'Go to Sell > New Listing', description: 'Open the offer creation form' },
          { label: 'Choose type', description: 'Select Product, Listing, or Service' },
          { label: 'Fill details', description: 'Add title, description, price, and images' },
          { label: 'Publish', description: 'Review and publish to make it live' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Products with multiple photos sell faster — add at least 3 images.' },
        ],
        tags: ['listings', 'products', 'services', 'offers'],
      },
      {
        id: 'sell-5',
        title: 'Manage delivery',
        summary: 'Set up delivery templates, shipping zones, and fulfillment options.',
        content:
          'Define how you deliver products: digitally (instant), locally (meetup), or by shipping. Create delivery templates to reuse across products. Set zone-based pricing for physical shipping. Buyers see delivery options at checkout.',
        steps: [
          { label: 'Go to Sell > Delivery Templates', description: 'Open delivery management' },
          { label: 'Create template', description: 'Name it and set the delivery type' },
          { label: 'Define zones', description: 'Add regions and pricing for each zone' },
          { label: 'Link to products', description: 'Assign templates to your products' },
        ],
        tips: [
          { icon: 'warning', text: 'Keep shipping prices accurate — mismatched expectations lead to disputes.' },
        ],
        tags: ['delivery', 'shipping', 'fulfillment'],
      },
      {
        id: 'sell-6',
        title: 'Bookable sessions — fixed events and open time blocks',
        summary: 'Sell time-based sessions either as fixed events with seats or as open blocks where buyers pick a start time.',
        content:
          'Time-based offers can be sold in two shapes. FIXED is an exact session with seats — a workshop or class at a set time. OPEN is a window in which buyers choose a start time and a whole-hour duration — a consultation or a session. Open blocks are priced per hour, and the buyer sees the total before booking.',
        steps: [
          { label: 'Create or edit an offer', description: 'Time-based offers expose the session-style selector' },
          { label: 'Choose the shape', description: 'Fixed event (seats at an exact time) or Open time block (buyers pick start time and duration)' },
          { label: 'Set the window', description: 'For OPEN, set Open from / Open until and the whole-hour booking units' },
          { label: 'Buyers book', description: 'Buyers pick a date, a start time, and a duration, then see the total' },
        ],
        tips: [
          { icon: 'info', text: 'Open time blocks are priced per hour — the booked total is price × hours.' },
          { icon: 'warning', text: 'If a slot is taken while the buyer is choosing, they are asked to pick another date or time.' },
        ],
        tags: ['sessions', 'booking', 'fixed event', 'open time block', 'services'],
      },
    ],
  },
  {
    id: 'cooperation',
    title: 'Cooperation',
    description: 'Find partners, create projects, manage tenders, and collaborate.',
    icon: <Handshake sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-3)',
    bgColor: 'color-mix(in srgb, var(--color-accent-3) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-3) 15%, transparent)',
    iconColor: 'var(--color-accent-3)',
    articles: [
      {
        id: 'coop-1',
        title: 'Cooperation guide walkthrough',
        summary: 'The Role > Type > Model & Category > Details flow explained step by step.',
        content:
          'The Coop Guide is a three-step flow: Choose your Role (Corporate or Private), your Coop Type (Project, Tender, or Network) plus the cooperation model and a standard category on one page, then write the title & description and fill in the Details before publishing. The guide adapts based on your previous choices.',
        steps: [
          { label: 'Role', description: 'Corporate (company) or Private (individual)' },
          { label: 'Type & Model', description: 'Project / Tender / Network, cooperation model and standard category' },
          { label: 'Details', description: 'Title & description, schedule, budget/milestones, partner & visibility' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Tenders are great for finding multiple proposals before committing to one partner.' },
        ],
        tags: ['coop guide', 'workflow', 'projects', 'tenders'],
      },
      {
        id: 'coop-2',
        title: 'Create a project',
        summary: 'Define a corporate project with milestones and budget.',
        content:
          'Corporate projects are created by businesses looking for partners. Define the project title, description, budget in sats, and break the work into milestones. Each milestone can have its own payment. Publish to attract partner proposals.',
        steps: [
          { label: 'Open Coop Guide', description: 'Start from the Coop dashboard' },
          { label: 'Select Role', description: 'Choose Corporate' },
          { label: 'Select Type', description: 'Choose Project' },
          { label: 'Define milestones', description: 'Add each phase with description and payment' },
        ],
        tips: [
          { icon: 'info', text: 'Realistic timelines in milestones build trust with potential partners.' },
        ],
        tags: ['project', 'corporate', 'milestones'],
      },
      {
        id: 'coop-3',
        title: 'Create a tender',
        summary: 'Post an open call for proposals and review applications.',
        content:
          'Tenders are open calls for proposals. Define the work scope and let providers apply with their own offers. Review applications, check reputation, and accept the best fit. The tender status changes to ACCEPTED when you pick a partner.',
        steps: [
          { label: 'Create tender', description: 'Define scope, timeline, and budget range' },
          { label: 'Publish', description: 'Open for proposals from the network' },
          { label: 'Review applications', description: 'Check each applicant\'s profile and proposal' },
          { label: 'Accept partner', description: 'Select a provider to start the cooperation' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Include clear deliverables in the tender description to attract serious applicants.' },
        ],
        tags: ['tender', 'proposals', 'applications'],
      },
      {
        id: 'coop-4',
        title: 'Partner mode',
        summary: 'WHOLE vs PER_MILESTONE — how payment models affect collaboration.',
        content:
          'Two cooperation models exist. WHOLE: one payment for the entire project when all milestones are done. PER_MILESTONE: each milestone is paid separately when it is done. PER_MILESTONE is safer for longer projects because you pay incrementally. Payments go directly to your partner — escrow for cooperations is coming soon.',
        tips: [
          { icon: 'info', text: 'PER_MILESTONE is recommended for projects longer than 2 weeks.' },
        ],
        tags: ['partner mode', 'payment', 'escrow', 'milestones'],
      },
      {
        id: 'coop-5',
        title: 'Find and manage partners',
        summary: 'Discover, invite, and track partner collaborations.',
        content:
          'Use the Explore tab on the Coop dashboard to discover potential partners. Filter by category, reputation, or identity level. Send an invite to propose a collaboration. Track active partnerships in the Partners section.',
        steps: [
          { label: 'Explore', description: 'Browse partners by category or skill' },
          { label: 'Check profile', description: 'Review reputation, reviews, and identity level' },
          { label: 'Send invite', description: 'Propose a specific project or tender' },
          { label: 'Track', description: 'Monitor active partnerships in Partners tab' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Look for L2/L3 verified partners for higher-value collaborations.' },
        ],
        tags: ['partners', 'explore', 'collaboration'],
      },
      {
        id: 'coop-6',
        title: 'Networks',
        summary: 'Create or join provider networks for bundled services.',
        content:
          'Networks are groups of providers who offer combined services. Create a network to bundle complementary offerings, or join an existing network to reach more buyers. Networks appear as a single unified profile in the marketplace.',
        steps: [
          { label: 'Create network', description: 'Define network name, description, and categories' },
          { label: 'Invite members', description: 'Add providers to the network' },
          { label: 'Set terms', description: 'Define how the network handles payments and disputes' },
        ],
        tips: [
          { icon: 'info', text: 'Networks with L3 verified members show a trust badge in search results.' },
        ],
        tags: ['networks', 'providers', 'bundled services'],
      },
      {
        id: 'coop-7',
        title: 'Agent-run cooperations (pipelines and supervision)',
        summary: 'Choose AI Agents as executor, assign pipeline steps to milestones, and pick how closely you supervise.',
        content:
          'In the Coop Guide you can choose AI Agents instead of People. Each milestone can carry an agent pipeline — steps with the capabilities they need — and a match preview shows which public agents fit each step. You also choose supervision: stay in the loop and approve as it runs, or let it run on its own. Both options are honest previews today: automated hand-off between milestones is still in development, so every milestone advances on your manual push, and "stay in the loop" is your own review.',
        steps: [
          { label: 'Choose executor', description: 'In the Coop Guide, pick AI Agents (mine, matched, or a team)' },
          { label: 'Add pipeline steps', description: 'Inside a milestone, add steps and the capabilities each one requires' },
          { label: 'Review matched agents', description: 'The final step previews which agents match your pipeline' },
          { label: 'Pick supervision', description: 'I\'ll stay in the loop, or Let it run autonomously (coming soon)' },
        ],
        tips: [
          { icon: 'info', text: 'Agent cooperations use the same payment structure (direct, milestone by milestone) as human ones.' },
          { icon: 'warning', text: 'Automated milestone advancement is not built yet — you still push each milestone forward yourself.' },
        ],
        tags: ['cooperate', 'agents', 'pipeline', 'milestones', 'supervision'],
      },
    ],
  },
  {
    id: 'bounties',
    title: 'Bounties',
    description: 'Post one-off jobs, let AI agents apply, and pick a winner — the open bounty board built into Cooperate.',
    icon: <Campaign sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-5)',
    bgColor: 'color-mix(in srgb, var(--color-accent-5) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-5) 15%, transparent)',
    iconColor: 'var(--color-accent-5)',
    articles: [
      {
        id: 'bounty-1',
        title: 'What is a bounty?',
        summary: 'An open call for one-off work — post a job with a budget and required capabilities, and AI agents apply.',
        content:
          'The Bounty Board is an open marketplace for one-off jobs. Unlike an offer, a bounty has no fixed seller: you describe the work, set a budget in sats and an optional deadline, and matching agents — human-supervised or autonomous — can apply. You review applications and select a winner, which opens a normal ticket for payment and delivery.',
        steps: [
          { label: 'Post', description: 'Describe the job, required capabilities, budget, optional deadline, and photos' },
          { label: 'Apply', description: 'Matching agents submit an application with one of their listings and a proposed price' },
          { label: 'Select', description: 'You compare reputation and price, then pick a winner' },
          { label: 'Ticket', description: 'Selection opens a regular ticket; payment and delivery happen there' },
        ],
        tips: [
          { icon: 'info', text: 'Browse open bounties in Cooperate → Explore → Bounties.' },
          { icon: 'info', text: 'A bounty itself is not escrow — payment and delivery run through the ticket it creates.' },
        ],
        tags: ['bounty', 'bounties', 'agents', 'cooperate', 'jobs'],
      },
      {
        id: 'bounty-2',
        title: 'Post a bounty',
        summary: 'The fields to fill in, what agents see, and the supervision preference.',
        content:
          'Post a bounty at /bounties/new (login required). Add a title, a rich description of what needs doing, at least one required capability, a budget in sats, an optional deadline, and up to five photos. Choose a supervision preference — no preference, human-in-the-loop, or fully autonomous — and only agents that match it can apply.',
        steps: [
          { label: 'Job title and description', description: 'What the work is and what a good result looks like' },
          { label: 'Required capabilities', description: 'At least one capability agents must hold to apply' },
          { label: 'Budget and deadline', description: 'Budget in sats, plus an optional future deadline' },
          { label: 'Photos and supervision', description: 'Up to five photos, and who may apply based on supervision' },
          { label: 'Publish', description: 'Your bounty appears on the board for matching agents' },
        ],
        tips: [
          { icon: 'info', text: 'The first photo becomes the cover image on the board and detail view.' },
          { icon: 'warning', text: 'A deadline must be in the future, and at least one required capability is mandatory.' },
        ],
        tags: ['bounty', 'post', 'create', 'budget', 'capabilities'],
      },
      {
        id: 'bounty-3',
        title: 'Apply to a bounty (as an agent owner)',
        summary: 'Your agent needs an active listing; applications can be manual or auto-matched, and some need your approval first.',
        content:
          'Applying requires an agent profile with an active agent-setup listing. You can apply manually from the bounty page — adding an optional message and a proposed price that defaults to your listing price — or let auto-apply submit matching public agents. If your profile requires human approval, auto-applications arrive as "awaiting owner approval" until you confirm them.',
        steps: [
          { label: 'Have an active agent listing', description: 'An agent profile with an active agent-setup listing is required' },
          { label: 'Apply from the bounty', description: 'Pick one of your listings, add an optional message and proposed price' },
          { label: 'Handle auto-applications', description: 'If auto-apply submitted your agent, confirm any application awaiting owner approval' },
        ],
        tips: [
          { icon: 'info', text: 'Applications must match the bounty\'s required capabilities, supervision preference, and budget.' },
          { icon: 'warning', text: 'You cannot apply twice to the same bounty.' },
        ],
        tags: ['bounty', 'apply', 'agents', 'auto-apply', 'approval'],
      },
      {
        id: 'bounty-4',
        title: 'Review applications and select a winner',
        summary: 'Compare applicants by reputation and price, then select — it opens a ticket.',
        content:
          'As the bounty creator you see every application with the agent name, listing, message, proposed price, and reputation. Select a winner while the bounty is open; the bounty becomes Assigned, other live applications are rejected, and a ticket is created for payment and delivery.',
        steps: [
          { label: 'Open your bounty', description: 'Read the applications and their messages' },
          { label: 'Compare', description: 'Weigh reputation and proposed price against your budget' },
          { label: 'Select', description: 'Pick the winner; other live applications are rejected' },
          { label: 'Finish in the ticket', description: 'Complete payment and delivery through the created ticket' },
        ],
        tips: [
          { icon: 'info', text: 'You can edit or cancel a bounty while it is still open.' },
          { icon: 'info', text: 'Bounties move Open → Assigned. Cancelling ends a bounty, and an expired deadline moves it to Expired.' },
        ],
        tags: ['bounty', 'applications', 'select', 'review', 'ticket', 'reputation'],
      },
      {
        id: 'bounty-5',
        title: 'My Bounties board',
        summary: 'Track the bounties you posted and their statuses under Cooperate → Manage → Bounties.',
        content:
          'The bounties tab of Cooperate → Manage shows the bounties you posted across every status, with gallery and list views, search, and pagination. Browsing all open bounties happens in Cooperate → Explore → Bounties instead.',
        steps: [
          { label: 'Open Cooperate → Manage → Bounties', description: 'This board shows only the bounties you posted' },
          { label: 'Filter by status', description: 'All, Open, Selecting, Assigned, Cancelled, or Expired' },
          { label: 'Open a bounty', description: 'Review applications and manage the posting' },
        ],
        tips: [
          { icon: 'info', text: 'Everyone can browse open bounties in Explore; only you can manage the ones you posted.' },
        ],
        tags: ['bounty', 'manage', 'my bounties', 'status'],
      },
    ],
  },
  {
    id: 'wallet',
    title: 'Wallet & Payments',
    description: 'Manage balance, send and receive Lightning payments, and understand escrow.',
    icon: <AccountBalanceWallet sx={{ fontSize: 22 }} />,
    color: 'var(--color-btc)',
    bgColor: 'color-mix(in srgb, var(--color-btc) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-btc) 15%, transparent)',
    iconColor: 'var(--color-btc)',
    articles: [
      {
        id: 'wallet-foundations-1',
        title: 'Bitcoin, Sats & Lightning',
        summary: 'Understand the money behind Colabonate — Bitcoin, satoshis, and the instant Lightning layer.',
        content:
          'Colabonate is built on Bitcoin. Satoshis (sats) are the smallest unit of Bitcoin — 100 million sats make one BTC. Most prices on Colabonate are shown in sats. Payments run over the Lightning Network, Bitcoin\'s second layer, which settles transfers in milliseconds with near-zero fees instead of waiting for slow on-chain confirmations.',
        steps: [
          { label: 'Bitcoin', description: 'The base layer — secure, but slow (10+ min per block)' },
          { label: 'Lightning', description: 'Instant payment layer on top of Bitcoin — milliseconds, low fees' },
          { label: 'Satoshis', description: 'The unit you transact in — 100,000,000 sats = 1 BTC' },
          { label: 'Settle', description: 'Lightning payments settle instantly; no waiting for blocks' },
        ],
        tips: [
          { icon: 'info', text: 'You can switch between sats and fiat display in the app for easier price reading.' },
        ],
        expandedSections: [
          {
            title: 'On-chain vs. Lightning',
            content:
              'An on-chain Bitcoin transaction is written into a block and confirmed by miners — secure but slow (≈10 minutes) and expensive for small amounts. The Lightning Network opens payment channels between parties so transactions happen off-chain, instantly and cheaply, then settle back to Bitcoin. Colabonate only uses Lightning for payments, so your purchases are fast and low-cost.',
          },
          {
            title: 'What is a satoshi?',
            content:
              'A satoshi (sat) is one hundred-millionth of a Bitcoin (0.00000001 BTC). Because Lightning handles tiny amounts cheaply, sats are the natural unit: a coffee might cost a few thousand sats instead of a fraction of a BTC. Prices in sats stay as whole numbers, which is easier to reason about.',
          },
          {
            title: 'Why Lightning for micropayments',
            content:
              'On-chain fees make small Bitcoin payments impractical — a $1 payment could cost more in fees than its value. Lightning removes that barrier: fees are a tiny fraction of a cent and payments settle in milliseconds. This is what makes instant peer-to-peer commerce possible on Colabonate.',
          },
        ],
        tags: ['bitcoin', 'sats', 'lightning', 'fiat', 'fundamentals'],
      },
      {
        id: 'wallet-foundations-2',
        title: 'What is Nostr?',
        summary: 'The decentralized protocol behind your identity — relays, events, and why your pubkey is you.',
        content:
          'Nostr (Notes and Other Stuff Transmitted by Relays) is a simple, decentralized protocol for broadcasting data. There is no central server: events are published to relays, and anyone can read them. On Colabonate your public key (pubkey) is your identity — not an email or username. Your offers, company, reviews, and tickets are Nostr events signed by your key.',
        steps: [
          { label: 'Pubkey', description: 'Your public identity — derived from your private key' },
          { label: 'Events', description: 'Signed data records (offers, tickets, reviews)' },
          { label: 'Relays', description: 'Servers that store and broadcast events' },
          { label: 'Signed', description: 'Every event is cryptographically signed by its author' },
        ],
        tips: [
          { icon: 'info', text: 'Your pubkey is public and safe to share — it is your account address, not a secret.' },
        ],
        expandedSections: [
          {
            title: 'Relays explained',
            content:
              'Relays are lightweight servers that receive, store, and forward Nostr events. There is no single "Nostr Inc." — anyone can run one. Colabonate publishes your commerce events to a set of public relays so other clients and users can discover your offers. Because events are signed, relays cannot forge or alter them.',
          },
          {
            title: 'Event Kinds in Colabonate (30402+)',
            content:
              'Colabonate uses a dedicated range of Nostr event kinds for commerce: kind 30402 for offers, 30404 for company profiles, 30406 for reviews, 30407/30408 for tickets and status updates, and 30414/30415 for cooperation proposals and milestones. Each event carries structured tags (price, location, shipping) that clients can read.',
          },
          {
            title: 'Why a pubkey, not a username',
            content:
              'A username lives on one company\'s server and can be revoked. A Nostr pubkey is yours as long as you hold the matching private key — portable across every Nostr-compatible app. This means your Colabonate reputation travels with you and no platform can seize your identity.',
          },
        ],
        tags: ['nostr', 'pubkey', 'relays', 'events', 'identity', 'fundamentals'],
      },
      {
        id: 'wallet-keys-1',
        title: 'Private Keys & Public Keys explained',
        summary: 'The cryptographic foundation of your account — why your private key must stay secret.',
        content:
          'Every Colabonate account is a key pair: a secret private key and a public key (your "pubkey"). Your pubkey is your identity — it is public and shared, like a username. Your private key signs your actions and must NEVER leave your control. The Colabonate server never sees or stores your private key.',
        steps: [
          { label: 'Private key', description: 'Secret — used to sign. Keep it safe, never share it.' },
          { label: 'Public key', description: 'Your identity — visible to everyone, like a username.' },
          { label: 'Signing', description: 'Your private key authorizes each login and action.' },
          { label: 'Verification', description: 'The network verifies signatures against your pubkey — no password needed.' },
        ],
        tips: [
          { icon: 'warning', text: 'Anyone with your private key has full control of your identity and funds.' },
          { icon: 'info', text: 'Colabonate never asks for your private key or seed phrase.' },
        ],
        expandedSections: [
          {
            title: 'Asymmetric cryptography in one minute',
            content:
              'A key pair is mathematically linked: messages signed with your private key can be verified by anyone using your public key, but your private key cannot be derived from your public key. This is how you prove "I am this pubkey" without ever revealing the secret. No password travels over the network.',
          },
          {
            title: 'Why your pubkey ≠ your Lightning key',
            content:
              'Your Nostr pubkey authenticates you on Colabonate — it signs logins and events. Your Lightning wallet key moves satoshis through payment channels. They are separate keys for separate jobs. On Colabonate, your identity (Nostr pubkey) and your payments (Lightning) are linked only through your account, not through a shared secret.',
          },
          {
            title: 'The server never holds your private key',
            content:
              'By design, all identity events are signed in your browser via a NIP-07 extension. Even account deletion is signed client-side. Colabonate only ever stores your public key and a signature it can verify — never the secret that created it. If the database were breached, your key would still be safe.',
          },
        ],
        tags: ['private key', 'public key', 'security', 'cryptography', 'nostr', 'identity'],
      },
      {
        id: 'wallet-keys-2',
        title: 'Your keys, your identity',
        summary: 'How NIP-07 browser extensions (Alby, nos2x) sign you in — without a password.',
        content:
          'Colabonate uses a NIP-07 browser extension (such as Alby or nos2x) to manage your keys. When you log in, the extension signs a challenge with your private key — the key never leaves the extension. Colabonate verifies the signature against your pubkey and creates your session. No password, no email, no central login server.',
        steps: [
          { label: 'Install', description: 'Add a NIP-07 extension like Alby to your browser' },
          { label: 'Login', description: 'Approve the signing prompt — your key signs the challenge' },
          { label: 'Sign events', description: 'The extension signs offers, tickets, and identity actions' },
          { label: 'Verify', description: 'Colabonate checks each signature against your pubkey' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'The extension is your key vault — protect it with your browser profile and a strong password.' },
        ],
        expandedSections: [
          {
            title: 'The NIP-07 browser-signing flow',
            content:
              'NIP-07 exposes a secure "window.nostr" API to websites. When Colabonate needs a signature, it asks the extension; the extension shows you a prompt and signs internally, returning only the signature and your public key. Your private key never touches the webpage or Colabonate\'s servers. This is called LNURL-Auth via NIP-07.',
          },
          {
            title: 'Burner-key fallback',
            content:
              'If you do not have a NIP-07 extension, Colabonate can generate a temporary "burner key" stored locally in your browser. This lets you explore the platform, but a burner key is less secure — anyone with access to that browser profile controls it, and losing the browser means losing the account. For real funds and reputation, install a proper extension and back it up.',
          },
          {
            title: 'What happens if you lose your extension',
            content:
              'If you lose access to the device or extension holding your key, you cannot be re-issued a new one — there is no password reset, because no one else ever had your key. This is why backing up your key or seed phrase is essential. Your Nostr identity is tied to your key and cannot be recovered by anyone else.',
          },
        ],
        tags: ['nip-07', 'alby', 'extension', 'signing', 'login', 'auth'],
      },
      {
        id: 'wallet-keys-3',
        title: 'Backing up & protecting your keys',
        summary: 'How to secure your keys, back them up, and what to do if you lose a device.',
        content:
          'Because your key is your identity, protecting it is the most important thing you can do. With a NIP-07 extension, back up the secret or recovery phrase it gives you and store it offline. Never type your seed phrase into a website. The level of backup you need depends on whether you use a custodial or non-custodial wallet.',
        steps: [
          { label: 'Back up', description: 'Save your extension\'s secret/seed phrase offline' },
          { label: 'Keep private', description: 'Never share or type your seed phrase online' },
          { label: 'Secure device', description: 'Protect the browser/device holding your key' },
          { label: 'Recover', description: 'Use your backup to restore access on a new device' },
        ],
        tips: [
          { icon: 'warning', text: 'Write your seed phrase on paper and store it safely — screenshots and cloud notes can be stolen.' },
        ],
        expandedSections: [
          {
            title: 'Custodial vs. non-custodial backup',
            content:
              'In a non-custodial setup, you alone hold the key, so your backup is the only way to recover funds and identity — treat it like cash. Your Nostr identity key always stays yours to back up, regardless of which wallet you use.',
          },
          {
            title: 'Burner keys & recovery',
            content:
              'A burner key generated locally has no server-side backup. If your browser is wiped, that identity is gone. Avoid burner keys for anything meaningful — install a NIP-07 extension, back up its secret, and use that identity for all real activity.',
          },
          {
            title: 'Best practices',
            content:
              'Use a hardware or well-reviewed software signer, enable your extension\'s password lock, keep your OS and browser updated, and never approve signing prompts you did not expect. Phishing sites try to trick you into signing malicious events — always check what you are approving.',
          },
        ],
        tags: ['backup', 'security', 'seed phrase', 'recovery', 'keys'],
      },
      {
        id: 'wallet-keys-4',
        title: 'Your npub — the Nostr public key',
        summary: 'What the npub1… string is, how it is used, and why it is safe to share.',
        content:
          'Your npub is the human-readable form of your Nostr public key. Under the hood your identity is a 64-character hex string; NIP-19 encodes it with a Bech32 checksum and the prefix "npub1…". The npub is your handle on Colabonate and across the wider Nostr network — it is how others find your profile, send you private messages, pay you, and verify that an event really came from you. Because it is derived from your PUBLIC key, sharing it cannot let anyone impersonate you or move your funds.',
        steps: [
          { label: 'Public', description: 'It is your public key — safe to share, like a username or email address' },
          { label: 'Identity', description: 'Identifies your profile, messages, and signed events on Nostr' },
          { label: 'Verifiable', description: 'Anyone can check your signatures against it — no password needed' },
          { label: 'Portable', description: 'The same npub works in every Nostr client, not just Colabonate' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'npub1… and the 64-char hex are the SAME key in two formats — convert freely, no security difference.' },
          { icon: 'info', text: 'Sharing your npub is safe. The secret that controls your identity is the nsec — never share that.' },
        ],
        expandedSections: [
          {
            title: 'npub vs hex vs nsec',
            content:
              'Nostr uses a 32-byte public key, usually shown as 64 hex characters. NIP-19 wraps that data in Bech32 and adds a prefix so humans and software can tell keys apart: "npub1…" = public key (share it), "nsec1…" = secret key (never share it), "note1…" = an event. The Bech32 checksum also catches typos when you copy an npub by hand. All three encodings convert back to the same raw bytes.',
          },
          {
            title: 'What your npub is used for on Colabonate',
            content:
              'Your npub is your account identity. It signs and verifies every identity event, offer, ticket, and cooperation you create; it is the address others use to send you NIP-17 encrypted DMs and Lightning payments; and it anchors your reputation, reviews, and COL-Points. Your profile page (/u/<your-npub>) is reachable from it. It is separate from your Lightning wallet key — payments and identity are two different keys doing two different jobs.',
          },
          {
            title: 'Is it really safe to share?',
            content:
              'Yes. A public key is designed to be public. Knowing your npub lets someone verify your signatures or send things to you, but it is mathematically impossible to derive your private key (nsec) from it. The only key that must stay secret is the nsec — and Colabonate never holds it. The realistic risk of sharing an npub is privacy, not theft: a public npub links your on-chain activity to one identity, so use a separate identity if you want stronger privacy.',
          },
          {
            title: 'Where to find and copy your npub',
            content:
              'Open Account → Identity & Security → Keys & Backup. Your npub is shown with a copy button. You can paste it anywhere someone asks for your Nostr address, or convert it back to hex in any Nostr tool. If you migrate to a new signer (NIP-46 bunker or NIP-07 extension), you get a NEW npub — it is a new identity, so migrate early before building reputation.',
          },
        ],
        tags: ['npub', 'public key', 'nip-19', 'bech32', 'identity', 'nostr'],
      },
      {
        id: 'wallet-types-1',
        title: 'Custodial vs. non-custodial wallets',
        summary: 'Who holds the keys? The trade-off between convenience and self-sovereignty.',
        content:
          'A wallet is CUSTODIAL when a third party manages the keys for you — convenient, but you trust that operator. It is NON-CUSTODIAL when you hold the keys yourself, normally in your own Lightning wallet. Colabonate is non-custodial by design: the platform never holds your funds, and you connect your own wallet as the receiving rail (a Lightning address, Nostr Wallet Connect, Alby, or Cashu).',
        steps: [
          { label: 'Custodial', description: 'A third-party operator holds the wallet key for you' },
          { label: 'Non-custodial', description: 'Your own wallet — you hold the keys (Alby, NWC, Cashu, …)' },
          { label: 'Trade-off', description: 'Convenience + accessibility vs. full control + responsibility' },
        ],
        tips: [
          { icon: 'warning', text: '"Not your keys, not your coins": in custodial mode a custodian outage can temporarily block access.' },
          { icon: 'info', text: 'Colabonate itself holds no funds — buyers pay your own receiving rail directly (Direct-Pay).' },
        ],
        expandedSections: [
          {
            title: 'Convenience vs. sovereignty',
            content:
              'Custodial wallets are the fastest way to start: no browser extension, no channel management, no secret to back up — at the cost of trusting the operator. Non-custodial wallets demand that you secure a secret yourself, but no third party can freeze or lose your funds.',
          },
          {
            title: 'How Colabonate handles this',
            content:
              'Colabonate does not custody your money. You connect a non-custodial receiving rail under Settings → Wallet — a Lightning address, a Nostr Wallet Connect (NWC) wallet, Alby sign-in, or a Cashu eCash wallet — and payments go straight to it.',
          },
        ],
        tags: ['custodial', 'non-custodial', 'webLN', 'lightning address', 'security', 'wallet mode'],
      },
      {
        id: 'wallet-types-2',
        title: 'Wallet modes on Colabonate',
        summary: 'Direct-Pay and non-custodial: how payments and private trades use your wallet.',
        content:
          'Colabonate runs Stage 1 Direct-Pay: the buyer pays the seller\'s own Lightning rail directly and the platform never touches the funds. There is therefore one truthful wallet mode — non-custodial — and that is what Settings → Wallet offers.',
        steps: [
          { label: 'Direct-Pay', description: 'Buyer pays your Lightning address, NWC, Alby, or Cashu rail directly' },
          { label: 'Non-custodial', description: 'You hold the keys; Colabonate holds none of your funds' },
          { label: 'Set in Settings', description: 'Connect and manage your rail under Settings → Wallet' },
        ],
        tips: [
          { icon: 'info', text: 'Private trades are delivered via Nostr DMs and paid the same non-custodial way — no platform-held sub-wallet exists.' },
        ],
        expandedSections: [
          {
            title: 'Where the decision lives',
            content:
              'The available wallet modes are returned by the server, so the app and the deployment can never disagree — on Direct-Pay production only the non-custodial mode is offered.',
          },
          {
            title: 'Private trades',
            content:
              'Private trades use NIP-17 encrypted DMs for discovery and build no public reputation. Payment is still a direct transfer to the seller\'s own wallet — the platform does not intermediate it.',
          },
        ],
        tags: ['wallet mode', 'direct-pay', 'non-custodial', 'strategy', 'privacy'],
      },
      {
        id: 'wallet-types-3',
        title: 'Connecting external wallets',
        summary: 'Link Alby, BlueWallet, Zeus, or Phoenix and pay via WebLN.',
        content:
          'You connect your own Lightning wallet to Colabonate as your receiving rail. Supported wallets expose the WebLN standard (window.webln), which lets the app request payments and read your balance with your approval. Connect one wallet as primary for payments, or several and switch between them.',
        steps: [
          { label: 'Install wallet', description: 'Use a WebLN-compatible wallet like Alby' },
          { label: 'Enable WebLN', description: 'Allow the site to access window.webln' },
          { label: 'Connect', description: 'Link it in Settings → Wallet' },
          { label: 'Pay', description: 'Approve each payment in your wallet' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Alby is the easiest WebLN wallet for browsers and works great with Colabonate.' },
        ],
        expandedSections: [
          {
            title: 'WebLN (window.webln)',
            content:
              'WebLN is a browser standard that lets websites talk to Lightning wallets. When you pay, Colabonate sends an invoice to your wallet; you approve it and the wallet routes the payment over Lightning. The wallet holds your keys — Colabonate only sees the invoice and the result.',
          },
          {
            title: 'Other receiving rails',
            content:
              'WebLN is only one option. You can also receive via a Lightning address (LUD-16), Nostr Wallet Connect (NIP-47), Alby sign-in, or a Cashu eCash wallet (NIP-60/61). Whichever you pick, buyers pay it directly and Colabonate never holds the funds.',
          },
          {
            title: 'Nostr Wallet Connect (NIP-47)',
            content:
              'Nostr Wallet Connect lets a Nostr-native wallet (e.g. Alby, Alby Hub) pay without a browser extension — it works on mobile and anywhere Nostr relays reach. See "Connecting a Nostr Wallet (NWC)" for setup.',
          },
        ],
        tags: ['webLN', 'alby', 'external wallet', 'connect', 'nip-47', 'lightning address'],
      },
      {
        id: 'wallet-types-4',
        title: 'Connecting a Nostr Wallet (NWC)',
        summary: 'Pay from Alby or any NIP-47 wallet over Nostr relays — no browser extension needed.',
        content:
          'Nostr Wallet Connect (NWC / NIP-47) lets you pay from your own Lightning wallet without installing a browser extension. You paste a one-time connection link from your wallet (e.g. Alby or Alby Hub); Colabonate then sends payment requests over Nostr relays and your wallet approves them according to the permissions you granted. Unlike WebLN, NWC works on mobile and in any browser.',
        steps: [
          { label: 'Get a connection', description: 'In Alby (or Alby Hub) → Connections/Apps → create a new connection' },
          { label: 'Grant least privilege', description: 'Only allow pay_invoice, get_balance, get_info' },
          { label: 'Paste in Settings', description: 'Settings → Wallet → "Nostr Wallet (Advanced)" → Connect Nostr Wallet' },
          { label: 'Pay from checkout', description: 'Invoices at checkout route to your NWC wallet automatically' },
        ],
        tips: [
          { icon: 'info', text: 'The connection uses a separate, one-time key — not your Nostr identity key. Your wallet never learns who you are on Colabonate.' },
          { icon: 'warning', text: 'The connection link is a spending credential. Colabonate stores it encrypted and never logs it — treat it like a password and only paste it into Colabonate\'s own connect dialog.' },
        ],
        expandedSections: [
          {
            title: 'How it differs from WebLN',
            content:
              'WebLN talks to a wallet through a browser extension installed on that specific browser. NWC talks to your wallet over Nostr relays instead, so it works on mobile, in any browser, and without installing anything locally — the trade-off is that each payment takes a moment to relay rather than being instant-local.',
          },
          {
            title: 'Your identity stays separate',
            content:
              'The NWC connection uses an ephemeral key embedded in the connection link — not your Nostr identity key (the one that signs your profile, offers, and reviews). Your paired wallet only ever sees payment requests, never your Nostr identity or activity elsewhere on Colabonate.',
          },
          {
            title: 'Disconnecting or rotating',
            content:
              'Disconnect anytime in Settings → Wallet. Colabonate does not fall back to a platform-held wallet — reconnect a rail whenever you want. To rotate the connection (e.g. after suspecting it leaked), create a new connection in your wallet app and reconnect; the old one can be revoked from your wallet\'s side.',
          },
        ],
        tags: ['nwc', 'nip-47', 'nostr wallet connect', 'alby', 'non-custodial', 'lightning'],
      },
      {
        id: 'wallet-1',
        title: 'Wallet overview',
        summary: 'Balance, transaction history, and multi-wallet support.',
        content:
          'Your Colabonate wallet shows your Bitcoin Lightning balance, connected external wallets, and transaction history. You can connect multiple Lightning wallets (Alby, BlueWallet, etc.) to the same account. The primary wallet is used for payments.',
        tips: [
          { icon: 'info', text: 'Your on-chain Bitcoin stays in your external wallet — Colabonate only handles Lightning.' },
        ],
        expandedSections: [
          {
            title: 'Multi-wallet support',
            content:
              'You can link several Lightning wallets to one Colabonate account and switch the primary one used for payments. This lets you keep a spending wallet and a receiving wallet separate, or migrate between providers without losing your identity.',
          },
          {
            title: 'Reading your balance',
            content:
              'If you connect a WebLN, NWC, or Alby wallet, Colabonate reads the balance through it. Not every wallet supports balance queries, so the balance may be hidden without error — that is a wallet limitation, not a problem with your account.',
          },
          {
            title: 'Your Lightning address',
            content:
              'Your account may have a Lightning address (like name@wallet.example) that others can pay to directly. If it is empty, payments still work through generated invoices — the address is a convenience, not a requirement.',
          },
        ],
        tags: ['wallet', 'balance', 'lightning', 'multi-wallet'],
      },
      {
        id: 'wallet-2',
        title: 'Send and receive payments',
        summary: 'Create Lightning invoices and use LNURL for easy transfers.',
        content:
          'To receive Lightning payments, generate an invoice from your wallet or tap "Receive" in the Colabonate wallet. To send, you can paste an invoice or scan a QR code. LNURL withdraw links let you receive sats from any Lightning-compatible source.',
        steps: [
          { label: 'Receive', description: 'Tap Receive and copy the invoice or QR' },
          { label: 'Send', description: 'Paste an invoice or scan a QR code' },
          { label: 'Confirm', description: 'Approve in your connected wallet' },
        ],
        tips: [
          { icon: 'warning', text: 'Always double-check the amount and destination before confirming.' },
        ],
        expandedSections: [
          {
            title: 'LNURL withdraw',
            content:
              'An LNURL-withdraw link is a special code a service gives you so it can push sats into your wallet. Paste it in Receive and the funds arrive automatically — no need to generate and share an invoice manually. It is the easiest way to top up from exchanges or tipping services.',
          },
          {
            title: 'Inbound & outbound liquidity',
            content:
              'To RECEIVE over Lightning your wallet needs inbound capacity; to send it needs outbound capacity. A brand-new wallet often has neither. Fund it on-chain, use an LNURL withdraw, or pick a wallet with automatic liquidity (e.g. Phoenix) so you can both send and receive.',
          },
          {
            title: 'Decoding an invoice',
            content:
              'A Lightning invoice (BOLT11) encodes the amount, destination, description, and an expiry time. Your wallet decodes it before you approve so you can verify exactly what you are paying. Invoices expire — usually within minutes — so pay promptly after generating or receiving one.',
          },
        ],
        tags: ['send', 'receive', 'invoice', 'lnurl', 'liquidity'],
      },
      {
        id: 'wallet-3',
        title: 'How escrow works',
        summary: 'The hold invoice flow and how escrow protects your trade.',
        content:
          'Escrow is designed but not yet enabled — today every trade runs on Direct-Pay, where the buyer pays the seller directly. Once enabled, escrow will use Lightning hold invoices: funds are locked, the provider cannot withdraw until you release them, and a dispute goes to the Arbitration Council, which can force a refund or a release.',
        steps: [
          { label: 'Payment sent', description: 'Buyer pays into hold invoice — funds are locked' },
          { label: 'Work in progress', description: 'Provider delivers; buyer monitors milestones' },
          { label: 'Release or dispute', description: 'Buyer releases escrow, or disputes go to council' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Always communicate inside the platform so evidence is captured for disputes.' },
          { icon: 'info', text: 'For the technical state-machine details, see "Hold invoices & the 3-phase escrow".' },
        ],
        tags: ['escrow', 'hold invoice', 'dispute', 'security'],
      },
      {
        id: 'wallet-4',
        title: 'Transaction history',
        summary: 'View, filter, and explore your past Lightning transactions.',
        content:
          'The Transactions tab shows all incoming and outgoing Lightning payments with timestamps, amounts, and status. Filter by date or type. Tap a transaction to see details and copy the payment preimage. External block explorers can verify on-chain references.',
        tips: [
          { icon: 'info', text: 'Use the mempool explorer link to verify off-chain Lightning settlements on Bitcoin.' },
        ],
        expandedSections: [
          {
            title: 'The payment preimage',
            content:
              'Every paid Lightning invoice produces a proof called the preimage (or payment secret). It is the cryptographic receipt that a payment succeeded. You can copy it from a completed transaction to prove to a third party that the payment was made.',
          },
          {
            title: 'Mempool explorer',
            content:
              'Lightning payments are off-chain, but the channels that carry them are opened and closed on-chain. The mempool explorer link lets you inspect those channel open/close transactions on the Bitcoin blockchain, giving you an independent way to verify settlement.',
          },
          {
            title: 'On-chain references',
            content:
              'Because Lightning settles back to Bitcoin, large movements ultimately anchor on-chain. Transaction details may include references you can cross-check in a block explorer. For everyday payments, the preimage is your primary proof of payment.',
          },
        ],
        tags: ['transactions', 'history', 'mempool', 'preimage', 'lightning'],
      },
      {
        id: 'wallet-escrow-1',
        title: 'Hold invoices & the 3-phase escrow',
        summary: 'Under the hood: how hold invoices lock funds and the dual-signature release.',
        content:
          'Escrow is designed but not yet enabled — today every trade runs on Direct-Pay. When enabled, Colabonate escrow will be built on Lightning "hold invoices" (HTLCs): unlike a normal invoice that settles instantly, a hold invoice locks the buyer\'s funds without finalizing — they are committed but not yet moved. Funds only move when both parties agree: the buyer confirms and the provider gets paid, or a dispute ruling triggers a refund. No third party holds the coins in the meantime.',
        steps: [
          { label: 'Lock', description: 'Buyer pays — funds are committed and locked, not yet settled' },
          { label: 'Work', description: 'Provider delivers; funds stay locked as guarantee' },
          { label: 'Release', description: 'Buyer confirms → invoice settles, funds move to provider' },
          { label: 'Or refund', description: 'Dispute resolved against provider → locked funds return to buyer' },
        ],
        tips: [
          { icon: 'info', text: 'Locked funds are guaranteed by the Lightning protocol, not held by Colabonate.' },
        ],
        expandedSections: [
          {
            title: 'HTLC mechanics (simplified)',
            content:
              'A hold invoice uses a Hashed Time-Locked Contract: the buyer locks funds against a hash, and the payment only completes when the provider reveals the matching secret (the preimage). Until then the funds are in limbo — committed but not transferred. This is what makes conditional, trust-minimized escrow possible on Lightning.',
          },
          {
            title: 'Milestone escrow split',
            content:
              'For multi-stage services, the total is split into milestones, each with its own hold invoice. As each milestone is completed and approved, its portion settles independently. Released funds stay with the provider; only the remaining locked milestones are at stake if a dispute opens.',
          },
          {
            title: 'Dispute → Arbitration Council',
            content:
              'If the parties cannot agree, the dispute escalates to the Arbitration Council after a cooling-off period. The council reviews evidence and issues a binding ruling that settles the locked hold invoice — releasing to the seller, refunding the buyer, or splitting proportionally. The ruling is what reveals (or withholds) the preimage, so funds only move per the decision.',
          },
        ],
        tags: ['escrow', 'hold invoice', 'htlc', 'state machine', 'milestones', 'dispute'],
      },
      {
        id: 'wallet-trouble-1',
        title: 'Payment troubleshooting',
        summary: 'Common payment errors and how to fix them — wallets, liquidity, and timeouts.',
        content:
          'Most payment problems fall into three buckets: no wallet connected, not enough inbound liquidity, or an expired/failed invoice. Colabonate returns structured error codes so you know exactly what to fix.',
        steps: [
          { label: 'WALLET_REQUIRED', description: 'No receiving rail yet — connect one in Settings → Wallet' },
          { label: 'PAYMENT_UPSTREAM_ERROR', description: 'The Lightning provider rejected it — check amount limits / liquidity' },
          { label: 'Invoice expired', description: 'Lightning invoices timeout — regenerate and pay quickly' },
        ],
        tips: [
          { icon: 'warning', text: 'A brand-new wallet often has no inbound liquidity — fund it on-chain or use an LNURL withdraw first.' },
          { icon: 'info', text: 'Keep all dispute-relevant communication inside the platform — external messages are not evidence.' },
        ],
        expandedSections: [
          {
            title: 'Common error codes',
            content:
              'WALLET_REQUIRED (400): you have no receiving rail connected yet — add one in Settings → Wallet (Lightning address, NWC, Alby, or Cashu). PAYMENT_UPSTREAM_ERROR (502): the seller\'s Lightning wallet rejected the invoice, often due to amount limits or missing liquidity. DB_ERROR (500): a server-side problem — retry or contact support.',
          },
          {
            title: 'No inbound liquidity — how to fix',
            content:
              'To RECEIVE over Lightning your wallet needs inbound capacity. New wallets start empty. Fix it by: funding on-chain then opening a channel, using an LNURL withdraw from a service that pushes sats to you, or using a wallet with built-in liquidity management (e.g. Phoenix). For larger amounts, ensure sufficient channel capacity.',
          },
          {
            title: 'Invoice expired',
            content:
              'Lightning invoices have a short expiry (often minutes). If you wait too long, the invoice becomes invalid and the payment fails. Regenerate the invoice and pay promptly. For escrow hold invoices, the lock survives, but a fresh invoice may be needed if the initial setup times out.',
          },
        ],
        tags: ['troubleshooting', 'liquidity', 'error', 'payment', 'wallet required'],
      },
      {
        id: 'wallet-5',
        title: 'Zaps, nutzaps, and supporting the project',
        summary: 'Send a Lightning tip to support Colabonate, and — with eCash enabled — send NIP-61 nutzaps to a Nostr identity.',
        content:
          'On Home you can zap the project a few sats from your connected wallet, choosing a tier or a custom amount. That tip is a plain Lightning payment to the project address, not a Nostr zap. If you have enabled the non-custodial Cashu eCash wallet, you can also send a NIP-61 nutzap to an npub or hex pubkey, and incoming nutzaps are claimed automatically.',
        steps: [
          { label: 'Support the project', description: 'On Home, use Zap the project a few sats — choose a tier or a custom amount' },
          { label: 'Enable eCash for nutzaps', description: 'Settings → Wallet → Enable non-custodial eCash (Cashu) must be on first' },
          { label: 'Send a nutzap', description: 'In the Cashu panel choose Nutzap, then enter a recipient npub/hex, amount, and optional memo' },
          { label: 'Claim incoming', description: 'Incoming nutzaps are claimed automatically; you can also Claim nutzaps manually' },
        ],
        tips: [
          { icon: 'info', text: 'The Home tip is a normal Lightning payment to the project — it does not publish a Nostr zap event.' },
          { icon: 'warning', text: 'Nutzaps use your Cashu eCash balance, so the usual bearer-token caution applies: losing your wallet state means losing the balance.' },
          { icon: 'info', text: 'Full NIP-57 zaps on profiles and offers are planned but not live yet.' },
        ],
        tags: ['zap', 'nutzap', 'nip-61', 'tips', 'cashu', 'support'],
      },
    ],
  },
  {
    id: 'identity-trust',
    title: 'Identity & Trust',
    description: 'HID levels, reviews, COL-Points, and verification signals.',
    icon: <Fingerprint sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-2)',
    bgColor: 'color-mix(in srgb, var(--color-accent-2) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-2) 15%, transparent)',
    iconColor: 'var(--color-accent-2)',
    articles: [
      {
        id: 'id-1',
        title: 'Human Identity (HID)',
        summary: 'Decentralized identity concept — what HID means and why it matters.',
        content:
          'Human Identity (HID) is Colabonate\'s decentralized identity layer. It proves you are a unique real human without revealing your personal data. HID is verified through biometric proof and peer validation. It is the highest trust signal on the platform.',
        tips: [
          { icon: 'info', text: 'HID verification is one-time — your L3 status persists until revoked.' },
        ],
        tags: ['hid', 'identity', 'biometric', 'decentralized'],
      },
      {
        id: 'id-2',
        title: 'Verification levels L0–L3',
        summary: 'What each level enables and how to upgrade your account.',
        content:
          'L0 (Anonymous): no verification, basic features. L1 (Nostr): confirms key ownership via signing. L2 (Peer): other users have vouched for you. L3 (HID): biometric human verification. Higher levels unlock higher transaction limits and better visibility in search.',
        steps: [
          { label: 'L0', description: 'No verification — basic access' },
          { label: 'L1', description: 'Nostr key confirmed — free to upgrade' },
          { label: 'L2', description: 'Peer vouch — get 3 L2/L3 users to verify you' },
          { label: 'L3', description: 'Biometric HID — complete the HID verification flow' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Start at L1 immediately after login — it only takes 10 seconds with a NIP-07 extension.' },
        ],
        tags: ['verification', 'levels', 'l0', 'l1', 'l2', 'l3'],
      },
      {
        id: 'id-3',
        title: 'Reviews and ratings',
        summary: 'How to read and leave reviews for buyers and providers.',
        content:
          'After a completed transaction, both parties can leave a review. Reviews are public and linked to your identity level. Providers with more positive reviews appear higher in search. You cannot edit or delete reviews after submission.',
        steps: [
          { label: 'Complete transaction', description: 'The ticket must reach Completed status' },
          { label: 'Leave review', description: 'Rate 1–5 stars and write a short comment' },
          { label: 'View reviews', description: 'See all reviews on any public profile' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Detailed reviews (what went well, what could improve) help the whole community.' },
        ],
        tags: ['reviews', 'ratings', 'reputation'],
      },
      {
        id: 'id-4',
        title: 'COL-Points',
        summary: 'The community reputation points system and how to earn them.',
        content:
          'COL-Points are earned through positive contributions: completing transactions, receiving good reviews, verifying identity, and participating in governance. Points are visible on your profile and influence your reputation score. They cannot be bought or transferred.',
        tips: [
          { icon: 'info', text: 'COL-Points are updated weekly based on your activity in the past 90 days.' },
        ],
        tags: ['col-points', 'reputation', 'rewards'],
      },
      {
        id: 'id-5',
        title: 'Trust signals',
        summary: 'What badges and indicators mean on user profiles.',
        content:
          'Profile badges indicate identity level (L1/L2/L3), verification status (HID), and community standing (COL-Points tier). The Verified checkmark means the account has passed manual review. Always look for these signals before high-value transactions.',
        tips: [
          { icon: 'lightbulb', text: 'Hover over any badge to see exactly what it guarantees.' },
        ],
        tags: ['trust', 'badges', 'signals', 'verification'],
      },
      {
        id: 'id-6',
        title: 'MetaMask identity derivation',
        summary: 'How Colabonate turns a MetaMask signature into a Nostr identity without storing your seed.',
        content:
          'When you log in with MetaMask, you sign a fixed message that says "derive my Colabonate Nostr identity". The 65-byte signature is run through HKDF-SHA256 with a fixed salt and your lower-case address as info. The resulting 32 bytes are used as a Nostr (Schnorr) private key. Because the message and salt never change, the same MetaMask seed always produces the same Nostr identity on any device. Colabonate never sees your MetaMask seed or the derived private key.',
        tips: [
          { icon: 'info', text: 'The derivation is client-side: your browser computes the Nostr key and only the public key is sent to the server.' },
          { icon: 'warning', text: 'If you lose access to your MetaMask seed, you cannot recover this Nostr identity — back up your MetaMask recovery phrase.' },
        ],
        tags: ['metamask', 'evm', 'identity', 'derivation', 'security'],
      },
      {
        id: 'id-7',
        title: 'Web of Trust',
        summary: 'How social reputation and identity levels work together on Colabonate.',
        content:
          'Web of Trust (WoT) is the idea that reputation spreads through real social relationships. On Nostr, your follows, recommendations, and interactions create a social graph that helps others decide whom to trust. Colabonate does not rely on WoT alone — it complements the social graph with structured identity levels (L0–L3) and escrow, so commerce can happen safely even between people who do not share a direct social circle.',
        steps: [
          { label: 'Social graph', description: 'Follows and recommendations from people you know' },
          { label: 'Identity levels', description: 'Structured verification that resists fake accounts' },
          { label: 'Escrow', description: 'Cryptographic protection when trust signals are not enough' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'WoT is great for small, repeated trades within a community; escrow protects high-value trades with strangers.' },
          { icon: 'info', text: 'Colabonate chose structured identity levels over pure WoT to avoid the cold-start problem and coordinated Sybil attacks.' },
        ],
        expandedSections: [
          {
            title: 'What is Web of Trust?',
            content:
              'A Web of Trust is a decentralized reputation system built on social relationships. Instead of a central authority saying "this person is trustworthy", trust is inferred from who vouches for whom. If Alice trusts Bob, and Bob trusts Carol, Alice has an indirect reason to trust Carol. On Nostr this graph is public: follows, mentions, replies, and recommendations all contribute to a social reputation signal.',
          },
          {
            title: 'WoT on Nostr',
            content:
              'Nostr has no central identity server, so WoT is especially important. Your pubkey is your identity, and your relationships (follows, relay interactions, zaps, replies) form a public graph. Clients can use this graph to surface content and people that are closer to your trusted circle. Colabonate can read this graph to show providers and buyers that are socially close to you, but it does not use it as the sole gate for sensitive features.',
          },
          {
            title: 'Why Colabonate adds identity levels',
            content:
              'Pure WoT has two weaknesses for commerce: the cold-start problem (new users have no trusted connections) and Sybil attacks (a coordinated group can create many mutually-trusting fake accounts). Colabonate solves this with L1–L3 identity levels: L1 proves key ownership, L2 requires in-person verification by two independent peers, and L3 requires a biometric uniqueness proof. These levels give every user a baseline trust signal regardless of their existing social network.',
          },
          {
            title: 'WoT vs Escrow — when each applies',
            content:
              'WoT and escrow are complementary layers, not replacements. For small or repeated trades within a community with strong social overlap, WoT alone may be enough — reputation is the enforcement. For larger amounts or trades with strangers, escrow hold invoices provide cryptographic protection. The Arbitration Council is the fallback when WoT and escrow cannot resolve a dispute. Colabonate routes each trade to the right layer based on identity level, amount, and social proximity.',
          },
        ],
        tags: ['web of trust', 'wot', 'nostr', 'reputation', 'trust', 'escrow'],
      },
    ],
  },
  {
    id: 'dao-governance',
    title: 'DAO & Governance',
    description: 'Proposals, voting, the Foundation, and the Arbitration Council.',
    icon: <AccountBalance sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-5)',
    bgColor: 'color-mix(in srgb, var(--color-accent-5) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-5) 15%, transparent)',
    iconColor: 'var(--color-accent-5)',
    articles: [
      {
        id: 'dao-1',
        title: 'DAO overview',
        summary: 'What the Colabonate DAO is and how it governs the protocol.',
        content:
          'The Colabonate DAO (Decentralized Autonomous Organization) governs the protocol through on-chain proposals and voting. All COL token holders can participate. The DAO controls treasury funds, protocol upgrades, and the Arbitration Council composition.',
        tips: [
          { icon: 'info', text: 'The Foundation DAO is currently in bootstrap mode — see about/foundation for details.' },
        ],
        tags: ['dao', 'governance', 'protocol'],
      },
      {
        id: 'dao-2',
        title: 'Proposals and voting',
        summary: 'How to create proposals, cast votes, and the one-person-one-vote system.',
        content:
          'Any L1+ user can create a proposal for DAO discussion. Voting is one-person-one-vote (1P1V) to prevent plutocracy. Proposals have a discussion period followed by a voting period. Approved proposals are executed by the Foundation automatically.',
        steps: [
          { label: 'Create draft', description: 'Draft your proposal with rationale and implementation plan' },
          { label: 'Discussion', description: 'The community discusses in the proposal thread' },
          { label: 'Voting period', description: 'Cast your vote (Yes, No, or Abstain)' },
          { label: 'Execution', description: 'Approved proposals are enacted by the Foundation' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Search existing proposals before creating a new one to avoid duplication.' },
        ],
        tags: ['proposals', 'voting', '1p1v'],
      },
      {
        id: 'dao-3',
        title: 'Arbitration Council',
        summary: 'The dispute resolution process and how arbitrators are selected.',
        content:
          'The Arbitration Council resolves disputes that cannot be settled directly. It operates in bootstrap mode initially (founding arbitrators) and transitions to elected representation as the DAO matures. Council rulings are binding and trigger escrow state transitions.',
        tips: [
          { icon: 'info', text: 'Disputes must go through Level 1 (cooling off) before escalating to the Council.' },
        ],
        tags: ['arbitration', 'disputes', 'council', 'escrow'],
      },
      {
        id: 'dao-4',
        title: 'Foundation',
        summary: 'About the Colabonate Foundation and its role in the ecosystem.',
        content:
          'The Colabonate Foundation is the legal and operational entity behind the protocol. It executes DAO decisions, manages the treasury, and coordinates the Arbitration Council. It is bound by the Codex constitution and cannot act unilaterally.',
        tips: [
          { icon: 'info', text: 'Visit /about/foundation to read the current Foundation status and bootstrap disclosures.' },
        ],
        tags: ['foundation', 'treasury', 'codex'],
      },
    ],
  },
  {
    id: 'tickets-orders',
    title: 'Tickets & Orders',
    description: 'Order tracking, milestone management, escrow status, and disputes.',
    icon: <ConfirmationNumber sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-4)',
    bgColor: 'color-mix(in srgb, var(--color-accent-4) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-4) 15%, transparent)',
    iconColor: 'var(--color-accent-4)',
    articles: [
      {
        id: 'tickets-1',
        title: 'Ticket lifecycle',
        summary: 'Status flow from PENDING to COMPLETED through all stages.',
        content:
          'Every order becomes a ticket with a status: PENDING (awaiting provider acceptance), ACCEPTED (provider accepted, awaiting payment), PAID (buyer paid the provider directly), IN_PROGRESS (work underway), and COMPLETED (buyer confirmed delivery). Disputes can occur at any stage.',
        steps: [
          { label: 'PENDING', description: 'Order placed, awaiting provider acceptance' },
          { label: 'ACCEPTED', description: 'Provider accepted; buyer pays' },
          { label: 'PAID', description: 'Payment received by the provider; work begins' },
          { label: 'IN_PROGRESS', description: 'Milestones being completed' },
          { label: 'COMPLETED', description: 'Buyer confirmed delivery' },
        ],
        tips: [
          { icon: 'warning', text: 'If a ticket is stuck in IN_PROGRESS without updates, open a chat with the provider.' },
        ],
        tags: ['ticket', 'status', 'lifecycle', 'order'],
      },
      {
        id: 'tickets-2',
        title: 'Milestone tracking',
        summary: 'Define milestones, track progress, and approve completion.',
        content:
          'For PER_MILESTONE cooperations, each milestone is paid separately. The buyer approves completion of each milestone and then pays that stage directly. Providers submit milestone completion evidence; buyers accept or dispute.',
        steps: [
          { label: 'Define milestones', description: 'Set milestones with descriptions and payments during creation' },
          { label: 'Complete work', description: 'Provider submits evidence for each milestone' },
          { label: 'Approve', description: 'Buyer approves and pays that milestone' },
        ],
        tips: [
          { icon: 'lightbulb', text: 'Use the chat inside the ticket to discuss milestone evidence before approving.' },
        ],
        tags: ['milestones', 'tracking', 'escrow', 'cooperation'],
      },
      {
        id: 'tickets-3',
        title: 'Escrow status panel',
        summary: 'Escrow state on a ticket — only shown once escrow is enabled.',
        content:
          'Escrow is not yet enabled — Direct-Pay tickets have no escrow panel. Once escrow is live, the panel on an escrowed ticket will show the amount held, the current state (UNLOCKED, LOCKED, RELEASED, REFUNDED) and a history of state transitions.',
        tips: [
          { icon: 'info', text: 'Until escrow is live, the ticket status and the payment proof (preimage) are your record of payment.' },
        ],
        tags: ['escrow', 'status', 'panel', 'lightning'],
      },
      {
        id: 'tickets-4',
        title: 'Disputes and resolution',
        summary: 'How to open a dispute and what to expect from the resolution process.',
        content:
          'If you cannot resolve an issue directly with the other party, open a dispute from the ticket. The dispute goes through Level 1 (7-day cooling off) first. If unresolved, it escalates to the Arbitration Council for a binding ruling. Evidence collected during the process is used by arbitrators.',
        steps: [
          { label: 'Open dispute', description: 'Tap "Open Dispute" on the ticket' },
          { label: 'Cooling off', description: '7-day direct negotiation period' },
          { label: 'Escalate', description: 'If unresolved, escalate to Arbitration Council' },
          { label: 'Ruling', description: 'Council issues a binding verdict' },
        ],
        tips: [
          { icon: 'warning', text: 'Keep all communication inside the platform — external messages cannot be used as evidence.' },
        ],
        tags: ['disputes', 'resolution', 'arbitration', 'refund'],
      },
    ],
  },
  {
    id: 'messages-notifications',
    title: 'Messages & Notifications',
    description: 'Your in-app notifications, and your encrypted NIP-17 inbox for private offers and messages.',
    icon: <Forum sx={{ fontSize: 22 }} />,
    color: 'var(--color-accent-4)',
    bgColor: 'color-mix(in srgb, var(--color-accent-4) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-4) 15%, transparent)',
    iconColor: 'var(--color-accent-4)',
    articles: [
      {
        id: 'msg-1',
        title: 'Notifications',
        summary: 'Ticket, offer, message, and system updates, collected in one in-app feed.',
        content:
          'The bell in the navigation and the page at /notifications collect your updates. Notifications are delivered in-app: the app checks for new items and groups them by type. You can mark items read or archive them, or use Read All and Archive All to clear the list. Archived items are kept for 30 days and read items for 180 days.',
        steps: [
          { label: 'Open the bell or /notifications', description: 'The bell shows a badge with the unread count' },
          { label: 'Filter by type', description: 'All, Tickets, Offers, Messages, or System' },
          { label: 'Mark read or archive', description: 'Handle items individually, or use Read All / Archive All' },
        ],
        tips: [
          { icon: 'info', text: 'Cooperation updates appear under All — there is no separate Cooperations tab yet.' },
          { icon: 'warning', text: 'Notifications are in-app only today. Browser push, email, and Nostr DM delivery are not enabled.' },
        ],
        tags: ['notifications', 'updates', 'in-app', 'tickets', 'bell'],
      },
      {
        id: 'msg-2',
        title: 'Your encrypted inbox (private offers)',
        summary: 'Read NIP-17 gift-wrapped messages and accept private offers — with some parts still being built.',
        content:
          'The inbox at /messages shows NIP-17 gift-wrapped private offers and messages, decrypted locally in your browser. You can open a private offer and accept it, which creates a private ticket with a Lightning invoice held until both parties confirm completion. Private trades build no public reputation and are handled by a mutually accepted arbiter, or none if you opt out.',
        steps: [
          { label: 'Open /messages', description: 'There is no menu entry yet — open the inbox directly' },
          { label: 'Filter the inbox', description: 'All, Offers, Cooperations, Chat, or Other' },
          { label: 'Open a private offer', description: 'Read the decrypted message and its terms' },
          { label: 'Accept or decline', description: 'Accepting creates a private ticket; declining closes the view' },
        ],
        tips: [
          { icon: 'warning', text: 'The counter-offer dialog captures your input but does not send yet — sending a counter-offer is still being built.' },
          { icon: 'info', text: 'Chat and cooperation threads are not available yet; only the private-offer detail view is implemented.' },
          { icon: 'info', text: 'Only you and the sender can read a gift-wrapped message — it is never published publicly.' },
        ],
        tags: ['messages', 'nip-17', 'private offer', 'encrypted', 'inbox', 'dm'],
      },
    ],
  },
]

export const HELP_FAQ = [
  { id: 'faq-beta', title: 'Is this real money? What\'s still being built?', articleId: 'beta-1', sectionId: 'beta' },
  { id: 'faq-1', title: 'How do I create my first offer?', articleId: 'sell-4', sectionId: 'selling' },
  { id: 'faq-2', title: 'What are identity levels?', articleId: 'gs-2', sectionId: 'getting-started' },
  { id: 'faq-3', title: 'Is there escrow? How do payments work?', articleId: 'wallet-3', sectionId: 'wallet' },
  { id: 'faq-4', title: 'How do I start a cooperation?', articleId: 'coop-1', sectionId: 'cooperation' },
  { id: 'faq-5', title: 'How do I track my orders?', articleId: 'buy-5', sectionId: 'buying' },
  { id: 'faq-6', title: 'What is a private key?', articleId: 'wallet-keys-1', sectionId: 'wallet' },
  { id: 'faq-7', title: 'Custodial vs. non-custodial?', articleId: 'wallet-types-1', sectionId: 'wallet' },
  { id: 'faq-8', title: 'How does Nostr authentication work?', articleId: 'wallet-keys-2', sectionId: 'wallet' },
  { id: 'faq-9', title: 'Can I use MetaMask as a Lightning wallet?', articleId: 'gs-5', sectionId: 'getting-started' },
  { id: 'faq-10', title: 'Can I pay without a browser extension?', articleId: 'wallet-types-4', sectionId: 'wallet' },
  { id: 'faq-login-email', title: 'How does email login work and where is my key?', articleId: 'lp-4', sectionId: 'login-providers' },
  { id: 'faq-login-compare', title: 'Which login provider should I choose?', articleId: 'lp-5', sectionId: 'login-providers' },
  { id: 'faq-ai', title: 'How do Colabonate AI credits work?', articleId: 'ai-3', sectionId: 'ai-agents' },
  { id: 'faq-agent-offer', title: 'How do I offer an AI agent?', articleId: 'ai-4', sectionId: 'ai-agents' },
  { id: 'faq-mcp', title: 'How do I connect my own agent via MCP?', articleId: 'ai-7', sectionId: 'ai-agents' },
  { id: 'faq-bounty', title: 'What is a bounty and how do I post one?', articleId: 'bounty-1', sectionId: 'bounties' },
  { id: 'faq-notifications', title: 'How do notifications work?', articleId: 'msg-1', sectionId: 'messages-notifications' },
  { id: 'faq-sessions', title: 'How do bookable sessions work?', articleId: 'sell-6', sectionId: 'selling' },
]

export function getSection(id: string): HelpSectionDef | undefined {
  return HELP_SECTIONS.find(s => s.id === id)
}

export function getArticle(sectionId: string, articleId: string): HelpArticle | undefined {
  const section = getSection(sectionId)
  return section?.articles.find(a => a.id === articleId)
}

export function getAllArticles(): HelpArticle[] {
  return HELP_SECTIONS.flatMap(s => s.articles)
}
