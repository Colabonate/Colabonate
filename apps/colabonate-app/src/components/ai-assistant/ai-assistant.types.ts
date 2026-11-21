export type AiProviderId = 'local' | 'openai' | 'adapter' | 'platform';

export interface AiProviderInfo {
  provider: AiProviderId;
  label: string;
  model?: string;
  supportsImages: boolean;
  /** ADR-384: remaining Colabonate-hosted credits (platform mode only). */
  requestsRemaining?: number;
}

export type SSEEvent =
  | { type: 'provider-info'; info: AiProviderInfo }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; tool: string; label: string }
  | { type: 'tool-result'; payload: EntityPayload }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string };

export type EntityPayload =
  | { kind: 'offers'; items: OfferItem[] }
  | { kind: 'cooperations'; items: CooperationItem[] }
  | { kind: 'companies'; items: CompanyItem[] }
  | { kind: 'tickets'; items: TicketItem[] }
  | { kind: 'proposals'; items: ProposalItem[] }
  | { kind: 'daos'; items: DaoItem[] }
  | { kind: 'dao_members'; items: DaoMemberItem[] }
  | { kind: 'dao_treasury'; items: TreasuryItem[] }
  | { kind: 'bounties'; items: BountyItem[] }
  | { kind: 'bounty_applications'; items: BountyApplicationItem[] }
  | { kind: 'payment_status'; entity: PaymentStatusItem }
  | { kind: 'pending_images'; items: unknown[] }
  | { kind: 'image_uploaded'; entity: { url: string } }
  | { kind: 'created'; entityType: EntityType; entity: unknown }
  | { kind: 'updated'; entityType: EntityType; entity: unknown; changed: string[] }
  | { kind: 'deleted'; entityType: EntityType; id: string; title?: string }
  | { kind: 'unknown'; items: unknown[] };

export type EntityType = 'offer' | 'cooperation' | 'company' | 'ticket' | 'proposal' | 'dao' | 'dao_member';

export interface OfferItem {
  id: string;
  title: string;
  priceSats: number;
  category?: string;
  offerType?: string;
  status?: string;
  description?: string;
  sourceQuery?: string;
  images?: string[];
  imageThumbs?: string[] | null;
}

export interface CooperationItem {
  id: string;
  title: string;
  status?: string;
  cooperationType?: string;
  budgetSats?: number;
  images?: string[];
  imageThumbs?: string[] | null;
}

export interface CompanyItem {
  id: string;
  name: string;
  city?: string;
  country?: string;
  description?: string;
}

export interface TicketItem {
  id: string;
  offerId: string;
  status?: string;
  amountSats?: number;
  offer?: { id: string; title: string; priceSats: number };
}

export interface ProposalItem {
  id: string;
  title: string;
  status?: string;
  daoId?: string;
  authorPubkey?: string;
  votingEnd?: string;
  votesFor?: number;
  votesAgainst?: number;
  votesAbstain?: number;
}

export interface DaoItem {
  id: string;
  name: string;
  status?: string;
  proposalCount?: number;
  memberCount?: number;
}

export interface DaoMemberItem {
  id: string;
  pubkey: string;
  role?: string;
  status?: string;
}

export interface TreasuryItem {
  balanceSats?: number;
  transactionCount?: number;
}

export interface BountyItem {
  id: string;
  title: string;
  status?: string;
  budgetSats?: number;
  requiredCapabilities?: string[];
  deadline?: string;
}

export interface BountyApplicationItem {
  id: string;
  status?: string;
  proposedPriceSats?: number;
  agentProfile?: { id?: string; name?: string };
  offer?: { id?: string; title?: string; priceSats?: number };
}

export interface PaymentStatusItem {
  status?: string;
  paymentHash?: string | null;
  paid?: boolean;
  rail?: string | null;
}

export interface MessageTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: string[];
  toolActivity: ToolActivity | null;
  /** F19: completed tool steps for this turn (compact progress trail). */
  steps?: ToolStep[];
  entities: EntityPayload[];
  status: 'streaming' | 'done' | 'error' | 'cancelled';
}

export interface ToolActivity {
  tool: string;
  label: string;
}

export interface ToolStep {
  tool: string;
  label: string;
  count?: number;
}

export interface AIChatState {
  turns: MessageTurn[];
  isLoading: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: MessageTurn[];
}