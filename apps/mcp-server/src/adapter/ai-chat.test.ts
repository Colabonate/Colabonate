import { describe, expect, it, vi } from 'vitest';

// F1: simulate a deployment where a real hosted LLM is configured. Everything
// else stays the real config module, so the only variable under test is
// PLATFORM_LLM_CONFIGURED.
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    PLATFORM_LLM_CONFIGURED: true,
    LLM_BASE_URL: 'https://hosted.example/v1',
    LLM_API_KEY: 'hosted-secret',
    LLM_MODEL_OVERRIDE: 'deepseek-test',
  };
});

import { createAdapterServer, ENTITY_RESULT_KINDS, parseToolResult, resolveProvider } from './ai-chat.js';

describe('resolveProvider — hosted env chain is credit-gated (F1)', () => {
  it('routes an unresolved request to platform when a hosted LLM is configured', async () => {
    const resolved = await resolveProvider('openai', undefined, null);
    expect(resolved.kind).toBe('openai');
    if (resolved.kind !== 'openai') return;
    expect(resolved.platform).toBe(true);
    expect(resolved.info.provider).toBe('platform');
    expect(resolved.endpoint.baseUrl).toBe('https://hosted.example/v1');
  });

  it('still honors a real BYOK config before the env chain', async () => {
    const resolved = await resolveProvider('openai', undefined, {
      provider: 'openai',
      baseUrl: 'https://byok.example/v1',
      model: 'my-model',
      apiKey: 'byok-key',
      adapterId: null,
      runtime: null,
      adapterArgs: null,
    });
    expect(resolved.kind).toBe('openai');
    if (resolved.kind !== 'openai') return;
    expect(resolved.platform).toBeFalsy();
    expect(resolved.info.provider).toBe('openai');
    expect(resolved.endpoint.baseUrl).toBe('https://byok.example/v1');
  });
});

describe('parseToolResult — result kinds (F11)', () => {
  it('maps bounty task lists and single tasks', () => {
    expect(parseToolResult('list_bounties', JSON.stringify({ tasks: [{ id: 'b1', title: 'Job' }] })).kind).toBe('bounties');
    expect(parseToolResult('get_bounty', JSON.stringify({ task: { id: 'b1' } })).kind).toBe('bounties');
    expect(parseToolResult('my_bounty_applications', JSON.stringify({ applications: [{ id: 'a1' }] })).kind).toBe('bounty_applications');
  });

  it('maps a ticket payment status', () => {
    const payload = parseToolResult('get_ticket_payment_status', JSON.stringify({ status: 'PAID', paid: true, rail: 'LIGHTNING' }));
    expect(payload.kind).toBe('payment_status');
  });

  it('keeps pending images and image uploads out of the unknown bucket', () => {
    expect(parseToolResult('get_pending_images', JSON.stringify({ images: ['pending:0'] })).kind).toBe('pending_images');
    expect(parseToolResult('upload_image', JSON.stringify({ success: true, url: 'https://x/y.png' })).kind).toBe('image_uploaded');
  });
});

describe('result-kind contract (F11)', () => {
  // Mirror of the EntityPayload union in
  // apps/colabonate-app/src/components/ai-assistant/ai-assistant.types.ts.
  // Update both together when a kind is added.
  const FRONTEND_ENTITY_KINDS = [
    'offers', 'cooperations', 'companies', 'tickets', 'proposals', 'daos',
    'dao_members', 'dao_treasury', 'bounties', 'bounty_applications',
    'payment_status', 'pending_images', 'image_uploaded',
    'created', 'updated', 'deleted', 'unknown',
  ];

  it('exposes every kind the frontend renders', () => {
    for (const kind of FRONTEND_ENTITY_KINDS) {
      expect(ENTITY_RESULT_KINDS).toContain(kind);
    }
  });

  it('has no duplicate kinds', () => {
    expect(new Set(ENTITY_RESULT_KINDS).size).toBe(ENTITY_RESULT_KINDS.length);
  });
});

describe('chat tool surface (F3)', () => {
  it('does not register the verdict / arbiter-accept tools', async () => {
    const { client, ready, server } = createAdapterServer({ pubkey: 'p'.repeat(64), token: 't', identityLevel: 1 });
    await ready;
    try {
      const list = await client.listTools();
      const names = (list.tools ?? []).map((tool) => tool.name);
      expect(names).not.toContain('submit_private_verdict');
      expect(names).not.toContain('accept_ticket_arbiter');
      expect(names).toContain('search_offers');
      expect(names).toContain('create_offer');
    } finally {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
});
