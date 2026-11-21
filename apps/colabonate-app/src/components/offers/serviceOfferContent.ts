// ADR-368 D8: single source of truth for the SERVICE-offer creation copy that
// was inlined in CreateOfferPage's SERVICE branch. Mirrors the ADR-366 D6
// OFFER_TYPE_LABELS pattern (one canonical module, per-surface rendering).
// Consumers: CreateOfferPage's SERVICE branch and any surface running the
// offer form in SERVICE mode. Rendered text must stay byte-identical when
// replacing inlined strings with these constants.
export const SERVICE_OFFER_CONTENT = {
  // Step / header intro ("Offer a Service")
  introTitle: 'Offer a Service',
  introSubtitle: 'Full creation for your service – detailed description, portfolio images, milestones, and scheduling.',
  introHelpText: 'Clients pay you directly — no platform in the middle. You accept before work begins, so nothing is charged until you\'re ready.',

  // Context-card descriptions (Private ↔ Corporate)
  contextPrivateDescription: 'Offer services independently without a company profile.',
  contextCorporateDescription: 'Offer services through your company catalog.',

  // Content step — field label, placeholder, description helper
  titleLabel: 'Service title',
  titlePlaceholder: 'e.g. Logo Design for your Brand',
  descriptionHelper: 'Describe what you offer, your process, and what the client receives…',

  // Price entry + preview label
  priceLabel: 'Rate',

  // Logistics step — remote delivery toggle
  remoteToggleLabel: 'Remote / Digital Service',
  remoteToggleHelper: 'Enable for services delivered online (hides city/region)',
} as const
