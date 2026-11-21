import { useState, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Button, IconButton, TextField, Tooltip, CircularProgress } from '@mui/material';
import { Send as SendIcon, Stop as StopIcon, Image as ImageIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { optimizeImage, dataUrlBytes, formatBytes } from '../../hooks/useImageOptimizer';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 5;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const VISION_OPTIONS = { maxWidth: 1024, maxHeight: 1024, quality: 0.8 };

interface ChatInputProps {
  onSend: (message: string, images?: string[]) => void;
  isLoading: boolean;
  onCancel: () => void;
  wide?: boolean;
  pendingImages?: string[];
  onImagesChange?: (images: string[]) => void;
  supportsImages?: boolean;
  /** F21: context-dependent placeholder (guest vs signed-in). */
  placeholder?: string;
  /** Controls rendered to the left of the attach-image button (e.g. history, new chat, settings). */
  leadingActions?: ReactNode;
}

export function ChatInput({
  onSend,
  isLoading,
  onCancel,
  wide = false,
  pendingImages = [],
  onImagesChange,
  supportsImages = true,
  placeholder = 'Ask about your offers, cooperations, tickets…',
  leadingActions,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalBytes = pendingImages.reduce((sum, url) => sum + dataUrlBytes(url), 0);
  const canAddMore = pendingImages.length < MAX_IMAGES;

  async function processFiles(files: FileList) {
    const allowed = Array.from(files)
      .filter(f => ACCEPTED.includes(f.type) && f.size <= MAX_INPUT_BYTES)
      .slice(0, MAX_IMAGES - pendingImages.length);

    if (allowed.length === 0) return;

    setProcessing(true);
    try {
      const dataUrls = await Promise.all(allowed.map(f => optimizeImage(f, VISION_OPTIONS)));

      const combined = [...pendingImages, ...dataUrls];
      const combinedBytes = combined.reduce((sum, url) => sum + dataUrlBytes(url), 0);

      if (combinedBytes > MAX_TOTAL_BYTES) {
        let trimmed = [...combined];
        while (trimmed.length > 0 && trimmed.reduce((s, u) => s + dataUrlBytes(u), 0) > MAX_TOTAL_BYTES) {
          trimmed.pop();
        }
        if (onImagesChange) onImagesChange(trimmed);
      } else {
        if (onImagesChange) onImagesChange(combined);
      }
    } catch (err) {
      console.error('Image processing failed:', err);
    } finally {
      setProcessing(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) processFiles(e.target.files);
    e.target.value = '';
  }

  function removeImage(index: number) {
    if (onImagesChange) {
      onImagesChange(pendingImages.filter((_, i) => i !== index));
    }
  }

  const handleSend = () => {
    if ((!message.trim() && pendingImages.length === 0) || isLoading) return;
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    onSend(message.trim(), images);
    setMessage('');
    if (onImagesChange) onImagesChange([]);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {pendingImages.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 2, pt: 1.5 }}>
          {pendingImages.map((url, i) => (
            <Box
              key={i}
              sx={{
                position: 'relative',
                borderRadius: 2,
                overflow: 'hidden',
                width: 56,
                height: 56,
                flexShrink: 0,
              }}
            >
              <Box
                component="img"
                src={url}
                alt={`Upload ${i + 1}`}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <IconButton
                size="small"
                onClick={() => removeImage(i)}
                disabled={isLoading}
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  color: '#fff',
                  p: 0.25,
                  minWidth: 0,
                  minHeight: 0,
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                }}
              >
                <DeleteIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Box>
          ))}
          {totalBytes > 0 && (
            <Typography
              variant="caption"
              sx={{ fontSize: 10, alignSelf: 'center', color: 'var(--theme-text-muted)' }}
            >
              {formatBytes(totalBytes)}
            </Typography>
          )}
        </Box>
      )}

      <Stack
        direction="row"
        alignItems="flex-end"
        spacing={1.5}
        sx={{
          borderTop: '1px solid var(--theme-border)',
          px: wide ? 2 : 1.5,
          pt: 1.5,
          pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          // Below md in wide mode (the /ai page) the leading actions + attach
          // button take their own row and the text field wraps to a full-width
          // row with the send button. The compact FAB panel keeps one row.
          flexWrap: { xs: wide ? 'wrap' : 'nowrap', md: 'nowrap' },
          rowGap: { xs: 1.5, md: 0 },
        }}
      >
        {leadingActions}

        {onImagesChange && supportsImages && (
          <Tooltip title={canAddMore ? 'Attach images' : `Max ${MAX_IMAGES} images`}>
            <span>
              <IconButton
                onClick={() => !processing && canAddMore && fileInputRef.current?.click()}
                disabled={isLoading || !canAddMore || processing}
                disableRipple
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                  bgcolor: 'transparent',
                  '&:hover': {
                    borderColor: 'var(--color-primary-50)',
                    bgcolor: 'var(--theme-bg-hover)',
                    color: 'var(--color-primary-50)',
                  },
                  '&.Mui-disabled': {
                    borderColor: 'var(--theme-border)',
                    bgcolor: 'transparent',
                    color: 'var(--theme-text-muted)',
                    opacity: 0.5,
                  },
                }}
              >
                {processing ? <CircularProgress size={16} /> : <ImageIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Stack
          direction="row"
          alignItems="flex-end"
          spacing={1.5}
          sx={{
            // Below md + wide: field + send button wrap together onto their own
            // full-width row (see container comment), keeping them side by side.
            flex: { xs: wide ? '1 1 100%' : '1 1 auto', md: '1 1 auto' },
            minWidth: 0,
          }}
        >
        <TextField
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          multiline
          maxRows={4}
          fullWidth
          size="small"
          disabled={isLoading}
        />

        {isLoading ? (
          <Tooltip title="Stop generating">
            <Button
              variant="outlined"
              color="error"
              onClick={onCancel}
              aria-label="Stop generating"
              sx={{
                height: 40,
                minWidth: 40,
                px: { xs: 1, sm: 2 },
                flexShrink: 0,
              }}
            >
              <StopIcon fontSize="small" />
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, ml: 1 }}>
                Stop
              </Box>
            </Button>
          </Tooltip>
        ) : (
          <Button
            variant="contained"
            color="primary"
            onClick={handleSend}
            disabled={!message.trim() && pendingImages.length === 0}
            aria-label="Send message"
            startIcon={<SendIcon />}
            sx={{
              height: 40,
              minWidth: 40,
              px: { xs: 1, sm: 2 },
              flexShrink: 0,
              '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: 0 },
            }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              Send
            </Box>
          </Button>
        )}
        </Stack>
      </Stack>

      {onImagesChange && supportsImages && (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
      )}
    </Box>
  );
}
