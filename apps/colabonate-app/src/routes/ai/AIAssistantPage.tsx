import { useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import Paper from '@mui/material/Paper';
import {
  SmartToy as SmartToyIcon,
  Add as AddIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
  AutoAwesome as AutoAwesomeIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import { Cable } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { useAIChat } from '../../components/ai-assistant/useAIChat';
import { MessageList } from '../../components/ai-assistant/MessageList';
import { ChatInput } from '../../components/ai-assistant/ChatInput';
import { ChatHistoryPopover } from '../../components/ai-assistant/ChatHistoryPopover';
import { ProviderBadge } from '../../components/ai-assistant/ProviderBadge';
import { QuickActions } from '../../components/ai-assistant/QuickActions';
import { AiCreditsStarter, AiCreditsBar } from '../../components/ai-assistant/AiCreditsStatus';
import { useBetaMode } from '../../hooks/useBetaMode';
import { BetaBadge } from '../../components/branding/BetaBadge';

const keyframes = {
  '@keyframes aiOrbitSpin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },
};

// Same brand backdrop as SearchHeroSection (Colabonate logo, blurred + washed
// out) — sits behind the chat window, which partially overlaps it.
const BACKGROUND_LOGO_IMAGE = new URL('../../assets/Colabonate_Logo_7_04.webp', import.meta.url).href;

// Shared look for the round outline icon buttons in the chat input row.
const actionButtonSx = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  border: '1px solid var(--theme-border)',
  color: 'var(--theme-text-muted)',
  bgcolor: 'transparent',
  flexShrink: 0,
  '&:hover': {
    borderColor: 'var(--color-primary-50)',
    bgcolor: 'var(--theme-bg-hover)',
    color: 'var(--color-primary-50)',
  },
  '&.Mui-disabled': {
    borderColor: 'var(--theme-border)',
    color: 'var(--theme-text-muted)',
    opacity: 0.5,
  },
} as const;

const newChatButtonSx = {
  ...actionButtonSx,
  borderColor: 'var(--color-primary-50)',
  color: 'var(--color-primary-50)',
} as const;

interface AssistantHeroProps {
  providerLabel?: string | null;
  onQuickAction: (message: string) => void;
  guest?: boolean;
}

function AssistantHero({ providerLabel, onQuickAction, guest = false }: AssistantHeroProps) {
  return (
    <Stack
      spacing={2.5}
      alignItems="center"
      sx={{ width: '100%', maxWidth: 380, textAlign: 'center' }}
    >
      <Box sx={{ position: 'relative', width: 92, height: 92, mb: 1.5 }}>
        <Box
          sx={{
            position: 'absolute',
            inset: -12,
            borderRadius: '50%',
            border: '1px dashed',
            borderColor: 'color-mix(in srgb, var(--color-secondary-50) 45%, transparent)',
            animation: 'aiOrbitSpin 26s linear infinite',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: -28,
            borderRadius: '50%',
            border: '1px dashed',
            borderColor: 'color-mix(in srgb, var(--color-primary-50) 18%, transparent)',
          }}
        />
        <Avatar
          sx={{
            width: 92,
            height: 92,
            bgcolor: 'color-mix(in srgb, var(--color-primary-50) 10%, var(--theme-surface))',
            border: '1px solid color-mix(in srgb, var(--color-primary-50) 32%, transparent)',
            color: 'var(--color-primary-50)',
            boxShadow: 'var(--theme-shadow)',
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: 36 }} />
        </Avatar>
      </Box>

      <Stack spacing={0.75}>
        <Typography variant="h5" sx={{ color: 'var(--theme-text)', fontWeight: 600 }}>
          Colabonate AI Assistant
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.55 }}>
          Buy, sell, and cooperate with AI. Ask about offers, tickets, cooperations or marketplace
          insights. The assistant works with your marketplace data and can take simple actions.
        </Typography>
      </Stack>

      <Box sx={{ width: '100%' }}>
        <AiCreditsStarter />
      </Box>

      <Box sx={{ width: '100%', mt: 1 }}>
        <QuickActions onAction={onQuickAction} centered guest={guest} maxGroups={3} />
      </Box>

      {providerLabel && (
        <Typography
          variant="caption"
          sx={{
            px: 1.25,
            py: 0.5,
            borderRadius: 999,
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-subtle)',
            color: 'var(--theme-text-muted)',
          }}
        >
          {providerLabel}
        </Typography>
      )}

      {/* ADR-371 D6 — prominent "connect your agent" card in the initial info area */}
      <Link to="/ai/connect" style={{ textDecoration: 'none', width: '100%' }}>
        <Box
          sx={{
            width: '100%',
            mt: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: 1.5,
            borderRadius: 2.5,
            border: '1px dashed var(--theme-border)',
            background: 'var(--theme-surface)',
            textAlign: 'left',
            transition: 'border-color 150ms ease, background-color 150ms ease',
            '&:hover': {
              borderColor: 'var(--color-primary-50)',
              background: 'var(--theme-bg-hover)',
            },
          }}
        >
          <Avatar
            sx={{
              width: 34,
              height: 34,
              flexShrink: 0,
              bgcolor: 'var(--color-primary-8)',
              color: 'var(--color-primary-50)',
            }}
          >
            <Cable size={17} />
          </Avatar>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: 'var(--theme-text)', fontWeight: 600 }}>
              Connect your agent via MCP
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.45 }}>
              Run Colabonate tools from Claude, Kilo or another local agent
            </Typography>
          </Stack>
          <ArrowForwardIcon sx={{ flexShrink: 0, fontSize: 18, color: 'var(--theme-text-muted)' }} />
        </Box>
      </Link>
    </Stack>
  );
}

export function AIAssistantPage() {
  const {
    turns,
    isLoading,
    isGuest,
    submitMessage,
    regenerate,
    cancel,
    currentSessionId,
    sessions,
    newSession,
    loadSession,
    deleteSession,
    renameSession,
    providerInfo,
  } = useAIChat();
  const { isBeta } = useBetaMode();
  const navigate = useNavigate();
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  const handleNewChat = () => {
    setPendingImages([]);
    newSession();
  };

  const openSettings = () => navigate('/settings#ai');

  const providerHint = providerInfo
    ? providerInfo.model
      ? `${providerInfo.label} · ${providerInfo.model}`
      : providerInfo.label
    : null;

  return (
    <Box
      sx={{
        // Match <main>'s horizontal padding (px = 16px on all breakpoints per
        // Layout.tsx). Negative top/bottom margin breaks out of <main>'s pt/pb
        // so the chat can fill the full vertical space below the TopBar while
        // the mobile BottomNav (z-index 1200) still floats above. Height is
        // pinned to the viewport via dvh so the inner scroll chain
        // (Box → MessageList overflow-y:auto) can compute deterministically.
        // Top margin is only negative on mobile (where <main> adds pt: 16px);
        // from md up <main> has pt: 0 and the sticky TopBar sits in-flow, so a
        // negative top margin would pull the first section (PageHeader / Beta
        // notice) underneath the bar. Bottom margin keeps canceling <main>'s pb.
        // No background here — the app-level gradient stays visible behind the page.
        mx: '-16px',
        mt: { xs: '-16px', sm: '-16px', md: 0 },
        mb: { xs: '-16px', sm: '-16px', md: '-24px' },
        height: { xs: 'calc(100dvh - 58px)', lg: 'calc(100dvh - 68px)' },
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        ...keyframes,
      }}
    >
      {/* Ambient background — same blurred brand logo as SearchHeroSection,
          centered so the chat window partially overlaps it. No overlay washes
          here: on the transparent page they would paint a visible tinted
          rectangle with hard square edges (and wash the light logo out). */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <Box
          component="img"
          src={BACKGROUND_LOGO_IMAGE}
          alt=""
          sx={{
            position: 'absolute',
            top: '50%',
            // Desktop: anchored right so the chat window overlaps the logo's
            // left half (SearchHero-style); mobile: centered, peeking out
            // above/below the window. Low opacity + blur = the hero's washed
            // look, without full-page overlay rectangles.
            left: { xs: '50%', md: '74%' },
            width: { xs: 440, sm: 600, md: 820 },
            height: { xs: 440, sm: 600, md: 820 },
            transform: 'translate(-50%, -50%)',
            objectFit: 'contain',
            filter: 'blur(2px)',
            opacity: 0.35,
          }}
        />
      </Box>

      <Box sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0, px: 2, pt: 1, position: 'relative', zIndex: 1 }}>
        <PageHeader
          icon={<SmartToyIcon sx={{ fontSize: 18 }} />}
          title="AI Assistant"
          subtitle="Buy, sell, and cooperate with AI"
          onBack={() => window.history.back()}
          actionsFit="inline"
        />
      </Box>

      {isBeta && (
        <Box sx={{ flexShrink: 0, px: { xs: 1, sm: 1.5, md: 2 }, pt: 1, position: 'relative', zIndex: 1 }}>
          <Paper
            variant="outlined"
            square
            role="note"
            aria-label="Beta notice"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderRadius: 1.5,
              px: 1.5,
              py: 1,
              borderColor: 'color-mix(in srgb, var(--color-primary-50) 25%, transparent)',
              background: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)',
            }}
          >
            <BetaBadge />
            <Typography
              variant="caption"
              sx={{ color: 'var(--theme-text-muted)', fontSize: 11, lineHeight: 1.4 }}
            >
              Beta: answers may be inaccurate. Not all features are available yet — feedback welcome.
            </Typography>
          </Paper>
        </Box>
      )}

      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 3,
          borderColor: 'var(--theme-border)',
          background: 'color-mix(in srgb, var(--theme-surface) 62%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 1px 2px color-mix(in srgb, var(--color-primary-50) 6%, transparent)',
          mx: { xs: 1, sm: 2, md: 'auto' },
          width: { md: 'min(880px, calc(100% - 64px))' },
          mt: { xs: 2, sm: 3, md: 4 },
          mb: { xs: 3, sm: 4, md: 5 },
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <MessageList
            turns={turns}
            compact={false}
            onQuickAction={submitMessage}
            onRegenerate={regenerate}
            guest={isGuest}
            emptyContent={
              <AssistantHero providerLabel={providerHint} onQuickAction={submitMessage} guest={isGuest} />
            }
          />
        </Box>

        {turns.length > 0 && <AiCreditsBar />}

        <ChatInput
          onSend={submitMessage}
          isLoading={isLoading}
          onCancel={cancel}
          wide
          placeholder={isGuest ? 'Ask how Colabonate works…' : 'Ask about your offers, cooperations, tickets…'}
          pendingImages={pendingImages}
          onImagesChange={setPendingImages}
          supportsImages={providerInfo?.supportsImages ?? true}
          leadingActions={
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexShrink: 0 }}>
              <Tooltip title="Chat history">
                <IconButton
                  onClick={e => setHistoryAnchor(e.currentTarget)}
                  aria-label="Chat history"
                  aria-haspopup="true"
                  aria-expanded={historyAnchor ? 'true' : undefined}
                  sx={actionButtonSx}
                >
                  <HistoryIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="New chat">
                <span>
                  <IconButton
                    onClick={handleNewChat}
                    aria-label="New chat"
                    disabled={isLoading}
                    sx={newChatButtonSx}
                  >
                    <AddIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="AI settings">
                <IconButton
                  onClick={openSettings}
                  aria-label="AI settings"
                  sx={actionButtonSx}
                >
                  <SettingsIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              {providerInfo && (
                <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                  <ProviderBadge info={providerInfo} />
                </Box>
              )}
            </Stack>
          }
        />
      </Paper>

      <ChatHistoryPopover
        anchorEl={historyAnchor}
        open={Boolean(historyAnchor)}
        onClose={() => setHistoryAnchor(null)}
        sessions={sessions}
        activeSessionId={currentSessionId}
        onSelectSession={loadSession}
        onNewSession={handleNewChat}
        onDeleteSession={deleteSession}
        onRenameSession={renameSession}
      />
    </Box>
  );
}
