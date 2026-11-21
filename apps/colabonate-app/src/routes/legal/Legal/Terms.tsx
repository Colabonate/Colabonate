import { Box, Chip } from '@mui/material'
import { ScrollText } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../../components/PageHeader'
import { Seo } from '../../../components/Seo'
import { LegalSectionAccordion } from '../../../components/ui/LegalSectionAccordion'
import type { LegalSection } from '../../../components/ui/LegalSectionAccordion'

const PROHIBITED_USES = [
  'In any manner that violates any applicable federal, state, local or international law or regulation (including, without limitation, any laws regarding the export of data or software to and from the US or other countries)',
  'For any purpose that violates these Terms or any other terms or policies provided in connection with the Website, particularly the Colabonate Codex Principles',
  'To gain unauthorized access to, interfere with, damage or disrupt any parts of the Website, the server(s) on which the Website is stored, or any server, computer or database connected to the Website',
  'In any way that could restrict or interfere with anyone from fully enjoying the Website or harm the DAO Legal Node or any user of the Website or expose them to liability',
  'To intimidate, or harass any person or entity, or falsely state, impersonate or otherwise misrepresent you or your affiliation with any person or entity',
  'To damage, disable, disrupt, overburden or impair the functionality of the Website in any manner',
  'To distribute or post spam, unsolicited or bulk electronic communications, advertising, solicitations, promotional materials, chain letters, or pyramid schemes',
  'To upload, post, transmit, distribute or otherwise introduce any viruses, trojan horses, worms, logic bombs, malware, ransomware or spyware or any other computer code designed to interrupt, destroy or limit the functionality of any computer software or hardware',
  'To export or re-export any applications, code or tools developed by and proprietary to the Colabonate network, except as in strict compliance with the export control laws of any relevant jurisdictions',
  'To use any robot, spider, crawler, scraper or other automated means not authorized by us to access the Website or to extract data or information from the Website',
  'To commercialize any application, code or any information or software associated with such application and/or the Website, without the prior consent of the DAO Legal Node',
  'To upload, post, transmit, distribute, store or otherwise make publicly available on the Website any personal data of any third party without the person\'s prior explicit consent',
  'To harvest or otherwise collect information or data about any person without their consent or use automated scripts to collect information from or otherwise interact with the Website',
  'To upload, post, transmit, distribute, store or otherwise make available content that would constitute, encourage or provide instructions for a criminal offense or, in the sole judgment of the DAO Legal Node, is objectionable or misleading',
  'To copy, modify, reverse engineer or attempt to extract the source code, distribute, sell, or lease any part of the Website',
  'To circumvent or attempt to circumvent any filtering, security measures or other features designed to protect the Website, or third parties',
  'To attack the Website via a denial-of-service attack or a distributed denial-of-service attack',
  'To infringe upon or violate the rights of the DAO Legal Node, any person or third parties',
  'To facilitate or assist another person to do any of the above acts',
]

const TERMS_SECTIONS: LegalSection[] = [
  {
    title: '1. Introduction',
    content: (
      <>
        <p>
          These Terms of Use (&quot;Terms&quot;) are entered into by and between you and the Colabonate
          DAO Legal Node, acting on behalf of the Colabonate Decentralized Autonomous Organization
          (&quot;DAO Legal Node&quot;, &quot;we&quot;, &quot;us&quot;). These Terms govern your access to
          and use of our current and future centrally hosted interfaces, including presentation websites,
          forums, newsletters, and supporting applications operated under the direction of the DAO Legal
          Node (collectively, the &quot;Website&quot;).
        </p>
        <p>
          By using the Website, accessing content, or subscribing to centralized information updates, by
          submission of an application idea, and/or by contacting us, you acknowledge that you have read
          and understood these Terms and agree to be bound by them and to comply with these Terms.
        </p>
        <p>
          If you do not agree with these Terms, you must not use or access the Website.
        </p>
        <p>
          By giving your consent, you confirm that your level of English is sufficient to understand the
          meaning of the terms contained in the English version of the Terms as well as all the commitments,
          warranties, waivers, and obligations contained in the English version of the Terms.
        </p>
      </>
    ),
  },
  {
    title: '2. Changes To These Terms (DAO Governance)',
    badge: 'DAO Governed',
    content: (
      <>
        <p>
          We may make changes to these Terms from time to time. Any modifications, additions, or deletions
          will be effective immediately upon posting. For the primary, decentralized Colabonate Code and
          Governance principles (<strong>Codex</strong>), changes are managed by the DAO and versioned on
          decentralized infrastructure, as detailed in our Privacy Policy. For these centrally managed
          Terms, your continued use of the Website after any such changes shall constitute your acceptance
          of such changes.
        </p>
        <p>
          You are responsible for verifying regularly these Terms in their current and in effect version
          from time to time.
        </p>
      </>
    ),
  },
  {
    title: '3. The Website (Hybrid Access & Sovereign Identity)',
    content: (
      <>
        <p>
          The DAO Legal Node grants you a limited, non-exclusive, non-transferable, non-sublicensable,
          and revocable license to use the Website and its content for your personal, non-commercial use,
          subject to your compliance with these Terms.
        </p>
        <p>
          To access the central Websites or some of the resources it offers (e.g., forum registration),
          you may be asked to provide certain registration details or other information. It is a condition
          of your use of the Website that all the information you provide on the Website is current,
          complete, and accurate. You agree that all information you provide to register using this Website
          or otherwise is governed by our Privacy Policy, and you consent to all actions we take with
          respect to your information consistent with our Privacy Policy.
        </p>
        <p>
          <strong>Note on Sovereign Identity (SI):</strong> Accessing decentralized modules via the Website
          utilizes the SI Framework. In this case, your identity is self-sovereign, and the terms of
          interaction are primarily governed by the immutable Codex governance rules.
        </p>
        <p>
          You agree you are responsible for obtaining and maintaining all connectivity, computer software,
          hardware, and other equipment needed for access to and use of the Website and all charges related
          to the same. You agree that all persons who access the Website through your internet connection
          are aware of these Terms of Use and comply with them.
        </p>
      </>
    ),
  },
  {
    title: '4. Privacy',
    content: (
      <p>
        In order to operate and provide the Website and its central services, we collect certain information
        about you. We use and protect that information as described in our <strong>Privacy Policy</strong>,
        which details the dual nature of data handling (decentralized vs. hybrid). You acknowledge and agree
        that your use of the Website is subject to our Privacy Policy and understand that it identifies how
        the DAO Legal Node collects, stores, processes, and uses certain information within the hybrid context.
      </p>
    ),
  },
  {
    title: '5. Prohibited Uses',
    badge: '19 restrictions',
    content: (
      <>
        <p>
          You may use the Website only for lawful purposes and in accordance with these Terms. In particular,
          you agree <strong>not</strong> to use (or attempt to use) the Website:
        </p>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          {PROHIBITED_USES.map((use, i) => (
            <li key={i}>{use}</li>
          ))}
        </ol>
        <p className="mt-3">
          You also agree that if you learn of any unauthorized or unacceptable use of the Website, by any
          person or entity, you will promptly notify the DAO Legal Node.
        </p>
      </>
    ),
  },
  {
    title: '6. Content',
    content: (
      <>
        <p>
          You understand that any and all content available on the Website is made available for informational
          purposes only and should not be contractual or binding in any way for the DAO Legal Node. No
          information published on the Website constitutes professional or legal advice, a solicitation,
          an offer, or a recommendation to effect any transactions, or to conclude any legal act of any
          kind whatsoever.
        </p>
        <p>
          The Website may include content provided by third parties, including information provided by other
          users, bloggers, third-party licensors and/or reporting services. All statements and/or opinions
          expressed in these materials, and all articles and responses to questions and other content, other
          than the information provided by the DAO Legal Node, are solely the opinions and the responsibility
          of the person or entity providing those materials.
        </p>
        <p>
          Any reliance you place on any information or content on the Website is strictly at your own risk.
          Please seek the advice of professionals, as appropriate, regarding the evaluation of any specific
          information, opinion, advice, or other content.
        </p>
      </>
    ),
  },
  {
    title: '7. Intellectual Property Rights',
    content: (
      <>
        <p>
          Intellectual property rights and all other proprietary rights in relation to the Website (including
          but not limited to all content, software, mobile software, algorithms, code, audio, video, text,
          animations, files, photographs, designs, graphics, layouts, images, video, information and their
          selection and arrangement) are the exclusive property of the DAO Legal Node or its licensors
          (including the underlying Codex and SI architecture) and are protected by copyright, trademark,
          patent, trade secret, and other intellectual property or proprietary rights laws.
        </p>
        <p>
          Access to the Website does not confer and shall not be considered as conferring upon anyone any
          license under any of our or any third party&apos;s intellectual property rights. Any use of the
          Website, including copying or storing it or them in whole or part, other than for your own
          personal, non-commercial use, is prohibited without prior consent of the DAO Legal Node.
        </p>
        <p>
          All intellectual property rights in the Website not expressly granted herein are reserved to the
          DAO Legal Node. All copyright and other proprietary notices shall be retained on all reproductions.
        </p>
        <p>
          If you provide us with any feedback, suggestions, or comments regarding the Website
          (&quot;Feedback&quot;), you automatically assign this Feedback to the Colabonate DAO Legal Node
          without restriction or payment to you.
        </p>
      </>
    ),
  },
  {
    title: '8. Trademarks',
    content: (
      <p>
        The Colabonate names and logos and all related product and service names, design marks and slogans
        are the trademarks or service marks of the DAO Legal Node or its licensors. Access to the Website
        does not authorize anyone to use any name, logo, or mark in any manner whatsoever without the prior
        written permission of the DAO Legal Node.
      </p>
    ),
  },
  {
    title: '9. Reservation of Rights',
    content: (
      <>
        <p>
          The DAO Legal Node may block, terminate, or suspend your ability to use or access the Website,
          in whole or in part, without notice and at all times, at the sole discretion of the DAO Legal
          Node, as well as close or interrupt the Website.
        </p>
        <p>
          The DAO Legal Node reserves the right to terminate your right to access and use the Website if
          you violate these Terms or any other terms, laws, or policies referenced herein, or if you
          otherwise create risk or possible legal exposure for the DAO Legal Node.
        </p>
        <p>
          The DAO Legal Node reserves the right to initiate legal proceedings against any person for
          fraudulent use of the Website and any other unlawful acts or acts or omissions in breach of
          these Terms.
        </p>
      </>
    ),
  },
  {
    title: '10. Geographic Restrictions',
    content: (
      <>
        <p>
          The Website may not be available in all territories and jurisdictions. Access to the Website
          may not be legal by certain persons or in certain countries.
        </p>
        <p>
          We may restrict or prohibit use of all or a portion of the Website in certain territories and
          jurisdictions. If you access the Website, you do so on your own initiative and are responsible
          for compliance with all local laws and regulations.
        </p>
      </>
    ),
  },
  {
    title: '11. Disclaimer of Warranties',
    badge: 'Important',
    content: (
      <>
        <p>
          YOU EXPRESSLY ACKNOWLEDGE AND AGREE THAT YOUR ACCESS TO AND USE OF THE WEBSITE IS AT YOUR OWN RISK.
        </p>
        <p>
          TO THE EXTENT NOT PROHIBITED BY LAW, THE DAO LEGAL NODE: (A) PROVIDES THE SERVICES &quot;AS
          IS&quot;, &quot;WITH ALL FAULTS&quot; AND &quot;AS AVAILABLE&quot;, (B) MAKES NO REPRESENTATIONS
          OR WARRANTIES OR CONDITIONS WHETHER EXPRESS OR IMPLIED (E.G. WARRANTY OF MERCHANTABILITY,
          SATISFACTORY QUALITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT), AND (C) DOES NOT
          GUARANTEE THAT THE WEBSITE WILL BE UNINTERRUPTED, ERROR-FREE OR FREE OF HARMFUL COMPONENTS, OR
          THAT THE CONTENT WILL BE SECURE OR NOT OTHERWISE LOST OR DAMAGED.
        </p>
        <p>
          IF YOU ARE DISSATISFIED WITH ANY PORTION OF THE WEBSITE OR WITH THESE TERMS, YOUR SOLE AND
          EXCLUSIVE REMEDY IS TO DISCONTINUE USE OF THE SERVICES.
        </p>
      </>
    ),
  },
  {
    title: '12. Limitation of Liability',
    badge: 'CHF 100 cap',
    content: (
      <>
        <p>
          TO THE EXTENT NOT PROHIBITED BY LAW, IN NO EVENT WILL THE DAO LEGAL NODE, AND ITS AFFILIATES
          LICENSORS AND SERVICE PROVIDERS, AND THEIR RESPECTIVE DIRECTORS, OFFICERS, EMPLOYEES AND AGENTS,
          SHALL HAVE NO LIABILITY FOR ANY INDIRECT, INCIDENTAL, SPECIAL, PUNITIVE, COVER OR CONSEQUENTIAL
          DAMAGES (INCLUDING, WITHOUT LIMITATION, DAMAGES FOR LOST PROFITS, REVENUE, GOODWILL, USE OR
          CONTENT) HOWEVER CAUSED, UNDER ANY THEORY OF LIABILITY, INCLUDING, WITHOUT LIMITATION, CONTRACT,
          TORT, BUSINESS INTERRUPTION, LOSS OF OPPORTUNITY, WARRANTY, NEGLIGENCE OR OTHERWISE, EVEN IF WE
          HAVE BEEN ADVISED AS TO THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          THE AGGREGATE LIABILITY OF THE DAO LEGAL NODE, AND ITS AFFILIATES LICENSORS AND SERVICE PROVIDERS,
          AND THEIR RESPECTIVE DIRECTORS, OFFICERS, EMPLOYEES AND AGENTS, RELATING TO THE WEBSITE WILL BE
          LIMITED TO <strong>ONE HUNDRED SWISS FRANCS (CHF 100.)</strong>
        </p>
        <p>
          THE LIMITATIONS AND EXCLUSIONS ALSO APPLY IF THIS REMEDY DOES NOT FULLY COMPENSATE YOU FOR ANY
          LOSSES OR FAILS OF ITS ESSENTIAL PURPOSE.
        </p>
        <p>
          THE LIMITATION OR EXCLUSION OF INCIDENTAL, CONSEQUENTIAL OR OTHER DAMAGES WILL NOT APPLY TO YOU
          TO THE EXTENT PROHIBITED BY APPLICABLE LAW.
        </p>
        <p>
          IN COUNTRIES WHERE THE ABOVE TYPES OF EXCLUSIONS AND LIMITATIONS ARE NOT ALLOWED, WE ARE
          RESPONSIBLE TO YOU ONLY FOR LOSSES AND DAMAGES THAT ARE A REASONABLY FORESEEABLE RESULT OF OUR
          FAILURE TO USE REASONABLE SKILL AND CARE OR OUR BREACH OF THESE TERMS WITH YOU.
        </p>
      </>
    ),
  },
  {
    title: '13. Force Majeure',
    content: (
      <p>
        The DAO Legal Node cannot accept responsibility for any damage, loss, delay, or inconvenience
        caused by circumstances beyond our reasonable control. Such circumstances include but are not
        limited to war, threat of war, riots, civil strife, or terrorist activity, industrial disputes,
        natural or nuclear disasters, fire, airport closures, bad weather conditions, interruption or
        failure of a utility service or the acts of any local or national government.
      </p>
    ),
  },
  {
    title: '14. Indemnification',
    content: (
      <p>
        To the extent not prohibited by law, you agree to defend, indemnify and hold harmless the DAO
        Legal Node and its affiliates licensors and service providers, and their respective directors,
        officers, employees and agents from and against all third party claims, damages, costs, liabilities,
        judgments, awards, losses, costs, and expenses and fees arising out of or related to your use of
        the Website or your violation of these Terms, any applicable law or any rights of any third party.
      </p>
    ),
  },
  {
    title: '15. Links',
    content: (
      <>
        <p>
          The Website may contain links which direct you to websites provided by third parties. These links
          are provided only for your convenience.
        </p>
        <p>
          We have no control over those third-party websites, so we do not accept any responsibility for
          them or any liability for any loss or damage that may arise from your use of them. You agree that
          accessing any of the third-party websites linked to this Website is done entirely at your own risk
          and subject to the terms and conditions for such websites.
        </p>
      </>
    ),
  },
  {
    title: '16. Entire Agreement & Severability',
    content: (
      <p>
        These Terms and the Privacy Policy, subject to any amendments or modifications made by the DAO
        Legal Node from time to time, shall constitute the entire agreement between you and the DAO Legal
        Node with respect to the use of the Website. If any provision of these Terms or the Privacy Policy
        is found to be invalid by a court or competent jurisdiction, that provision only will be limited
        to the minimum extent necessary and the remaining provisions will remain in full force and effect.
      </p>
    ),
  },
  {
    title: '17. No Waiver',
    content: (
      <p>
        The DAO Legal Node&apos;s failure to enforce a provision of these Terms does not constitute a
        waiver of its right to do so in the future with respect to that provision, any other provision,
        or these Terms as a whole.
      </p>
    ),
  },
  {
    title: '18. Assignment',
    content: (
      <>
        <p>
          You may not assign any of your rights, licenses, or obligations under these Terms without the
          DAO Legal Node&apos;s prior written consent. Any such attempt at assignment by you shall be void.
        </p>
        <p>
          The DAO Legal Node may assign its rights, licenses, and obligations under these Terms without
          limitation and without prior consent.
        </p>
      </>
    ),
  },
  {
    title: '19. English Version',
    content: (
      <p>
        If there is an inconsistency between any of the provisions of this English language version and
        a translated version of these Terms, the provisions of this English language version shall prevail.
        Any translated versions of the Terms or the Privacy Policy are provided only for your convenience.
      </p>
    ),
  },
  {
    title: '20. Changes to the Website',
    content: (
      <>
        <p>
          The DAO Legal Node reserves the right to change, suspend, remove, discontinue or disable access
          to the Website or particular portions thereof, at any time and without notice.
        </p>
        <p>
          In no event will the DAO Legal Node be liable for the removal of or disabling of access to any
          portion or feature of the Website.
        </p>
      </>
    ),
  },
  {
    title: '21. Governing Law & Jurisdiction',
    badge: 'Swiss Law',
    content: (
      <>
        <p>
          You understand and agree that all matters relating to the Website and these Terms shall be
          governed by the laws of <strong>Switzerland</strong>, to the exclusion of the rules on conflicts
          of laws. We both agree that any claim or dispute regarding these Terms or in relation to them
          shall (including for non-contractual disputes or claims and their interpretation) be subject to
          the exclusive jurisdiction of the <strong>Courts of Zurich, Switzerland</strong>, subject to an
          appeal at the Swiss Federal Court.
        </p>
        <p>
          You agree that any dispute with us shall only be resolved on an individual basis and shall not
          be brought as a class action or any other representative proceeding. You agree you may not bring
          a claim as a class or representative action or on behalf of any other person or persons.
        </p>
        <p>
          In case of dispute, you shall maintain the confidentiality of any proceedings, including but not
          limited to, any and all information gathered, prepared, and presented for purposes of the
          litigation or related to the dispute(s) therein.
        </p>
      </>
    ),
  },
  {
    title: '22. Contact',
    content: (
      <>
        <p>
          This Website is operated under the direction of the Colabonate DAO Legal Node.
        </p>
        <p>
          Any feedback, comments, requests, and other communications relating to the Website should be
          directed to: <strong>info@colabonate.com</strong>
        </p>
      </>
    ),
  },
]

export function Terms() {
  return (
    <>
      <Seo
        title="Terms of Use"
        description="Terms of Use for Colabonate: the rules governing the peer-to-peer marketplace, prohibited uses, escrow transactions and community-governed dispute resolution."
        path="/legal/terms"
      />
    <PageContainer size="standard" spacing="lg">
      <PageHeader
        icon={<ScrollText size={20} />}
        title="Terms of Use"
        subtitle="Terms governing your use of Colabonate"
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
      </Box>

      <Box className="flex flex-col gap-3">
        {TERMS_SECTIONS.map((section) => (
          <LegalSectionAccordion key={section.title} section={section} />
        ))}
      </Box>
    </PageContainer>
    </>
  )
}
