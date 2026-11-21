// @ds/ui – Zentraler Export aller Komponenten
// Standard-Komponenten (Button, Input, Typography) → direkt aus @mui/material importieren

// Page Layout System
export { PageContainer } from './page-container';
export { PageSection } from './page-container';
export { PageHeader } from './page-container';
export { PageCard } from './page-container';
export type { PageContainerProps, PageSectionProps, PageHeaderProps, PageCardProps, PageSize, PageVariant } from './page-container';

export { Logo, AnimatedLogo } from './logo/logo';
export type { LogoProps, LogoBrand, LogoTheme } from './logo/logo.types';
export { LogoIcon, AnimatedLogoIcon } from './logo/logo-svgs';

export { MainMenu } from './main-menu/main-menu';
export type { MainMenuProps, MainMenuVariant, MainMenuTab, MainMenuMode, MainMenuTheme, MainMenuLevel, MainMenuSubItem } from './main-menu/main-menu.types';

export { NavButton } from './nav-button/nav-button';
export type { NavButtonProps } from './nav-button/nav-button.types';

export { default as colabonateTheme, createColabonateTheme } from './theme';

export { ReputationBadge } from './reputation-badge/reputation-badge';
export type { ReputationBadgeProps, ReputationBadgeVariant, ReputationBadgeSize, IdentityLevelDisplay } from './reputation-badge/reputation-badge.types';

export { ListHeader } from './list-header/list-header';
export type { ListHeaderProps, ListHeaderTab, ListHeaderAction } from './list-header/list-header.types';

export { navigationConfig, flattenRoutes, getV1Routes, getTabRoutes, getSubItems, getRouteMeta } from './navigation/navigation.config';
export type { NavRoute, NavConfig, NavSubItem, NavPhase } from './navigation/navigation.types';

export { SectionMenu } from './section-menu/section-menu';
export type { SectionMenuProps, SectionMenuMode } from './section-menu/section-menu.types';

export { FloatingActionButton } from './floating-add-button/floating-add-button';
export type { FloatingActionButtonProps, FloatingActionButtonTheme, FloatingActionButtonSize } from './floating-add-button/floating-add-button.types';

/** @deprecated Use FloatingActionButton instead */
export { FloatingActionButton as FloatingAddButton } from './floating-add-button/floating-add-button';
/** @deprecated Use FloatingActionButtonProps instead */
export type { FloatingActionButtonProps as FloatingAddButtonProps } from './floating-add-button/floating-add-button.types';

export { SliderList, CARD_THEME } from './slider-list/slider-list';
export type { SliderListProps, SliderTab, SliderSegment, SliderListItem, SliderListVariant, SliderItemEntityType, FilterChipDef, FilterChipOption } from './slider-list/slider-list.types';

export { CardImage } from './card-image/card-image';
export type { CardImageProps } from './card-image/card-image.types';

export { AgentCardBackground, AgentCenterBadge, AGENT_THEME } from './agent-card-theme/agent-card-theme';


export { KPIStrip } from './kpi-strip/kpi-strip';
export type { KPIStripProps, KPIItem } from './kpi-strip/kpi-strip.types';

export { TabBar } from './tab-bar/tab-bar';
export type { TabBarProps, TabItem } from './tab-bar/tab-bar.types';

export { ProviderCard } from './provider-card/provider-card';
export type { ProviderCardProps } from './provider-card/provider-card.types';

export { TicketTile } from './ticket-tile/ticket-tile';
export type { TicketTileProps, TicketTileVariant, TicketData } from './ticket-tile/ticket-tile.types';

export { PartnerAvatar } from './partner-avatar/partner-avatar';
export type { PartnerAvatarProps } from './partner-avatar/partner-avatar.types';

export { UserSection } from './user-section/user-section';
export type { UserSectionProps, ActionItem } from './user-section/user-section.types';

export { FeatureCard } from './feature-card/feature-card';
export type { FeatureCardProps } from './feature-card/feature-card.types';

export { FeatureGrid } from './feature-grid/feature-grid';
export type { FeatureGridProps } from './feature-grid/feature-grid.types';

// Modal System
export { Modal } from './modal/modal';
export { ModalHeader } from './modal/modal-header';
export { ModalContent } from './modal/modal-content';
export { ModalActions } from './modal/modal-actions';
export type {
  ModalProps,
  ModalHeaderProps,
  ModalContentProps,
  ModalActionsProps,
  ModalSize,
  UseModalReturn,
  ModalConfig,
  ModalProviderProps,
} from './modal/modal.types';

export { PollingBar } from './polling-bar/polling-bar'
export type { PollingBarProps, PollingBarStatus } from './polling-bar/polling-bar.types'

// Notification System
export { NotificationDrawer } from './notification-drawer/notification-drawer';
export type { NotificationDrawerProps, Notification, NotificationGroup, NotificationFilter } from './notification-drawer/notification-drawer.types';

// Chat System (NIP-17)
export { Chat, ChatWindow, ChatInput, ChatBubble } from './chat';
export type { ChatProps, ChatMessage, ChatInputProps, ChatBubbleProps } from './chat/chat.types';

// Chat Room (NIP-28 public channel)
export { ChatRoom } from './chat-room';
export type { ChatRoomProps, ChatRoomMessage, ChatRoomProfile } from './chat-room';

// Footer
export { Footer } from './footer/footer';
export type { FooterProps, FooterVariant, NewsletterStatus, FooterNewsletterState } from './footer/footer.types';

// Arbitration Council
export { CodexBanner } from './codex-banner/codex-banner';
export type { CodexBannerProps } from './codex-banner/codex-banner';
export { DisputeBanner } from './codex-banner/dispute-banner';
export type { DisputeBannerProps } from './codex-banner/dispute-banner';
export { AppealBanner } from './codex-banner/appeal-banner';
export type { AppealBannerProps } from './codex-banner/appeal-banner';

// Form System
export { FormStepper } from './form-stepper';
export type { FormStepperProps, FormStep } from './form-stepper';

// Display
export { OpeningHours } from './opening-hours/opening-hours';
export type { OpeningHoursProps, DayKey, DayHours, OpeningHoursData } from './opening-hours/opening-hours.types';

// Entity profile (ADR-367 D1)
export { EntityProfileHeader } from './entity-profile-header/entity-profile-header';
export type { EntityProfileHeaderProps, EntityProfileHeaderVariant } from './entity-profile-header/entity-profile-header.types';
export { AddressBlock } from './address-block/address-block';
export type { AddressBlockProps } from './address-block/address-block.types';
export { BusinessFieldsChips } from './business-fields-chips/business-fields-chips';
export type { BusinessFieldsChipsProps, BusinessField } from './business-fields-chips/business-fields-chips.types';
export { TermsBlock } from './terms-block/terms-block';
export type { TermsBlockProps } from './terms-block/terms-block.types';
