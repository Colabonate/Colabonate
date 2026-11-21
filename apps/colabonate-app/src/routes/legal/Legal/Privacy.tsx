import { Box, Chip } from '@mui/material'
import { Shield } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../../components/PageHeader'
import { Seo } from '../../../components/Seo'
import { LegalSectionAccordion } from '../../../components/ui/LegalSectionAccordion'
import type { LegalSection } from '../../../components/ui/LegalSectionAccordion'

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: '1. Effective Date & Overview',
    badge: 'GDPR · Swiss FADP',
    content: (
      <>
        <p>
          This policy enters into force on <strong>October 16, 2025</strong> and serves to protect the
          personal data of our users within the Colabonate ecosystem. Unlike centralized systems, data
          processing primarily occurs through cryptographic protocols and decentralized computing units.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 12, 13, 14, 25 GDPR (Duty to inform and Data Protection by
          Design), Swiss FADP.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Core Entities:</strong> Codex (DAO) as the governance structure and the Sovereign Identity
          Framework (SI) as the decentralized identity layer.
        </p>
      </>
    ),
  },
  {
    title: '2. Scope',
    content: (
      <>
        <p>
          This policy applies to all interactions, services, web interfaces, and decentralized modules
          within the Colabonate network.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 4 Para. 1 and 2 GDPR — refers to all processing of personal data.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          The policy specifically covers: the <strong>Colabonate Wallet</strong>, the{' '}
          <strong>Codex-based governance rules</strong>, the <strong>Audio/Video/Chat System</strong>,
          the <strong>Ticket System</strong>, and the <strong>Proximity Proof Mechanism</strong>.
        </p>
      </>
    ),
  },
  {
    title: '3. Acceptance & Consent',
    content: (
      <>
        <p>
          Use of the Colabonate platform and its modules implies acceptance of this policy. As no central
          registration is required, consent is given by cryptographically signing user actions.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 6 Para. 1 lit. a and Art. 7 GDPR (Requirements for consent).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Consent to specific data processing operations is provided through <strong>digital signatures</strong>,
          generated via the <strong>SI Identity Layer</strong> (Wallet). Executing <strong>Proximity Proofs</strong>{' '}
          serves as a contextual consent mechanism for verifying presence, not central identification.
        </p>
      </>
    ),
  },
  {
    title: '4. Collection of Data',
    badge: 'Minimal Data',
    content: (
      <>
        <p>
          Colabonate adheres to the principle of minimal data collection. Personal data is only collected
          with the user&apos;s explicit cryptographically signed consent, or where strictly necessary to
          perform core decentralized functions.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 5 Para. 1 lit. c GDPR (Data Minimisation).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          We collect and process the following types of metadata:
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li><strong>Identity Proofs</strong> — cryptographic hashes, Public Keys of the SI Framework</li>
          <li><strong>Proximity Proof Metadata</strong> — timestamp, geographical proximity (never exact coordinates)</li>
          <li><strong>Communication Data</strong> — end-to-end encrypted Nostr Events without content storage</li>
          <li><strong>Wallet & Payment Metadata</strong> — hash references from Bitcoin Lightning Network transactions</li>
          <li><strong>Governance Data</strong> — pseudonymous DAO Votes</li>
        </ul>
      </>
    ),
  },
  {
    title: '5. Use of Data',
    content: (
      <>
        <p>
          Processed data is used exclusively for the functionality, security, and governance of the
          decentralized network.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 6 Para. 1 lit. b and f GDPR (Contract performance and
          legitimate interest: network security and functionality).
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li><strong>Verification of SI Identities</strong> — Zero-Knowledge hash matches</li>
          <li><strong>Interaction within the Codex System</strong> — transparent logging of governance actions</li>
          <li><strong>Processing Peer-to-Peer Payments</strong> — routing via Lightning Network without storage of sensitive payment info</li>
          <li><strong>Ensuring Communication Integrity</strong> — authentication of Nostr events</li>
          <li><strong>DAO Governance Audits</strong> — traceability of voting processes</li>
        </ul>
      </>
    ),
  },
  {
    title: '6. Cookies & Local Storage',
    content: (
      <>
        <p>
          This policy differentiates between: (1) local, user-controlled storage for managing Sovereign
          Identity (SI) and (2) traditional cookies required for the functionality of centralized
          components (Website, Forum). We do not use third-party cookies for tracking purposes.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Section 25 TTDSG (Consent regulation for cookies), Art. 6 Para. 1
          lit. f GDPR (Legitimate interest in functional cookies).
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li><strong>SI Context Cache:</strong> Local storage for managing SI keys and context</li>
          <li><strong>Functional Cookies (Centralized Services):</strong> When commenting, you may opt-in to save your name, email, and website in cookies (validity: 1 year). On login, temporary cookies are set to save your login information (validity: 2 days, &quot;Remember Me&quot;: 2 weeks) and screen options</li>
        </ul>
      </>
    ),
  },
  {
    title: '7. Integration of External Technologies',
    content: (
      <>
        <p>
          The Colabonate ecosystem integrates various decentralized networks for computation,
          communication, and transaction handling.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 28 GDPR (Data processor), where the decentralized nature of
          these protocols redefines the role of the &quot;processor&quot;.
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li><strong>Nostr Relays:</strong> Storage and routing of decentralized events. User data is persisted only in encrypted or hashed form</li>
          <li><strong>Nostr Protocol:</strong> Event-based peer-to-peer communication. Colabonate stores no central communication logs, only metadata for event routing</li>
          <li><strong>Bitcoin Lightning Network (LN):</strong> Transaction data is pseudonymous and is not linked with Colabonate SI identity data to maximize financial privacy</li>
        </ul>
      </>
    ),
  },
  {
    title: '8. Third-Party Disclosure & Data Sovereignty',
    badge: 'User Sovereign',
    content: (
      <>
        <p>
          Colabonate fundamentally does not disclose personal data to third parties, as the architecture
          is designed for data sovereignty. The user is the primary sovereign of their data.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 20 GDPR (Right to data portability), Art. 5 Para. 2 GDPR (Accountability).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Disclosure is only possible if: <strong>legally required</strong> (while adhering to all cryptographic
          guarantees), <strong>legitimized by DAO Governance</strong> (transparent consensus process in the Codex),
          or <strong>explicitly signed by the user</strong> (via the SI Consent Layer for interaction with external services).
        </p>
      </>
    ),
  },
  {
    title: '9. International Data Transfers',
    content: (
      <>
        <p>
          Due to the decentralized Nostr relay infrastructure, processing naturally occurs across global
          jurisdictions. Compliance with GDPR and Swiss FADP is ensured through technical mechanisms,
          regardless of physical location.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 44 ff. GDPR (Guarantees for third country transfers).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Every persistent data record is protected by strong <strong>cryptographic hashes</strong>. The
          architecture replaces trusted third parties with trustworthy cryptographic proofs, representing
          an internationally recognized standard of protection.
        </p>
      </>
    ),
  },
  {
    title: '10. Data Storage & Retention',
    badge: 'Minimal Data by Design',
    content: (
      <>
        <p>
          We store data based on the <strong>&quot;Minimal Data by Design&quot;</strong> principle and retain
          decentralized cryptographic data (hashes, proofs) only as long as necessary for Codex governance
          consensus or service functionality. Different retention periods apply to hybrid services.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 5 Para. 1 lit. e GDPR (Storage limitation), Art. 6 Para. 1 lit.
          f (Legitimate interest in comment history).
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li><strong>Decentralized Data (SI, Codex):</strong> We store practically exclusively encrypted hashes or Zero-Knowledge Proofs. Automatic deletion/fragmentation occurs once a governance audit is complete or the verification hash is no longer needed</li>
          <li><strong>Hybrid Data (Comments, Forum):</strong> If you leave a comment, the comment and its metadata are retained indefinitely so we can recognize and approve follow-up comments automatically. For registered forum users, personal profile data is stored until the user requests deletion</li>
        </ul>
      </>
    ),
  },
  {
    title: '11. User Rights',
    badge: 'GDPR Art. 15–22',
    content: (
      <>
        <p>
          Users have comprehensive rights according to GDPR (access, rectification, erasure, restriction,
          data portability) and FADP. The implementation of these rights differs depending on the use of
          the decentralized SI framework or hybrid services.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 15–22 GDPR (Rights of the data subject).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Decentralized Services (SI/Codex):</strong> Through the Self-managed Identity Layer (Wallet
          interface), the user has the technical tools to erase data (by destroying associated keys) and
          transfer data. Anonymous or pseudonymous use of the modules is possible without mandatory central
          account creation.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Hybrid Services (Forum/Comments):</strong> Users with a central account or commenters can
          request an exported file of the personal data we hold (right of access) and the erasure of all
          stored personal data (right to erasure), unless Colabonate is obligated to retain this data for
          administrative, legal, or security purposes.
        </p>
      </>
    ),
  },
  {
    title: '12. Automated Decisions & Profiling',
    content: (
      <>
        <p>
          Colabonate does not conduct centralized user profiling. Decisions affecting user experience
          (e.g., participation in governance) are based on transparent, algorithmic rules of the Codex.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 22 GDPR (Automated individual decision-making).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Reputation Scores and Governance Weightings are calculated exclusively contextually and
          decentrally via DAO Mechanisms. The algorithm is transparently documented in the Codex,
          ensuring no black-box decisions are made.
        </p>
      </>
    ),
  },
  {
    title: '13. Data Security',
    content: (
      <>
        <p>
          Our security strategy is based on cryptographic integrity and decentralization to protect data
          from unauthorized access, loss, or destruction.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 32 GDPR (Security of processing).
        </p>
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1 ml-2">
          <li><strong>End-to-End Encryption (E2EE)</strong> across all communication channels (Nostr, Audio/Video)</li>
          <li><strong>Multi-layer Hash Verification</strong> by the Codex to secure the authenticity of processed data</li>
          <li><strong>Zero-Knowledge Proofs</strong> for identity confirmation, eliminating the need to disclose identity details</li>
          <li><strong>Audit Trails</strong> optionally anchored via Nostr event references to allow for immutable verification</li>
        </ul>
      </>
    ),
  },
  {
    title: '14. Children\'s Privacy',
    content: (
      <>
        <p>
          Colabonate is exclusively for adults. Use of the platform by persons under 18 years of age is
          prohibited.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 8 Para. 1 GDPR (Conditions applicable to child&apos;s consent).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Wallet creation requires confirmation of legal age. If Colabonate becomes aware of use by
          minors, it reserves the right to suspend the corresponding pseudonymous SI hashes in accordance
          with Codex rules.
        </p>
      </>
    ),
  },
  {
    title: '15. Policy Updates & Governance',
    badge: 'DAO Consensus',
    content: (
      <>
        <p>
          Changes to this Privacy Policy may only be made through a consensus process by the Colabonate
          DAO. Transparency and immutability of every revision are guaranteed.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 5 Para. 1 lit. a and Para. 2 GDPR (Transparency and accountability).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Policy changes are submitted as a proposal in the Codex Governance System and approved by vote.
          Every approved version receives a <strong>version number</strong> and a{' '}
          <strong>cryptographic Hash Identifier (CID)</strong>, guaranteeing the policy&apos;s immutability
          and verifiability.
        </p>
      </>
    ),
  },
  {
    title: '16. Contact & Governance Node',
    content: (
      <>
        <p>
          Since no central &quot;Controller&quot; exists, inquiries are primarily addressed through digital
          and decentralized channels.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 37 ff. GDPR (Data Protection Officer, contact point).
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Data processing inquiries can be submitted via the <strong>Colabonate Ticket System</strong>,
          which forwards them pseudonymously to the responsible Governance Nodes.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Legal inquiries or formal notices should be addressed to the official address of the{' '}
          <strong>DAO Legal Node</strong>, as documented in the Colabonate Codex&apos;s current legal notice.
        </p>
      </>
    ),
  },
  {
    title: '17. Hybrid Services: Website, Newsletter & Forum',
    badge: 'Centralized',
    content: (
      <>
        <p>
          This section describes data processing that occurs outside the decentralized SI/Codex architecture
          on centrally operated components (e.g., the presentation website, the forum, or the newsletter
          tool). In these cases, the Colabonate DAO, through its Legal Node, acts as the data controller
          in the traditional sense.
        </p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          <strong>Legal Basis:</strong> Art. 6 Para. 1 lit. a, b, f GDPR. Processing occurs in traditional
          server environments under separate security measures.
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.0 Newsletter</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          We send the newsletter only with your consent (Art. 6 Para. 1 lit. a GDPR). You give it by ticking
          the newsletter box when you create an account, by switching it on in Settings, or by signing up in
          the website footer. The box is never pre-ticked and your account works without it. We store your
          email address, when and where you gave consent, and which wording you saw, so we can prove it.
          Addresses we have not verified first receive a confirmation link. You can withdraw consent at any
          time with the unsubscribe link in every email or under Settings → Account → Notifications; an
          address that opted out is kept only as a block entry so it is not added again. Deleting your
          account removes your newsletter data.
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.1 Comments</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          When visitors leave comments on our site, we collect the data shown in the comments form, and
          also the visitor&apos;s IP address and browser user agent string to help spam detection. An
          anonymized hash of your email address may be used for the Gravatar service.
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.2 Media</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          If you upload images to the website, you should avoid uploading images with embedded location
          data (EXIF GPS). Visitors to the website can download and extract any location data from these images.
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.3 Embedded Content</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Articles on this site may include embedded content (e.g., videos, images, articles) from other
          websites. Embedded content behaves in the exact same way as if the visitor has visited the other
          website. These external websites may collect data about you, use cookies, embed additional
          third-party tracking, and monitor your interaction with that embedded content.
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.4 Forum Registration</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          For users who register on our website, we store the personal information they provide in their
          user profile (username, email, password hash). All registered users can see, edit, or delete
          their personal information at any time (except they cannot change their username).
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.5 Password Reset</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          If you request a password reset, your IP address will be included in the reset email. The storage
          of the IP address serves as a necessary security audit trail.
        </p>

        <p className="text-[var(--theme-text)] text-sm font-medium">17.6 Data Transmission</p>
        <p className="text-[var(--theme-text-muted)] text-xs">
          Visitor comments are checked through an automated spam detection service, involving the
          transmission of comment content and metadata.
        </p>
      </>
    ),
  },
]

export function Privacy() {
  return (
    <>
      <Seo
        title="Privacy Policy"
        description="How Colabonate handles personal data: GDPR and Swiss FADP compliant, data minimized by design, Nostr-based identity and no custodial data harvesting."
        path="/legal/privacy"
      />
    <PageContainer size="standard" spacing="lg">
      <PageHeader
        icon={<Shield size={20} />}
        title="Privacy Policy"
        subtitle="How Colabonate handles your personal data"
      />

      <Box className="flex items-center gap-2 mb-6">
        <Chip
          label="Effective: October 16, 2025"
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
          label="Version 1.0"
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

      <Box className="flex flex-col gap-3">
        {PRIVACY_SECTIONS.map((section) => (
          <LegalSectionAccordion key={section.title} section={section} />
        ))}
      </Box>
    </PageContainer>
    </>
  )
}
