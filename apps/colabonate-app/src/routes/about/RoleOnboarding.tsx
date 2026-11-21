import { Link } from 'react-router-dom'
import { Box, Chip } from '@mui/material'
import { PageContainer, PageHeader } from '@ds/ui'
import { Seo } from '../../components/Seo'
import { LegalSectionAccordion } from '../../components/ui/LegalSectionAccordion'
import type { LegalSection } from '../../components/ui/LegalSectionAccordion'

const ONBOARDING_SECTIONS: LegalSection[] = [
  {
    title: 'For Arbitrators — Who You Are',
    badge: 'Arbitrator',
    content: (
      <>
        <p>
          You are a member of the Colabonate Arbitration Council, the operative arm of the Foundation DAO.
          Your authority derives from your Kind 30021 credential (signed and published on the Nostr relay)
          and your status as ACTIVE in the DAO member registry.
        </p>
        <p>
          <strong>Your role:</strong> Review dispute evidence, apply the Arbitration Rubric, and issue a
          binding verdict (RELEASE or CANCEL). Your verdict triggers the escrow state transition — it is
          consequential and permanent.
        </p>
        <p>
          <strong>You are not:</strong> A judge who enforces law; a mediator who negotiates settlement;
          an advocate for either party.
        </p>
      </>
    ),
  },
  {
    title: 'For Arbitrators — Before Your First Verdict',
    content: (
      <>
        <p>Read the following in order before submitting your first verdict:</p>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li><strong>Arbitration Rubric v1.0.0</strong> — Read §1–§4 completely. You need to know the Decision Matrix and when deviation is appropriate.</li>
          <li><strong>DAO Codex Appendix A</strong> — Understand the bootstrap context; you operate under M2 rules (SINGLE quorum until M3).</li>
          <li><strong>Dispute Protocol</strong> — Understand the 3-level system and when a dispute is eligible for Council review.</li>
          <li><strong>Arbitration Council Spec</strong> — Technical operational details: credential types, event kinds, quorum evaluation.</li>
        </ol>
        <p className="text-[var(--theme-text-muted)] text-xs mt-3">Estimated reading time: 20–30 minutes.</p>
      </>
    ),
  },
  {
    title: 'For Arbitrators — Workflow',
    content: (
      <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Receive email notification — new dispute arrived</li>
        <li>Open /council/disputes/:id — review the evidence</li>
        <li>Check the rubric link — apply relevant row</li>
        <li>Write reasoning (optional but encouraged) — cite rubric row or deviation</li>
        <li>Submit verdict (RELEASE or CANCEL) — immutable once submitted</li>
        <li>Quorum evaluation runs automatically — if met, escrow transitions</li>
      </ol>
    ),
  },
  {
    title: 'For Arbitrators — Response Time & Immutability',
    content: (
      <>
        <p>
          Resolve disputes within <strong>48 hours</strong> of receiving the notification email.
          Time-sensitive cases (e.g., hold-invoice expiry) may require faster response. The Council page
          shows dispute age — prioritize older cases.
        </p>
        <p>
          Verdicts are <strong>permanent once submitted.</strong> You cannot edit or retract them.
          Before submitting:
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li>Have you read the evidence?</li>
          <li>Have you applied the rubric (or documented a deviation)?</li>
          <li>Is your reasoning field complete enough that another arbitrator could follow your logic?</li>
          <li>Are you confident the outcome matches the evidence?</li>
        </ul>
        <p className="text-[var(--theme-text-muted)] text-xs mt-3">If any answer is no, wait. There is no undo.</p>
      </>
    ),
  },
  {
    title: 'For Arbitrators — Revocation',
    content: (
      <>
        <p>
          Your membership can be revoked by a DAO Admin via a Kind 5 event. If revoked:
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li>Your Kind 30021 credential is invalidated</li>
          <li>Any pending verdicts you have not yet submitted cannot be submitted under your credential</li>
          <li>Verdicts already submitted remain valid and on-chain (immutable)</li>
          <li>Your reputation score is affected by any unresolved disputes you were assigned</li>
        </ul>
      </>
    ),
  },
  {
    title: 'For Admins — Who You Are',
    badge: 'Admin',
    content: (
      <p>
        You are a DAO Admin: you manage membership, configuration, and serve as tie-breaker in M2
        (this changes in M3 when rotating assignments are introduced). You have privileges that
        arbitrators do not: invite members, revoke credentials, update DAO config.
      </p>
    ),
  },
  {
    title: 'For Admins — Before Your First Admin Action',
    content: (
      <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Read <strong>DAO Codex Chapters I–IV</strong> — Understand voting models, amendment procedure, and the full governance structure.</li>
        <li>Read <strong>Arbitration Council Spec</strong> — Understand member lifecycle (INVITE → PENDING → ACTIVE → REVOKED).</li>
        <li>Confirm you have your NIP-07 extension (nos2x or getalby) configured — Admin actions require signed challenges.</li>
      </ol>
    ),
  },
  {
    title: 'For Admins — Invite Flow',
    content: (
      <>
        <p>When inviting a new arbitrator:</p>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li>Collect their pubkey (Nostr npub format, e.g., <code>npub1...</code>)</li>
          <li>Send an invite out-of-band (email or Nostr DM) containing their pubkey, link to the onboarding guide, expected response time (48 hours), and current Council workload</li>
          <li>The invitee signs Kind 30021 with their NIP-07 extension — credential published to relay</li>
          <li>You approve — status set to ACTIVE — they appear in the Council dashboard</li>
        </ol>
      </>
    ),
  },
  {
    title: 'For Admins — Revocation & Config',
    content: (
      <>
        <p className="text-sm font-medium">Revocation (Kind 5):</p>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2 mb-3">
          <li>Go to the Admin panel → Members → select member</li>
          <li>Click Revoke</li>
          <li>Sign the Kind 5 event with your NIP-07 extension</li>
          <li>The revocation is published to the relay; the member&apos;s status changes to REVOKED</li>
        </ol>
        <p className="text-[var(--theme-text-muted)] text-xs">Kind 5 is permanent. A revoked member cannot be reinstated under the same pubkey without a new invite and credential.</p>
        <p className="text-sm font-medium">Config Changes:</p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li><strong>Quorum type</strong> (SINGLE / MAJORITY / THRESHOLD): Change only when Council membership changes materially</li>
          <li><strong>Cooling-off days:</strong> Default is 7 days. Changes affect new disputes only</li>
          <li><strong>Threshold N:</strong> Set to match the number of active arbitrators at time of configuration</li>
        </ul>
      </>
    ),
  },
  {
    title: 'For Disputants — Before Opening a Dispute',
    badge: 'Disputant',
    content: (
      <>
        <p>
          You must have attempted <strong>Level 1 resolution first.</strong> This means:
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2 mb-3">
          <li>At least 7 days of documented direct communication with the other party</li>
          <li>A clear description of the breach you are disputing</li>
          <li>Evidence that you attempted to resolve the issue (messages, timestamps)</li>
        </ul>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Opening a dispute without a documented L1 attempt will be noted by the arbitrator and may
          reduce the weight of your claims, though it will not result in outright dismissal.
        </p>
      </>
    ),
  },
  {
    title: 'For Disputants — What Makes a Well-Formed Dispute',
    content: (
      <>
        <p>A good dispute description includes:</p>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2 mb-3">
          <li><strong>Timeline:</strong> What happened, in chronological order</li>
          <li><strong>Evidence:</strong> Links to relevant Nostr events, chat logs, or screenshots with timestamps</li>
          <li><strong>Desired outcome:</strong> RELEASE (funds to seller) or CANCEL (refund to buyer)</li>
          <li><strong>Ticket ID:</strong> The ticket in question</li>
        </ol>
        <p className="text-sm font-medium">Evidence that carries weight:</p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2 mb-3">
          <li>Timestamped Nostr events (most reliable)</li>
          <li>Chat logs attributable to both parties&apos; pubkeys</li>
          <li>Screenshots with metadata visible</li>
        </ul>
        <p className="text-sm font-medium">Evidence that carries little weight:</p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li>Vague claims (&quot;they never delivered&quot;)</li>
          <li>One party&apos;s word against another without corroboration</li>
          <li>Evidence that cannot be tied to the relevant pubkeys or ticket</li>
        </ul>
      </>
    ),
  },
  {
    title: 'For Disputants — What Happens Next',
    content: (
      <>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2 mb-3">
          <li>You open dispute → ticket transitions to DISPUTED</li>
          <li>DAO arbitrators receive email notification</li>
          <li>Arbitrator reviews evidence, applies rubric, issues verdict</li>
          <li>If quorum met → escrow transitions (RELEASE or CANCEL)</li>
          <li>Both parties receive email notification of verdict</li>
          <li>Verdict is immutable → no contest in M2 (Phase 4 Appeal planned)</li>
        </ol>
        <p className="text-[var(--theme-text-muted)] text-xs">Timeline: Typically 24–48 hours from escalation to resolution, depending on arbitrator availability.</p>
      </>
    ),
  },
  {
    title: 'For Disputants — Outcomes',
    content: (
      <div className="space-y-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">RELEASE — Funds released to seller</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Escrow settled; ticket COMPLETED</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">CANCEL — Funds refunded to buyer</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Escrow cancelled; ticket CANCELLED</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">SPLIT — (Not yet implemented)</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Deferred per Rubric §4</span>
        </div>
      </div>
    ),
  },
  {
    title: 'Role Matrix Quick Reference',
    content: (
      <div className="space-y-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">ADMIN</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Invite/revoke members, update config, tie-break (M2), issue verdicts</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Cannot: Self-revoke; override other admin decisions</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">ARBITRATOR</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Submit verdicts, read disputes, review evidence</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Cannot: Invite/revoke members, change config</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">MEDIATOR</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Reserved — Phase 3</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">DISPUTANT</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Open dispute, withdraw (before IN_REVIEW), receive verdict</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Cannot: Submit verdict, see pre-publication reasoning</span>
        </div>
      </div>
    ),
  },
]

export function RoleOnboarding() {
  return (
    <>
      <Seo
        title="Role Onboarding"
        description="Role onboarding for the Colabonate Arbitration Council: guides for arbitrators, admins and disputants — workflows, verdicts, response times and escalation paths."
        path="/about/role-onboarding"
      />
    <PageContainer size="standard" spacing="lg">
      <PageHeader
        title="Role Onboarding"
        subtitle="Colabonate Arbitration Council — guides for Arbitrators, Admins, and Disputants"
      />

      <Box className="flex items-center gap-2 mb-6">
        <Chip
          label="Version 1.0.0"
          size="small"
          className="!text-[11px] !h-[22px] !rounded-md"
          sx={{
            borderColor: 'var(--color-accent-1)',
            color: 'var(--color-accent-1)',
            backgroundColor: 'transparent',
            border: '1px solid',
          }}
        />
        <Chip
          label="M2 Operation"
          size="small"
          className="!text-[11px] !h-[22px] !rounded-md"
          sx={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text-muted)',
            backgroundColor: 'transparent',
            border: '1px solid',
          }}
        />
      </Box>

      <Box className="flex flex-col gap-3 mb-6">
        {ONBOARDING_SECTIONS.map((section) => (
          <LegalSectionAccordion key={section.title} section={section} />
        ))}
      </Box>

      <Box className="flex items-center gap-4">
        <Link
          to="/about/foundation"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          ← Foundation DAO
        </Link>
        <span style={{ color: 'var(--theme-border)' }}>·</span>
        <Link
          to="/about/codex"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          DAO Codex →
        </Link>
      </Box>
    </PageContainer>
    </>
  )
}
