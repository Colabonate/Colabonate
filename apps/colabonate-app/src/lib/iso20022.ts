import type { EscrowTradeState, EscrowTrade } from './escrow-trade'

// ADR-360: ISO 20022 interop surface — conceptual state correspondence and
// generation helpers. The mapping is a *conceptual correspondence* (paper §4.4),
// NOT a normative equivalence: the canister contains no ISO 20022 code, and no
// bank settlement occurs. Every generated artifact carries that disclosure.

export interface IsoStatusRow {
  state: EscrowTradeState
  isoCode: string | null // null = gap marker (no normative analogue)
  economic: string
  note: string
  isGap: boolean
}

export const ISO_STATUS_MAP: Record<EscrowTradeState, IsoStatusRow> = {
  PENDING_FUNDING: {
    state: 'PENDING_FUNDING',
    isoCode: 'PDNG',
    economic: 'Trade opened, deposit pending',
    note: 'Triggered by a pacs.008 credit transfer; the canister awaits the funding UTXO.',
    isGap: false,
  },
  FUNDED: {
    state: 'FUNDED',
    isoCode: 'ACSP',
    economic: 'Deposit confirmed, escrow active',
    note: 'Economically close to ACSP/ACSC on the debtor side.',
    isGap: false,
  },
  RELEASED: {
    state: 'RELEASED',
    isoCode: 'ACSC',
    economic: 'Consideration delivered, payout to the seller',
    note: 'Economically ACSC on the creditor side.',
    isGap: false,
  },
  DISPUTED: {
    state: 'DISPUTED',
    isoCode: null,
    economic: 'Dispute, regular release locked',
    note: 'No direct normative analogue — the standard has no arbitration state. This gap is what the stack adds.',
    isGap: true,
  },
  REFUNDED: {
    state: 'REFUNDED',
    isoCode: 'RJCT',
    economic: 'Timeout- or verdict-driven repayment',
    note: 'Economically related to a chargeback / RJCT direction.',
    isGap: false,
  },
  DISPUTE_SETTLED: {
    state: 'DISPUTE_SETTLED',
    isoCode: null,
    economic: 'Split settlement after a verdict',
    note: 'No analogue — a percentage split settlement has no ISO equivalent.',
    isGap: true,
  },
}

export interface Pacs008Row {
  xmlPath: string
  candidField: string
  conversion: string
}

export const PACS008_MAPPING: Pacs008Row[] = [
  { xmlPath: 'CdtTrfTxInf/PmtId/EndToEndId', candidField: 'trade reference / trade_id', conversion: 'unique transaction id' },
  { xmlPath: "CdtTrfTxInf/Dbtr/Id/OrgId/Othr[Prtry='XID']/Id", candidField: 'buyer_pubkey', conversion: '32-byte x-only Nostr/XID key (hex)' },
  { xmlPath: "CdtTrfTxInf/Cdtr/Id/OrgId/Othr[Prtry='XID']/Id", candidField: 'seller_pubkey', conversion: 'as above' },
  { xmlPath: 'CdtTrfTxInf/DbtrAcct/Id/Othr/Id', candidField: 'buyer_refund_address', conversion: 'native SegWit address' },
  { xmlPath: 'CdtTrfTxInf/CdtrAcct/Id/Othr/Id', candidField: 'seller_payout_address', conversion: 'native SegWit address' },
  { xmlPath: 'CdtTrfTxInf/IntrBkSttlmAmt', candidField: 'expected_amount_sats', conversion: 'amount in satoshis (u64)' },
  { xmlPath: 'CdtTrfTxInf/RmtInf/Ustrd', candidField: 'milestone_bps', conversion: 'milestone schedule, e.g. MS:2500,5000,2500' },
  { xmlPath: 'CdtTrfTxInf/SttlmTmReq/TillTm', candidField: 'timeout_at', conversion: 'expiry in nanoseconds (u64)' },
]

// Max35Text limit (ADR-360 D4): a full 32-byte XID does not fit any standardised
// encoding of Othr.Id. Only a 4-byte recognition prefix is carried; the label is
// "hint, not proof" — full 32-byte comparison happens out of band.
export function xidRecognitionPrefix(pubkeyHex: string): string {
  return `ur:xid/${pubkeyHex.slice(0, 8)}`
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// pacs.002 generation (ADR-360 D5). A best-effort, well-formed status report for
// reconciliation. Full XSD validation and the normative mapping belong to the
// adapter (FU-595/FU-630) — this carries the conceptual correspondence, not a
// claim of bank settlement.
export function generatePacs002Xml(trade: Pick<EscrowTrade, 'canisterTradeId' | 'expectedAmountSats'>, state: EscrowTradeState, generatedAt: string): string {
  const row = ISO_STATUS_MAP[state]
  const endToEndId = trade.canisterTradeId
  const statusBlock = row.isoCode
    ? `    <TxSts>${row.isoCode}</TxSts>`
    : `    <StsRsnInf>\n      <AddtlInf>${esc(row.note)}</AddtlInf>\n    </StsRsnInf>`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Colabonate adapter output — complementary layer, NOT a bank settlement message. -->',
    '<!-- No ISO 20022 code exists in the canister; statuses below are conceptual correspondences. -->',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.12">',
    '  <FIToFIPmtStsRpt>',
    '    <GrpHdr>',
    `      <MsgId>${esc(`colabonate-${endToEndId}-${Date.now()}`)}</MsgId>`,
    `      <CreDtTm>${esc(generatedAt)}</CreDtTm>`,
    '    </GrpHdr>',
    '    <OrgnlGrpInfAndSts>',
    `      <OrgnlMsgId>${esc(endToEndId)}</OrgnlMsgId>`,
    '      <OrgnlMsgNmId>pacs.008</OrgnlMsgNmId>',
    '    </OrgnlGrpInfAndSts>',
    '    <TxInfAndSts>',
    `      <OrgnlEndToEndId>${esc(endToEndId)}</OrgnlEndToEndId>`,
    statusBlock,
    '    </TxInfAndSts>',
    '  </FIToFIPmtStsRpt>',
    '</Document>',
    '',
  ].join('\n')
}
