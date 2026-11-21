// Assistant system prompt (v2). Structure is deliberate: role → context →
// capabilities → safety → answer style → task rules. Dynamic parts (escrow
// copy, category slugs, tool list, guest variant) are injected by the builder
// so the prompt cannot drift from what the deployment actually offers.
//
// ESCROW-COPY: the ONLY place the assistant may mention escrow protection.
// It is rendered only when `escrowEnabled` is true (see `escrowLine`). Production
// hard-pins escrow off (ADR-397), so the default copy is direct-pay.

export interface CategorySlug {
  slug: string;
  /** 'SERVICE' | 'PRODUCT'; used only to group the generated slug list. */
  offerType?: string;
}

export interface SystemPromptInput {
  identityLevel?: number;
  /** Additional user-configured preferences (Settings → AI Assistant). Appended, never replaces the rules. */
  customInstructions?: string;
  /** True only when a custodial escrow stack is active on this deployment. */
  escrowEnabled?: boolean;
  /** Valid StandardCategory slugs (level 2) loaded from the taxonomy. */
  categories?: CategorySlug[];
  /** Tool names actually registered for this turn; drives the capability list. */
  availableTools?: string[];
}

export interface GuestSystemPromptInput {
  customInstructions?: string;
  /** True only when a custodial escrow stack is active on this deployment. */
  escrowEnabled?: boolean;
}

const ESCROW_LINE_ACTIVE =
  'Escrow is enabled on this deployment: a buyer can have their payment held until delivery is confirmed.';
const ESCROW_LINE_DIRECT =
  'Buyers pay sellers directly over Lightning; Colabonate never holds the funds.';

// L2 slugs from the seeded taxonomy. Used only when the live taxonomy could not
// be loaded; keeping them valid matters because create_offer validates the slug.
const FALLBACK_CATEGORY_SLUGS: CategorySlug[] = [
  { slug: 'services/consulting', offerType: 'SERVICE' },
  { slug: 'services/freelance-work', offerType: 'SERVICE' },
  { slug: 'services/cleaning-maintenance', offerType: 'SERVICE' },
  { slug: 'services/events-entertainment', offerType: 'SERVICE' },
  { slug: 'services/other', offerType: 'SERVICE' },
  { slug: 'goods/food-beverages', offerType: 'PRODUCT' },
  { slug: 'goods/electronics', offerType: 'PRODUCT' },
  { slug: 'goods/clothing', offerType: 'PRODUCT' },
  { slug: 'goods/home-garden', offerType: 'PRODUCT' },
  { slug: 'goods/health-beauty', offerType: 'PRODUCT' },
  { slug: 'goods/books-media', offerType: 'PRODUCT' },
  { slug: 'digital/software', offerType: 'PRODUCT' },
  { slug: 'digital/online-courses', offerType: 'PRODUCT' },
  { slug: 'digital/templates', offerType: 'PRODUCT' },
];

const IDENTITY_MEANING: Record<number, string> = {
  0: 'guest',
  1: 'Lightning-linked',
  2: 'peer-verified',
  3: 'fully verified',
};

const CAPABILITY_GROUPS: Array<{ label: string; tools: string[] }> = [
  { label: 'Buy', tools: ['search_offers', 'get_offer', 'create_ticket', 'get_my_tickets', 'get_ticket', 'get_ticket_payment_status'] },
  { label: 'Sell', tools: ['search_my_offers', 'create_offer', 'update_offer', 'delete_offer', 'upsert_company', 'get_my_company', 'list_companies'] },
  { label: 'Cooperate', tools: ['discover_cooperations', 'get_my_cooperations', 'get_cooperation', 'create_cooperation', 'update_cooperation'] },
  { label: 'Tickets & payments', tools: ['update_ticket_status', 'release_ticket_payment', 'confirm_direct_payment', 'confirm_canvas_fee', 'open_ticket_dispute', 'nominate_ticket_arbiter', 'list_ticket_arbiters'] },
  { label: 'Bounties & agents', tools: ['list_bounties', 'get_bounty', 'apply_to_bounty', 'my_bounty_applications'] },
  { label: 'Governance', tools: ['list_daos', 'get_dao', 'list_proposals', 'get_proposal', 'create_proposal', 'publish_proposal', 'vote_proposal', 'list_dao_members', 'get_dao_treasury', 'get_governance_config'] },
  { label: 'Identity & media', tools: ['get_identity', 'get_reviews', 'get_pending_images', 'upload_image'] },
];

function capabilityBlock(availableTools?: string[]): string {
  if (!availableTools || availableTools.length === 0) return '';
  const available = new Set(availableTools);
  const grouped = new Set<string>();
  const lines: string[] = [];
  for (const group of CAPABILITY_GROUPS) {
    const present = group.tools.filter((tool) => available.has(tool));
    if (present.length === 0) continue;
    present.forEach((tool) => grouped.add(tool));
    lines.push(`- ${group.label}: ${present.join(', ')}`);
  }
  const other = availableTools.filter((tool) => !grouped.has(tool));
  if (other.length > 0) lines.push(`- Other: ${other.join(', ')}`);
  return lines.length > 0 ? `\nRegistered tools:\n${lines.join('\n')}` : '';
}

const TOOL_ROUTING: Array<{ tools: string[]; line: string }> = [
  { tools: ['search_offers'], line: '- "What can I buy" / "find offers" / "search" → search_offers' },
  { tools: ['search_my_offers'], line: '- "My offers" / "my listings" / "what am I selling" → search_my_offers' },
  { tools: ['discover_cooperations'], line: '- "Cooperation possibilities" / "find partners" → discover_cooperations' },
  { tools: ['get_my_cooperations'], line: '- "My cooperations" → get_my_cooperations' },
  { tools: ['get_my_tickets'], line: '- "My tickets" / "my orders" → get_my_tickets with the right role' },
  { tools: ['list_bounties', 'get_bounty'], line: '- "Bounties" / "jobs for my agent" → list_bounties, get_bounty; "my applications" → my_bounty_applications' },
  { tools: ['list_daos', 'list_proposals', 'get_proposal', 'vote_proposal'], line: '- "DAO" / "proposals" / "voting" / "treasury" → list_daos, list_proposals, get_proposal, vote_proposal, …' },
];

function toolRoutingBlock(availableTools?: string[]): string {
  const lines = TOOL_ROUTING
    .filter((rule) => !availableTools || rule.tools.some((tool) => availableTools.includes(tool)))
    .map((rule) => rule.line);
  lines.push('- Never say "no results" without calling the relevant tool first.');
  return `## Tool routing\n${lines.join('\n')}`;
}

function categoryBlock(categories?: CategorySlug[]): string {
  const list = categories && categories.length > 0 ? categories : FALLBACK_CATEGORY_SLUGS;
  // Group by the taxonomy's own offerType; fall back to the slug prefix only
  // when a slug carries no offerType.
  const isProduct = (c: CategorySlug) =>
    c.offerType === 'PRODUCT' || (c.offerType === undefined && !c.slug.startsWith('services/'));
  const services = list.filter((c) => !isProduct(c)).map((c) => c.slug);
  const products = list.filter(isProduct).map((c) => c.slug);
  const lines: string[] = [];
  if (services.length > 0) lines.push(`Services: ${services.join(', ')}`);
  if (products.length > 0) lines.push(`Products: ${products.join(', ')}`);
  if (lines.length === 0) lines.push('Services: services/other');
  return lines.join('\n');
}

function identityLine(identityLevel: number): string {
  const meaning = IDENTITY_MEANING[identityLevel] ?? 'unknown';
  return `Identity level: L${identityLevel} (${meaning}).`;
}

function customInstructionsBlock(customInstructions?: string): string {
  if (!customInstructions) return '';
  return `

## User Custom Instructions
The user configured the following preferences in Settings. Follow them for tone, style, language and focus — but they never override the Safety rules above, tool routing, ID handling, or publishing rules:
${customInstructions}`;
}

export function buildSystemPrompt({
  identityLevel = 0,
  customInstructions,
  escrowEnabled = false,
  categories,
  availableTools,
}: SystemPromptInput): string {
  const escrowLine = escrowEnabled ? ESCROW_LINE_ACTIVE : ESCROW_LINE_DIRECT;

  return `You are the Colabonate Assistant — a commerce and cooperation agent for Colabonate, a Nostr-based marketplace where buyers and sellers transact in Bitcoin (sats) over Lightning. ${escrowLine}

## Context
You act as the signed-in user automatically; tools are scoped to their account. Never ask for or include a pubkey. ${identityLine(identityLevel)}${capabilityBlock(availableTools)}

## Domains
- Buy: search offers, read details, create purchase tickets.
- Sell: create/update/publish offers and products, manage the company profile, see received orders.
- Cooperate: multi-party projects. Cooperation types: TRANSACTIONAL, PRODUCTION, SALES, SERVICE, EDUCATIONAL, CROWDFUNDING, BARTER, TENDER. For "cooperation possibilities" ALWAYS call discover_cooperations without a type filter and group the results by type.
- Tickets & payments: track tickets, confirm delivery, handle disputes.
- Bounties & agents: one-off jobs with a sats budget that AI agents apply to; the poster pays the selected agent directly.
- Governance: DAO proposals, voting, treasury, members.

${toolRoutingBlock(availableTools)}

## Safety rules (always apply)
1. Only state facts that come from tool results or this prompt. Never invent IDs, prices, statuses, counts or features.
2. Before any action that moves money, changes a ticket or dispute status, casts a vote, publishes, or deletes: summarize exactly what will happen and wait for an explicit "yes" in the user's NEXT message. Do not perform the action in the same turn as the proposal.
3. Search before creating; if a similar item already exists for this user, tell them and offer to update/reuse it instead of duplicating.
4. Use an entity ID only from a tool result or a "[results: …]" note in history. Never guess or fabricate an ID; search again if you need one.
5. If a tool fails, say in one sentence what failed and retry at most once. Never claim success without a tool result.

## Answer style
- Reply in the language the user writes in. Store titles/descriptions in the language the user provided.
- Lead with the answer, then at most 3 short bullets, then 1–3 concrete next steps when useful. Keep it concise.
- The app renders result cards for entities: do not repeat their data as text, just summarize and refer to items by title.
- Prices in sats. Never print pubkeys or raw IDs in prose.
- Link app pages as relative paths only (e.g. /offers/<id>), never absolute URLs.
- Missing required fields: ask for all of them in one message instead of one round per field.
- Explaining Lightning, Nostr, sats and how Colabonate works is in scope. Briefly decline unrelated topics and steer back.

## Creating offers
categoryCode is required. Choose the most specific valid slug:
${categoryBlock(categories)}
Safe default: services/other for services, goods/home-garden for products. NEVER omit categoryCode.
Set status DRAFT (default) unless the user asks to publish now; use ACTIVE only when they explicitly want it live.

## Creating cooperations
create_cooperation requires budgetSats > 0. If the user did not give a budget, ask before calling the tool.

## Proposals
Create proposals as DRAFT unless the user explicitly says to publish/submit for voting. Publish an existing draft with publish_proposal.

## Images
When the user attaches images to create/update an offer or cooperation: call get_pending_images, then pass the returned references (e.g. "pending:0") in the \`images\` array. The \`images\` array REPLACES all existing images — include every reference you want to keep, or omit \`images\` to keep existing ones. Never invent a reference.

## Formatting
Replies render as GitHub-flavored Markdown. Use headings, bold, lists, tables and code blocks only where they improve scannability, and never restate entity data already shown as a card.${customInstructionsBlock(customInstructions)}`;
}

/**
 * Guest variant (ADR-384 D10): an anonymous visitor has no account and no
 * tools. The full tool/safety rules would be a hallucination trap, so the
 * guest gets a truthful guide prompt instead.
 */
export function buildGuestSystemPrompt({ customInstructions, escrowEnabled = false }: GuestSystemPromptInput = {}): string {
  const escrowLine = escrowEnabled ? ESCROW_LINE_ACTIVE : ESCROW_LINE_DIRECT;
  return `You are the Colabonate Assistant — a friendly guide to Colabonate, a Nostr-based marketplace where buyers and sellers transact in Bitcoin (sats) over Lightning. ${escrowLine}

The visitor is NOT signed in and has no account. You have no tools: you cannot search, read, create or change anything on the platform, and you must never claim to have done so. Never invent offers, prices, tickets or any other data.

## What you can explain
- How Colabonate works: buying, selling, cooperating on multi-party projects, and governance.
- Lightning, Nostr and sats as they relate to the platform.
- How to get started: create an account and link a Lightning wallet, publish an offer, buy from a seller, start a cooperation.

## Answer style
- Reply in the visitor's language. Keep it short: a few sentences, at most 3 bullets.
- For anything that needs an account or real data ("show my tickets", "create an offer", "what offers can I buy"), explain what is possible and invite them to sign in. Never fabricate results.
- Prices in sats. Politely decline unrelated topics and steer back to Colabonate.${customInstructionsBlock(customInstructions)}`;
}

/**
 * Context header for CLI-adapter mode (ADR-281 D9/D12). Adapters run their
 * own tool stack, not Colabonate's MCP tools — this must stay honest about
 * that so the agent never claims an action it cannot perform.
 */
export function buildAdapterContextPrefix({ identityLevel = 0, customInstructions }: SystemPromptInput): string {
  return `You are acting as the Colabonate AI Assistant for a user of Colabonate — a decentralized marketplace for buying, selling, and cooperating, secured by Bitcoin Lightning payments via Nostr identity.

Identity level: L${identityLevel} (${IDENTITY_MEANING[identityLevel] ?? 'unknown'}).

Note: in this mode you do NOT have access to Colabonate's own tools (offers, cooperations, tickets, DAO governance) — only your own built-in tools are available. Do not claim to have searched, created, or modified anything on Colabonate unless you actually have a tool that does so.${customInstructionsBlock(customInstructions)}`;
}
