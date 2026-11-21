import { useState } from 'react';
import { useTheme } from '@ds/utils';
import { Typography, Button, ToggleButton, ToggleButtonGroup, Box, Paper, Chip, FormControlLabel, Switch } from '@mui/material';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import LayersIcon from '@mui/icons-material/Layers';
import {
  Logo,
  MainMenu,
  ReputationBadge,
  SectionMenu,
  NavButton,
  ListHeader,
  KPIStrip,
  TicketTile,
  PartnerAvatar,
  CardImage,
  CARD_THEME,
  getSubItems,
  navigationConfig,
} from '@ds/ui';
import type {
  LogoBrand,
  MainMenuVariant,
  MainMenuMode,
  MainMenuTheme,
  MainMenuTab,
  MainMenuLevel,
  MainMenuSubItem,
  TicketData,
  KPIItem,
} from '@ds/ui';

// ─── Tab Icons ─────────────────────────────────────────────────────────────────

function IconBuy({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 4H4V6H20V4ZM21 14V12L20 7H4L3 12V14H4V20H14V14H18V20H20V14H21ZM12 18H6V14H12V18Z" fill={color} />
    </svg>
  );
}

function IconSell({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04ZM17 13H14V16H10V13H7L12 8L17 13Z" fill={color} />
    </svg>
  );
}

function IconCoOp({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 11C17.66 11 18.99 9.66 18.99 8C18.99 6.34 17.66 5 16 5C14.34 5 13 6.34 13 8C13 9.66 14.34 11 16 11ZM8 11C9.66 11 10.99 9.66 10.99 8C10.99 6.34 9.66 5 8 5C6.34 5 5 6.34 5 8C5 9.66 6.34 11 8 11ZM8 13C5.67 13 1 14.17 1 16.5V19H15V16.5C15 14.17 10.33 13 8 13ZM16 13C15.71 13 15.38 13.02 15.03 13.05C16.19 13.89 17 15.02 17 16.5V19H23V16.5C23 14.17 18.33 13 16 13Z" fill={color} />
    </svg>
  );
}

function IconWallet({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 18V19C21 20.1 20.1 21 19 21H5C3.89 21 3 20.1 3 19V5C3 3.9 3.89 3 5 3H19C20.1 3 21 3.9 21 5V6H12C10.89 6 10 6.9 10 8V16C10 17.1 10.89 18 12 18H21ZM12 16H22V8H12V16ZM16 13.5C15.17 13.5 14.5 12.83 14.5 12C14.5 11.17 15.17 10.5 16 10.5C16.83 10.5 17.5 11.17 17.5 12C17.5 12.83 16.83 13.5 16 13.5Z" fill={color} />
    </svg>
  );
}

function IconCategories({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2L6.5 11H17.5L12 2ZM17.5 13C15.01 13 13 15.01 13 17.5C13 19.99 15.01 22 17.5 22C19.99 22 22 19.99 22 17.5C22 15.01 19.99 13 17.5 13ZM3 21.5H11V13.5H3V21.5Z" fill={color} />
    </svg>
  );
}

function IconProfile({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill={color} />
    </svg>
  );
}

function IconCart({ color }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 18C5.9 18 5.01 18.9 5.01 20C5.01 21.1 5.9 22 7 22C8.1 22 9 21.1 9 20C9 18.9 8.1 18 7 18ZM17 18C15.9 18 15.01 18.9 15.01 20C15.01 21.1 15.9 22 17 22C18.1 22 19 21.1 19 20C19 18.9 18.1 18 17 18ZM7.17 14.75L7.2 14.63L8.1 13H15.55C16.3 13 16.96 12.59 17.3 11.97L21.16 4.96L19.42 4H19.41L18.31 6L15.55 11H8.53L8.4 10.73L6.16 6L5.21 4L4.27 2H1V4H3L6.6 11.59L5.25 14.04C5.09 14.32 5 14.65 5 15C5 16.1 5.9 17 7 17H19V15H7.42C7.29 15 7.17 14.89 7.17 14.75Z" fill={color} />
    </svg>
  );
}

type ComponentId =
  | 'logo'
  | 'mainmenu'
  | 'sectionmenu'
  | 'identity'
  | 'navbutton'
  | 'listheader'
  | 'kpistrip'
  | 'ticket-tile'
  | 'partner-avatar'
  | 'card-image';

interface ComponentItem {
  id: ComponentId;
  name: string;
}

const componentList: ComponentItem[] = [
  { id: 'logo', name: 'Logo' },
  { id: 'mainmenu', name: 'Main Menu' },
  { id: 'sectionmenu', name: 'Section Menu' },
  { id: 'identity', name: 'Identity & Reputation' },
  { id: 'navbutton', name: 'Nav Button' },
  { id: 'listheader', name: 'List Header' },
  { id: 'kpistrip', name: 'KPI Strip' },
  { id: 'ticket-tile', name: 'Ticket Tile' },
  { id: 'partner-avatar', name: 'Partner Avatar' },
  { id: 'card-image', name: 'Card Image' },
];

const MAIN_MENU_VARIANTS: MainMenuVariant[] = [
  'Default',
  'START',
  'Store',
  'Buy',
  'Help',
  'Wallet',
  'Variant9',
  'noMenu',
  'BarOnly',
  'Init',
];

function getVariantInfo(variant: MainMenuVariant): { title: string; description: string; activeTab?: number } {
  const infos: Record<MainMenuVariant, { title: string; description: string; activeTab?: number }> = {
    Default: { title: 'Default', description: 'Home + burger, no active tab' },
    START:   { title: 'START',   description: 'Home + 4 action tabs + large start burger', activeTab: -1 },
    Store:   { title: 'Store',   description: 'Tabs with Sell active', activeTab: 1 },
    Buy:     { title: 'Buy',     description: 'Tabs with Buy active', activeTab: 0 },
    Help:    { title: 'Help',    description: 'Tabs with CoOp active', activeTab: 2 },
    Wallet:  { title: 'Wallet',  description: 'Tabs with Wallet active', activeTab: 3 },
    Variant9: { title: 'Variant9', description: 'Alternative tabs: Categories / Wallet / Profile / Cart' },
    noMenu:  { title: 'noMenu',  description: 'Home button only (no burger)' },
    BarOnly: { title: 'BarOnly', description: 'Empty bar background only' },
    Init:    { title: 'Init',    description: 'Initialization state, same as START', activeTab: -1 },
  };
  return infos[variant];
}

function ComponentSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="p-6 space-y-4 border shadow-sm rounded-xl border-border-default bg-surface-primary">
      <div>
        <Typography variant="h6">{title}</Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Typography variant="overline" color="text.secondary" display="block">
        {label}
      </Typography>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const DEMO_SUB_ITEMS: Record<string, MainMenuSubItem[]> = {
  Buy: [
    { label: 'Marketplace', description: 'Browse all offers' },
    { label: 'Categories', description: 'Filter by category' },
    { label: 'Deals', description: 'Special offers & promotions', badge: 'NEW' },
    { label: 'Saved', description: 'Saved items' },
  ],
  Sell: [
    { label: 'Create Listing', description: 'List as private seller' },
    { label: 'Founder Listing', description: 'List as founder' },
    { label: 'My Store', description: 'Manage listings' },
  ],
  CoOp: [
    { label: 'Offer Services', description: 'Post a service', badge: 'BETA' },
    { label: 'Cooperation', description: 'Work with others' },
    { label: 'Requests', description: 'Open cooperation requests' },
  ],
  Wallet: [
    { label: 'Balance', description: 'Balance & transactions' },
    { label: 'Deposit', description: 'Add funds' },
    { label: 'Withdraw', description: 'Withdraw to bank account' },
  ],
  Categories: [
    { label: 'Electronics', description: 'Devices & accessories' },
    { label: 'Clothing', description: 'Fashion & accessories' },
    { label: 'All Categories', description: 'Full overview' },
  ],
  Profile: [
    { label: 'My Profile', description: 'Personal data' },
    { label: 'Settings', description: 'Account & notifications' },
  ],
};

function InteractiveMainMenuDemo() {
  const [menuMode, setMenuMode] = useState<MainMenuMode>('mobile');
  const { theme: globalTheme } = useTheme();
  const menuTheme: MainMenuTheme = globalTheme;
  const [menuVariant, setMenuVariant] = useState<MainMenuVariant>('START');
  const [activeTab, setActiveTab] = useState<number>(-1);
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [withSubItems, setWithSubItems] = useState<boolean>(true);
  const [navLevel, setNavLevel] = useState<MainMenuLevel>('root');
  const [activeParentLabel, setActiveParentLabel] = useState<string>('');

  const variantInfo = getVariantInfo(menuVariant);
  const hasInteractiveTabs = ['START', 'Store', 'Buy', 'Help', 'Wallet', 'Variant9', 'Init'].includes(menuVariant);

  const handleTabClick = (index: number) => {
    if (hasInteractiveTabs) setActiveTab(index);
  };

  const handleHomeClick = () => {
    setCurrentPath('/');
    if (menuVariant === 'START' || menuVariant === 'Init') setActiveTab(-1);
  };

  const handleNavigate = (to: string) => setCurrentPath(to);

  const handleLevelChange = (level: MainMenuLevel, parent?: string) => {
    setNavLevel(level);
    setActiveParentLabel(parent ?? '');
  };

  const standardTabs: MainMenuTab[] = [
    { label: 'Buy', icon: <IconBuy color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.Buy : undefined, onClick: () => handleTabClick(0) },
    { label: 'Sell', icon: <IconSell color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.Sell : undefined, onClick: () => handleTabClick(1) },
    { label: 'CoOp', icon: <IconCoOp color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.CoOp : undefined, onClick: () => handleTabClick(2) },
    { label: 'Wallet', icon: <IconWallet color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.Wallet : undefined, onClick: () => handleTabClick(3) },
  ];

  const variant9Tabs: MainMenuTab[] = [
    { label: 'Categories', icon: <IconCategories color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.Categories : undefined, onClick: () => handleTabClick(0) },
    { label: 'Wallet', icon: <IconWallet color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.Wallet : undefined, onClick: () => handleTabClick(1) },
    { label: 'Profile', icon: <IconProfile color="currentColor" />, subItems: withSubItems ? DEMO_SUB_ITEMS.Profile : undefined, onClick: () => handleTabClick(2) },
    { label: 'Cart', icon: <IconCart color="currentColor" />, onClick: () => handleTabClick(3) },
  ];

  const customTabs = menuVariant === 'Variant9' ? variant9Tabs : standardTabs;
  const displayActiveTab = activeTab >= 0 ? activeTab : undefined;

  return (
    <div className="space-y-6">
      <Row label="View mode">
        <ToggleButtonGroup value={menuMode} exclusive onChange={(_, val) => val && setMenuMode(val)} size="small">
          <ToggleButton value="mobile">
            <PhoneIphoneIcon sx={{ fontSize: 18, mr: 0.5 }} /> Mobile
          </ToggleButton>
          <ToggleButton value="desktop">
            <DesktopWindowsIcon sx={{ fontSize: 18, mr: 0.5 }} /> Desktop
          </ToggleButton>
        </ToggleButtonGroup>
      </Row>

      <Row label="Variant">
        <Box sx={{ minWidth: 180 }}>
          <select
            value={menuVariant}
            onChange={(e) => {
              const newVariant = e.target.value as MainMenuVariant;
              setMenuVariant(newVariant);
              setNavLevel('root');
              setActiveParentLabel('');
              const info = getVariantInfo(newVariant);
              if (info.activeTab !== undefined) setActiveTab(info.activeTab);
            }}
            className="px-3 py-1.5 text-sm border rounded-md bg-surface-primary border-border-default text-text-default"
          >
            {MAIN_MENU_VARIANTS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Box>
        <Chip label={variantInfo.description} size="small" color="primary" variant="outlined" />
      </Row>

      <Row label="Two-level navigation">
        <FormControlLabel
          control={
            <Switch
              checked={withSubItems}
              onChange={(e) => setWithSubItems(e.target.checked)}
              color="primary"
              size="small"
            />
          }
          label={<Typography variant="body2">Enable sub-items</Typography>}
        />
        {withSubItems && (
          <Chip
            icon={<LayersIcon sx={{ fontSize: 14 }} />}
            label="Click a tab to open level 2"
            size="small"
            color="info"
            variant="outlined"
          />
        )}
      </Row>

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'visible',
          bgcolor: 'var(--theme-bg)',
          minHeight: menuMode === 'mobile' ? 58 : 68,
        }}
      >
        <MainMenu
          variant={menuVariant}
          mode={menuMode}
          theme={menuTheme}
          activeTab={displayActiveTab}
          tabs={hasInteractiveTabs ? customTabs : undefined}
          onHome={handleHomeClick}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          onLevelChange={handleLevelChange}
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
        <Typography variant="caption" color="text.secondary" component="div">
          <strong>Mode:</strong> {menuMode === 'mobile' ? 'Bottom Nav' : 'Top Bar'}
          {' · '}
          <strong>Theme:</strong> {menuTheme}
          {' · '}
          <strong>Variant:</strong> {menuVariant}
          {' · '}
          <strong>Level:</strong>{' '}
          <span className={navLevel === 'sub' ? 'text-info' : 'text-success'}>
            {navLevel === 'root' ? '1 — Root' : `2 — ${activeParentLabel}`}
          </span>
        </Typography>
      </Paper>
    </div>
  );
}

function VariantOverviewGrid() {
  const [selectedVariant, setSelectedVariant] = useState<MainMenuVariant>('START');
  const [activeTab, setActiveTab] = useState<number>(-1);

  return (
    <div className="space-y-6">
      <Typography variant="subtitle1" fontWeight={600}>
        All variants at a glance — click a variant for the detailed view
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
        {MAIN_MENU_VARIANTS.map((variant) => {
          const info = getVariantInfo(variant);
          const isSelected = selectedVariant === variant;

          return (
            <Paper
              key={variant}
              onClick={() => {
                setSelectedVariant(variant);
                if (info.activeTab !== undefined) setActiveTab(info.activeTab);
              }}
              sx={{
                p: 2,
                cursor: 'pointer',
                border: 2,
                borderColor: isSelected ? 'primary.main' : 'divider',
                bgcolor: isSelected ? 'primary.50' : 'background.paper',
                '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
              }}
            >
              <Typography variant="subtitle2" fontWeight={700} color={isSelected ? 'primary.main' : 'text.primary'}>
                {info.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {info.description}
              </Typography>
              <Box sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                <MainMenu
                  variant={variant}
                  mode="mobile"
                  theme="light"
                  activeTab={info.activeTab != null && info.activeTab >= 0 ? info.activeTab : undefined}
                />
              </Box>
            </Paper>
          );
        })}
      </Box>

      <Box sx={{ my: 3 }} />

      <Typography variant="subtitle1" fontWeight={600}>
        Detail view: {selectedVariant}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
          <Typography variant="caption" fontWeight={600} display="block" gutterBottom>
            Light Theme
          </Typography>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            <MainMenu
              variant={selectedVariant}
              mode="mobile"
              theme="light"
              activeTab={activeTab >= 0 ? activeTab : undefined}
            />
          </Box>
        </Paper>
        <Paper sx={{ p: 2, bgcolor: '#252C33' }}>
          <Typography variant="caption" fontWeight={600} display="block" gutterBottom sx={{ color: 'white' }}>
            Dark Theme
          </Typography>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            <MainMenu
              variant={selectedVariant}
              mode="mobile"
              theme="dark"
              activeTab={activeTab >= 0 ? activeTab : undefined}
            />
          </Box>
        </Paper>
      </Box>
    </div>
  );
}

const DEMO_TICKET: TicketData = {
  id: 'demo-ticket-1',
  title: 'Vintage Vinyl Record — Pink Floyd',
  amountSats: 35000,
  status: 'PAID',
  createdAt: new Date().toISOString(),
};

const DEMO_KPIS: KPIItem[] = [
  { label: 'Revenue', value: '1.2M sats' },
  { label: 'Tickets', value: '24' },
  { label: 'Rating', value: '4.8' },
];

function ComponentsPageContent() {
  const [selectedComponent, setSelectedComponent] = useState<ComponentId>('mainmenu');
  const [mainMenuView, setMainMenuView] = useState<'interactive' | 'overview'>('interactive');
  const [activeListTab, setActiveListTab] = useState('open');
  const [lastSectionItem, setLastSectionItem] = useState<string | null>(null);

  const buyItems = getSubItems(navigationConfig, '/buy') ?? [];
  const sellItems = getSubItems(navigationConfig, '/sell') ?? [];
  const coopItems = getSubItems(navigationConfig, '/coop') ?? [];

  const renderComponent = () => {
    if (selectedComponent === 'logo') {
      return (
        <ComponentSection title="Logo" description="Brand logos for Colabonate and sub-brands.">
          <Row label="Colabonate">
            <div className="p-6 rounded-lg bg-surface-secondary">
              <Logo brand="colabonate" theme="default" />
            </div>
            <div className="p-6 bg-white border rounded-lg border-border-default">
              <Logo brand="colabonate" theme="on-white" />
            </div>
            <div className="p-6 rounded-lg bg-secondary-90">
              <Logo brand="colabonate" theme="on-dark" />
            </div>
          </Row>
          <Row label="Sub-brands">
            <div className="flex flex-col gap-6 p-6 rounded-lg bg-surface-secondary">
              {(['colabobuy', 'colabonow', 'colabosell'] as LogoBrand[]).map((brand) => (
                <Logo key={brand} brand={brand} theme="default" />
              ))}
            </div>
          </Row>
        </ComponentSection>
      );
    }

    if (selectedComponent === 'mainmenu') {
      return (
        <ComponentSection
          title="MainMenu"
          description="Responsive navigation with bottom nav (mobile) and top bar (desktop)."
        >
          <ToggleButtonGroup
            value={mainMenuView}
            exclusive
            onChange={(_, val) => val && setMainMenuView(val)}
            size="small"
            fullWidth
            sx={{ mb: 3 }}
          >
            <ToggleButton value="interactive" sx={{ flex: 1 }}>
              Interactive Demo
            </ToggleButton>
            <ToggleButton value="overview" sx={{ flex: 1 }}>
              Variant Overview
            </ToggleButton>
          </ToggleButtonGroup>

          {mainMenuView === 'interactive' ? <InteractiveMainMenuDemo /> : <VariantOverviewGrid />}
        </ComponentSection>
      );
    }

    if (selectedComponent === 'sectionmenu') {
      return (
        <ComponentSection title="SectionMenu" description="Dashboard cards and floating context lists.">
          <Row label="Cards mode">
            <SectionMenu items={buyItems} mode="cards" onSelect={(item) => setLastSectionItem(item.label)} />
          </Row>
          <Row label="List mode">
            <Box sx={{ display: 'grid', gridTemplateColumns: { md: 'repeat(3, 1fr)' }, gap: 2 }}>
              <SectionMenu items={buyItems} mode="list" onSelect={(item) => setLastSectionItem(item.label)} />
              <SectionMenu items={sellItems} mode="list" onSelect={(item) => setLastSectionItem(item.label)} />
              <SectionMenu items={coopItems} mode="list" onSelect={(item) => setLastSectionItem(item.label)} />
            </Box>
          </Row>
          {lastSectionItem && (
            <Typography variant="body2" color="text.secondary">
              Last selected: <strong>{lastSectionItem}</strong>
            </Typography>
          )}
        </ComponentSection>
      );
    }

    if (selectedComponent === 'identity') {
      return (
        <ComponentSection title="Identity & Reputation" description="ReputationBadge for identity levels and score.">
          <Row label="Score (all sizes)">
            {(['small', 'medium', 'large'] as const).map((size) => (
              <div key={size} className="flex flex-col items-center gap-1">
                <ReputationBadge variant="score" score={4.2} identityLevel={2} size={size} />
                <span className="text-xs text-text-muted">{size}</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-1">
              <ReputationBadge variant="score" loading size="medium" />
              <span className="text-xs text-text-muted">loading</span>
            </div>
          </Row>

          <Row label="Level (all 4 levels)">
            {([0, 1, 2, 3] as const).map((level) => (
              <div key={level} className="flex flex-col items-center gap-2">
                <ReputationBadge variant="level" identityLevel={level} size="large" />
                <span className="text-xs font-mono text-text-muted">Level {level}</span>
              </div>
            ))}
          </Row>

          <Row label="Combined">
            {([0, 1, 2, 3] as const).map((level) => (
              <ReputationBadge
                key={level}
                variant="combined"
                score={3.5 + level * 0.2}
                identityLevel={level}
                colPoints={level * 60}
                size="large"
              />
            ))}
          </Row>
        </ComponentSection>
      );
    }

    if (selectedComponent === 'navbutton') {
      return (
        <ComponentSection title="NavButton" description="Primary navigation actions.">
          <Row label="Variants">
            <NavButton icon={<IconBuy color="currentColor" />} label="Buy" variant="default" />
            <NavButton icon={<IconSell color="currentColor" />} label="Sell" variant="active" />
            <NavButton icon={<IconCoOp color="currentColor" />} label="CoOp" variant="hover" />
          </Row>
        </ComponentSection>
      );
    }

    if (selectedComponent === 'listheader') {
      return (
        <ComponentSection title="ListHeader" description="List header with filter tabs and actions.">
          <ListHeader
            tabs={[
              { key: 'open', label: 'Open' },
              { key: 'active', label: 'Active' },
              { key: 'completed', label: 'Completed' },
            ]}
            activeTab={activeListTab}
            onTabChange={setActiveListTab}
            actions={[{ key: 'new-offer', element: <Button size="small" variant="contained">New offer</Button> }]}
          />
        </ComponentSection>
      );
    }

    if (selectedComponent === 'kpistrip') {
      return (
        <ComponentSection title="KPIStrip" description="Key performance indicator strip.">
          <KPIStrip items={DEMO_KPIS} />
        </ComponentSection>
      );
    }

    if (selectedComponent === 'ticket-tile') {
      return (
        <ComponentSection title="TicketTile" description="Ticket preview card for buyer/seller dashboards.">
          <Box sx={{ maxWidth: 360 }}>
            <TicketTile ticket={DEMO_TICKET} variant="overview" />
          </Box>
        </ComponentSection>
      );
    }

    if (selectedComponent === 'partner-avatar') {
      return (
        <ComponentSection title="PartnerAvatar" description="Partner avatar with fallback initials.">
          <div className="flex items-center gap-4">
            <PartnerAvatar name="Demo Partner" role="Seller" />
            <PartnerAvatar name="Another Partner" role="Buyer" avatarUrl="https://picsum.photos/seed/avatar/100/100" />
          </div>
        </ComponentSection>
      );
    }

    if (selectedComponent === 'card-image') {
      const fallback = (
        <span
          className="absolute inset-0 flex items-center justify-center select-none leading-none"
          style={{
            fontSize: CARD_THEME.text.placeholderSize,
            fontWeight: CARD_THEME.text.placeholderWeight,
            color: CARD_THEME.colors('light').placeholder,
          }}
        >
          C
        </span>
      );
      return (
        <ComponentSection
          title="CardImage"
          description="Card image area with shimmer loading state (no alt-text string), crossfade on load, and fallback on error/missing src."
        >
          <Row label="Loading → crossfade (reload page to see the shimmer)">
            <div className="w-[196px] h-[120px] rounded-t-xl overflow-hidden border border-border-default">
              <CardImage
                className="w-full h-full"
                src="https://picsum.photos/seed/card-image/400/300"
                alt="Demo offer"
                fallback={fallback}
              />
            </div>
          </Row>
          <Row label="Broken src → fallback">
            <div className="w-[196px] h-[120px] rounded-t-xl overflow-hidden border border-border-default">
              <CardImage className="w-full h-full" src="https://invalid.example/broken.jpg" alt="Broken" fallback={fallback} />
            </div>
          </Row>
          <Row label="No src → fallback">
            <div className="w-[196px] h-[120px] rounded-t-xl overflow-hidden border border-border-default">
              <CardImage className="w-full h-full" alt="Without image" fallback={fallback} />
            </div>
          </Row>
        </ComponentSection>
      );
    }

    return null;
  };

  return (
    <div className="flex gap-6">
      <aside className="flex-shrink-0 w-64 space-y-6">
        <div className="p-4 border shadow-sm rounded-xl border-border-default bg-surface-primary">
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Components</Typography>
          <div className="flex flex-col gap-1">
            {componentList.map((item) => (
              <Button
                key={item.id}
                fullWidth
                variant={selectedComponent === item.id ? 'contained' : 'text'}
                color="primary"
                size="small"
                onClick={() => setSelectedComponent(item.id)}
                sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: selectedComponent === item.id ? 600 : 400 }}
              >
                {item.name}
              </Button>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex-1 space-y-8">
        <div>
          <Typography variant="h4">Components</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Project-specific components from @ds/ui.
          </Typography>
        </div>
        {renderComponent()}
      </main>
    </div>
  );
}

export function ComponentsPage() {
  return <ComponentsPageContent />;
}
