import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildGuestSystemPrompt, buildAdapterContextPrefix } from './system-prompt.js';

const BASE = { identityLevel: 1 };

describe('buildSystemPrompt — escrow copy (F2)', () => {
  it('defaults to direct-pay copy and never promises escrow', () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain('never holds the funds');
    expect(prompt.toLowerCase()).not.toContain('escrow is enabled');
  });

  it('only injects the escrow line when escrowEnabled is true', () => {
    const prompt = buildSystemPrompt({ ...BASE, escrowEnabled: true });
    expect(prompt).toContain('Escrow is enabled on this deployment');
    expect(prompt).not.toContain('never holds the funds');
  });
});

describe('buildSystemPrompt — identity & privacy (F9)', () => {
  it('does not leak a pubkey into the prompt', () => {
    const pubkey = 'a'.repeat(64);
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).not.toContain(pubkey);
    // The builder interface no longer accepts a pubkey at all.
    expect(prompt).toContain('Never ask for or include a pubkey');
  });

  it('states the identity level with its meaning', () => {
    expect(buildSystemPrompt({ identityLevel: 2 })).toContain('L2 (peer-verified)');
  });
});

describe('buildSystemPrompt — safety rules (F3)', () => {
  it('requires explicit confirmation before money/vote/publish/delete actions', () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain('wait for an explicit "yes" in the user\'s NEXT message');
    expect(prompt).toContain('moves money');
  });

  it('tells the model to report tool failures and retry at most once', () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain('retry at most once');
  });
});

describe('buildSystemPrompt — capabilities (F9)', () => {
  it('lists only the tools actually available', () => {
    const prompt = buildSystemPrompt({ ...BASE, availableTools: ['search_offers', 'create_offer', 'submit_private_verdict'] });
    expect(prompt).toContain('search_offers');
    expect(prompt).toContain('create_offer');
    expect(prompt).toContain('submit_private_verdict');
    expect(prompt).not.toContain('vote_proposal');
  });

  it('omits the capability block when no tools are given', () => {
    expect(buildSystemPrompt(BASE)).not.toContain('Registered tools:');
  });
});

describe('buildSystemPrompt — categories (F8)', () => {
  it('uses the provided live slugs', () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      categories: [
        { slug: 'services/development', offerType: 'SERVICE' },
        { slug: 'goods/electronics', offerType: 'PRODUCT' },
      ],
    });
    expect(prompt).toContain('services/development');
    expect(prompt).toContain('goods/electronics');
    expect(prompt).not.toContain('services/programming');
  });

  it('falls back to a valid static list when no taxonomy is available', () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain('services/other');
    expect(prompt).toContain('goods/home-garden');
  });
});

describe('buildSystemPrompt — language (F10)', () => {
  it('replies in the user language and keeps stored content as provided', () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain('Reply in the language the user writes in');
    expect(prompt).not.toContain('ALWAYS respond in English');
  });
});

describe('buildGuestSystemPrompt (F7)', () => {
  it('has no tool rules and is honest about having no account access', () => {
    const prompt = buildGuestSystemPrompt();
    expect(prompt).toContain('NOT signed in');
    expect(prompt).toContain('You have no tools');
    expect(prompt).not.toContain('Registered tools:');
    expect(prompt).not.toContain('Safety rules');
  });

  it('appends custom instructions when provided', () => {
    const prompt = buildGuestSystemPrompt({ customInstructions: 'Be brief.' });
    expect(prompt).toContain('Be brief.');
  });

  it('reflects an escrow-enabled deployment instead of hardcoding direct-pay', () => {
    expect(buildGuestSystemPrompt()).toContain('never holds the funds');
    expect(buildGuestSystemPrompt({ escrowEnabled: true })).toContain('Escrow is enabled');
  });
});

describe('buildAdapterContextPrefix', () => {
  it('stays honest that Colabonate tools are unavailable', () => {
    const prompt = buildAdapterContextPrefix({ identityLevel: 1 });
    expect(prompt).toContain('do NOT have access to Colabonate\'s own tools');
    expect(prompt).not.toContain('never ask for or include a pubkey');
  });
});
