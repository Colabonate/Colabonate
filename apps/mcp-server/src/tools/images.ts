import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ToolContext } from './offers.js';
import { FULL_GATE, type ToolGate } from './gate.js';

export interface ImageToolContext {
  pendingImages: string[];
}

const uploadImageSchema = z.object({
  dataUrl: z.string().describe('Base64 data URL of the image (data:image/...) to validate and store. Get this from get_pending_images first if the user attached images.'),
});

const getPendingImagesSchema = z.object({});

// ADR-389: the model must never receive the raw base64 data URL. A 300 KB image
// becomes ~400k characters of (text-tokenised) tool output and blows the context
// window on its own. The tool now returns a compact `pending:N` reference; the
// create/update tools resolve it back to the real URL server-side, so the bytes
// never enter the model context.
export function resolveImageRefs(images: string[] | undefined, pendingImages: string[]): string[] | undefined {
  if (!images) return undefined;
  return images.map((value) => {
    const match = /^pending:(\d+)$/.exec(value);
    if (!match) return value;
    const url = pendingImages[Number(match[1])];
    if (!url) throw new Error(`Unknown image reference "${value}" — call get_pending_images again.`);
    return url;
  });
}

export function registerImageTools(server: McpServer, ctx: ToolContext & ImageToolContext, gate: ToolGate = FULL_GATE) {
  // get_pending_images is a chat-attachment artifact of the in-app turn
  // (FULL_GATE); external MCP sessions have no attached chat images and expose
  // only upload_image (gated on images:write).
  if (gate === FULL_GATE)
    server.registerTool(
      'get_pending_images',
      {
        description: 'Get images that the user attached to their current chat message. Returns a compact reference for each image (e.g. "pending:0"), its size and type. Pass these references in the "images" parameter of create_offer, update_offer, create_cooperation, or update_cooperation — the image data is resolved on the server. ALWAYS call this first when the user mentions images or photos they want to use.',
        inputSchema: getPendingImagesSchema,
      },
      async () => {
        if (ctx.pendingImages.length === 0) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ images: [], hint: 'No images attached to this message. Ask the user to attach images.' }) }] };
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              images: ctx.pendingImages.map((url, i) => ({
                ref: `pending:${i}`,
                mimeType: /^data:(image\/[a-z0-9.+-]+)/i.exec(url)?.[1] ?? 'image',
                sizeBytes: Math.round((url.split(',')[1]?.length ?? 0) * 3 / 4),
              })),
              hint: 'Pass these "pending:N" refs in the images[] array of create_offer, update_offer, create_cooperation, or update_cooperation. Never invent a ref.',
            }),
          }],
        };
      }
    );

  if (gate.canWrite('images'))
    server.registerTool(
    'upload_image',
    {
      description: 'Validate and store an image for use in offers or cooperations. Accepts a base64 data URL. Returns the validated URL. Use get_pending_images first if the user attached images to their message — this tool is for additional images not already in the conversation.',
      inputSchema: uploadImageSchema,
    },
    async ({ dataUrl }) => {
      if (!dataUrl.startsWith('data:image/')) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid image format. Must be a data URL starting with data:image/' }) }] };
      }

      const MAX_SIZE = 300 * 1024;
      if (dataUrl.length > MAX_SIZE) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Image too large (${Math.round(dataUrl.length / 1024)} KB). Maximum is 300 KB after optimization.` }) }] };
      }

      try {
        const data = await callApi<{ success: boolean; url: string }>('/api/upload/image', {
          method: 'POST',
          body: JSON.stringify({ image: dataUrl }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, url: data.url }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Upload failed: ${err}` }) }] };
      }
    }
  );
}
