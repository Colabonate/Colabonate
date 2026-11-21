import { Button, IconButton } from '@mui/material';
import { Close as CloseIcon, OpenInNew as OpenInNewIcon, Add as AddIcon, Settings as SettingsIcon } from '@mui/icons-material';
import { Bot } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ProviderBadge } from './ProviderBadge';
import { AiCreditsBar } from './AiCreditsStatus';
import type { MessageTurn, AiProviderInfo } from './ai-assistant.types';

interface AIAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  turns: MessageTurn[];
  isLoading: boolean;
  onSend: (message: string, images?: string[]) => void;
  onCancel: () => void;
  onRegenerate?: () => void;
  guest?: boolean;
  onNewSession?: () => void;
  pendingImages?: string[];
  onImagesChange?: (images: string[]) => void;
  providerInfo?: AiProviderInfo | null;
}

export function AIAssistantPanel({
  isOpen,
  onClose,
  turns,
  isLoading,
  onSend,
  onCancel,
  onRegenerate,
  guest = false,
  onNewSession,
  pendingImages,
  onImagesChange,
  providerInfo,
}: AIAssistantPanelProps) {
  const navigate = useNavigate();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[1300]"
          style={{ background: 'rgba(0,0,0,0.3)', pointerEvents: 'auto' }}
          onClick={onClose}
        />
      )}

      <div
        className="fixed top-0 right-0 bottom-0 left-0 sm:left-auto sm:w-[480px] z-[1301] flex flex-col shadow-2xl transition-transform duration-300 ease-out"
        style={{
          background: 'var(--theme-surface)',
          borderLeft: '1px solid var(--theme-border)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          pointerEvents: isOpen ? 'auto' : 'none',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--color-primary-8)' }}>
              <Bot size={16} style={{ color: 'var(--color-primary-50)' }} />
            </div>
            <span className="font-semibold text-[14px]" style={{ color: 'var(--theme-text)' }}>
              AI Assistant
            </span>
            {providerInfo && <ProviderBadge info={providerInfo} />}
          </div>
          <div className="flex items-center gap-1.5">
            {onNewSession && (
              <IconButton
                onClick={onNewSession}
                title="New Chat"
                sx={{
                  width: 36,
                  height: 36,
                  border: '1px solid var(--theme-border)',
                  borderRadius: '50%',
                  color: 'var(--theme-text)',
                  '&:hover': {
                    borderColor: 'var(--color-primary-50)',
                    bgcolor: 'var(--theme-bg-hover)',
                  },
                }}
              >
                <AddIcon />
              </IconButton>
            )}
            <IconButton
              onClick={() => {
                onClose();
                navigate('/settings#ai');
              }}
              title="AI settings"
              sx={{
                width: 36,
                height: 36,
                border: '1px solid var(--theme-border)',
                borderRadius: '50%',
                color: 'var(--theme-text)',
                '&:hover': {
                  borderColor: 'var(--color-primary-50)',
                  bgcolor: 'var(--theme-bg-hover)',
                },
              }}
            >
              <SettingsIcon />
            </IconButton>
            <Button
              variant="outlined"
              onClick={() => { onClose(); navigate('/ai'); }}
              title="Expand to full page"
              startIcon={<OpenInNewIcon />}
              sx={{
                minWidth: 40,
                height: 36,
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text)',
                '&:hover': {
                  borderColor: 'var(--color-primary-50)',
                  bgcolor: 'var(--theme-bg-hover)',
                },
              }}
            >
              Expand
            </Button>
            <IconButton
              onClick={onClose}
              sx={{
                width: 36,
                height: 36,
                border: '1px solid var(--theme-border)',
                borderRadius: '50%',
                color: 'var(--theme-text)',
                '&:hover': {
                  borderColor: 'var(--color-primary-50)',
                  bgcolor: 'var(--theme-bg-hover)',
                },
              }}
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>

        <MessageList turns={turns} compact onQuickAction={onSend} onRegenerate={onRegenerate} guest={guest} connectHint />

        {turns.length > 0 && <AiCreditsBar />}

        <ChatInput
          onSend={onSend}
          isLoading={isLoading}
          onCancel={onCancel}
          placeholder={guest ? 'Ask how Colabonate works…' : undefined}
          pendingImages={pendingImages}
          onImagesChange={onImagesChange}
          supportsImages={providerInfo?.supportsImages ?? true}
        />
      </div>
    </>
  );
}
