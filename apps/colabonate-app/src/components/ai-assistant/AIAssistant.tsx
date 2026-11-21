import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { SmartToy } from '@mui/icons-material';
import { IconButton } from '@mui/material';
import { useIsMobile, useScrollVanish } from '@ds/utils';
import { AIAssistantPanel } from './AIAssistantPanel';
import { useAIChat } from './useAIChat';
import { usePref } from '../../utils/userPreferences';

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const { turns, isLoading, isGuest, submitMessage, regenerate, cancel, newSession, providerInfo } = useAIChat();
  const [aiEnabled] = usePref('aiAssistantEnabled', true);
  const isMobile = useIsMobile();
  const fabRef = useRef<HTMLDivElement>(null);

  // Match the Add-FAB's scroll-vanish on the Home route so both FABs rubber-band
  // upward together when scrolling. Paused while the panel is open.
  const onHome = useLocation().pathname === '/';
  useScrollVanish(fabRef, { enabled: onHome, paused: isOpen });

  const handleOpen = () => setIsOpen(true);
  const handleClose = () => setIsOpen(false);

  // ADR-384 D9: the Home promo section opens the panel via this event.
  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener('colabonate:open-ai-assistant', open);
    return () => window.removeEventListener('colabonate:open-ai-assistant', open);
  }, []);

  // ADR-384 D9: Home category chips open the panel and start the chat with the
  // category's primary preset prompt.
  useEffect(() => {
    const start = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      if (!message || !aiEnabled) return;
      setIsOpen(true);
      void submitMessage(message);
    };
    window.addEventListener('colabonate:ai-quick-action', start);
    return () => window.removeEventListener('colabonate:ai-quick-action', start);
  }, [aiEnabled, submitMessage]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  if (!aiEnabled || !onHome) return null;

  return (
    <>
      {/* Fixed wrapper carries the scroll-vanish transform/opacity/blur; the
          button keeps its own hover-scale and pulse animation untouched. */}
      <div
        ref={fabRef}
         className="fab-layer"
         style={{
           position: 'fixed',
           ...(isMobile
              ? { bottom: 'calc(58px + env(safe-area-inset-bottom, 0px) + 72px)', top: 'auto' }
             : { top: 190, bottom: 'auto' }),
           right: isMobile ? 12 : 40,
           zIndex: 1100,
           display: 'inline-flex',
           ...(onHome && { willChange: 'opacity, transform, filter' }),
         }}
      >
        <IconButton
          onClick={handleOpen}
          aria-label="Open AI Assistant"
          sx={{
            width: isMobile ? 48 : 56,
            height: isMobile ? 48 : 56,
            bgcolor: 'var(--color-accent-5)',
            color: 'var(--color-primary-50)',
            borderRadius: '50%',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              transform: 'scale(1.08)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.15)',
              bgcolor: 'var(--color-accent-5)',
            },
            '&:active': {
              transform: 'scale(0.95)',
            },
            '@keyframes ai-fab-pulse': {
              '0%, 100%': { boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)' },
              '50%': { boxShadow: '0 16px 40px rgba(232, 232, 88, 0.6), 0 0 0 1px rgba(255,255,255,0.15)' },
            },
            animation: 'ai-fab-pulse 2.5s ease-in-out infinite',
          }}
        >
          <SmartToy sx={{ fontSize: isMobile ? 22 : 26 }} />
        </IconButton>
      </div>

      <AIAssistantPanel
        isOpen={isOpen}
        onClose={handleClose}
        turns={turns}
        isLoading={isLoading}
        onSend={submitMessage}
        onCancel={cancel}
        onRegenerate={regenerate}
        guest={isGuest}
        onNewSession={() => { setPendingImages([]); newSession(); }}
        pendingImages={pendingImages}
        onImagesChange={setPendingImages}
        providerInfo={providerInfo}
      />
    </>
  );
}
