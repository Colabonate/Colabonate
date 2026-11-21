// ADR-311 D5 / FU-432: unit tests for the workspace canister client. No
// replica involved — a fake actor stands in for @icp-sdk/core/agent (ADR-346);
// the live deploy path is covered by the gated section of adr311-workspace-smoke.ts.
import { describe, it, expect, afterEach } from 'vitest'
import {
  canisterStateToServerStatus,
  createWorkspaceCanisterClient,
  deployWorkspace,
  isWorkspaceCanisterConfigured,
  isWorkspaceRelayInSyncError,
  WorkspaceCanisterError,
  workspaceServerIdentity,
  type WorkspaceCanisterActor,
} from './workspace-canister-client.js'

const CANISTER_ID = 'aaaaa-aa'

// ADR-322 D5: fixed 32-byte stand-in chain hash for fixtures that don't
// exercise the chain itself (workspace-canister-client is a thin relay — the
// chain math lives in the Rust canister, covered by its own `cargo test`).
const FAKE_CHAIN_HASH = new Uint8Array(32).fill(0xab)

function fakeActor(overrides: Partial<WorkspaceCanisterActor> = {}): WorkspaceCanisterActor {
  return {
    create_workspace: async () => ({ Ok: 7n }),
    start_workspace: async () => ({ Ok: { Running: null } }),
    check_workspace_status: async () => ({
      Ok: { state: { Running: null }, cycle_budget: 1000n, cycles_used: 250n, remaining_cycles: 750n },
    }),
    add_cycles: async () => ({
      Ok: { state: { Running: null }, cycle_budget: 2000n, cycles_used: 250n, remaining_cycles: 1750n },
    }),
    record_cycle_usage: async () => ({
      Ok: { state: { Suspended: null }, cycle_budget: 2000n, cycles_used: 2000n, remaining_cycles: 0n },
    }),
    complete_workspace: async () => ({ Ok: { Completed: null } }),
    expire_workspace: async () => ({ Ok: { Expired: null } }),
    get_outputs: async () => ({ Ok: [] }),
    get_workspace: async () => [{
      id: 7n,
      external_id: 'ws_cuid_123',
      buyer_pubkey: 'ab'.repeat(32),
      agent_profile_id: 'agent_1',
      state: { Running: null },
      has_config: false,
      last_buyer_action_at: [] as [],
      pending_tool_calls: [],
      next_approval_id: 0n,
      billing_model: 'ONE_TIME',
      authorized_signers: [] as string[],
    }],
    ensure_output_key: async () => ({ Ok: 'cd'.repeat(32) }),
    inject_config: async () => ({ Ok: null }),
    post_message: async (_id, _content, _timestamp, _signature) => ({
      Ok: { uri: 'inline:chat', signature: [] as [], metadata: '{"role":"assistant"}', created_at: 1n, output_type: 'chat', chain_hash: FAKE_CHAIN_HASH },
    }),
    call_tool: async (_id, _url, _body, _timestamp, _signature) => ({ Ok: { PendingApproval: 0n } }),
    approve_tool_call: async (_id, _approvalId, _timestamp, _signature) => ({
      Ok: { uri: 'https://api.example.com/x', signature: [] as [], metadata: '{}', created_at: 1n, output_type: 'tool', chain_hash: FAKE_CHAIN_HASH },
    }),
    destroy_workspace: async () => ({ Ok: null }),
    search_context: async () => ({ Ok: [] }),
    seed_context: async () => ({ Ok: null }),
    verify_audit_chain: async () => ({ Ok: true }),
    add_authorized_signer: async () => ({ Ok: null }),
    remove_authorized_signer: async () => ({ Ok: null }),
    ...overrides,
  }
}

const DEPLOY_ARGS = {
  workspaceId: 'ws_cuid_123',
  buyerPubkey: 'ab'.repeat(32),
  agentProfileId: 'agent_1',
  ttlSeconds: 3600,
}

describe('isWorkspaceCanisterConfigured', () => {
  afterEach(() => {
    delete process.env.ICP_WORKSPACE_CANISTER_ID
  })

  it('is false without ICP_WORKSPACE_CANISTER_ID', () => {
    delete process.env.ICP_WORKSPACE_CANISTER_ID
    expect(isWorkspaceCanisterConfigured()).toBe(false)
  })

  it('is true with ICP_WORKSPACE_CANISTER_ID set', () => {
    process.env.ICP_WORKSPACE_CANISTER_ID = CANISTER_ID
    expect(isWorkspaceCanisterConfigured()).toBe(true)
  })
})

describe('deployWorkspace (module entry point)', () => {
  it('returns null when no canister backend is configured', async () => {
    delete process.env.ICP_WORKSPACE_CANISTER_ID
    expect(await deployWorkspace(DEPLOY_ARGS)).toBeNull()
  })
})

describe('canisterStateToServerStatus', () => {
  it('maps every canister variant to the server enum', () => {
    expect(canisterStateToServerStatus({ PendingDeploy: null })).toBe('PENDING_DEPLOY')
    expect(canisterStateToServerStatus({ Running: null })).toBe('RUNNING')
    expect(canisterStateToServerStatus({ Suspended: null })).toBe('SUSPENDED')
    expect(canisterStateToServerStatus({ Completed: null })).toBe('COMPLETED')
    expect(canisterStateToServerStatus({ Expired: null })).toBe('EXPIRED')
  })
})

describe('createWorkspaceCanisterClient', () => {
  it('deployWorkspace creates then starts, returning both ids', async () => {
    const calls: string[] = []
    const actor = fakeActor({
      create_workspace: async (args) => {
        calls.push(`create:${args.external_id}:${args.ttl_seconds}:${args.cycle_budget}`)
        return { Ok: 42n }
      },
      start_workspace: async (id) => {
        calls.push(`start:${id}`)
        return { Ok: { Running: null } }
      },
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    const result = await client.deployWorkspace(DEPLOY_ARGS)
    expect(result).toEqual({ canisterId: CANISTER_ID, canisterWorkspaceId: '42' })
    expect(calls).toEqual(['create:ws_cuid_123:3600:0', 'start:42'])
  })

  it('deployWorkspace throws WorkspaceCanisterError on create rejection', async () => {
    const actor = fakeActor({
      create_workspace: async () => ({ Err: { InvalidArgs: { reason: 'ttl_seconds must be positive' } } }),
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    await expect(client.deployWorkspace(DEPLOY_ARGS)).rejects.toThrow(WorkspaceCanisterError)
    await expect(client.deployWorkspace(DEPLOY_ARGS)).rejects.toThrow(/ttl_seconds must be positive/)
  })

  it('deployWorkspace throws when start rejects after a successful create', async () => {
    const actor = fakeActor({
      start_workspace: async () => ({
        Err: { InvalidTransition: { action: 'start', from: { Running: null } } },
      }),
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    await expect(client.deployWorkspace(DEPLOY_ARGS)).rejects.toThrow(/InvalidTransition/)
  })

  it('checkWorkspaceStatus maps the canister status record', async () => {
    const client = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    const status = await client.checkWorkspaceStatus('7')
    expect(status).toEqual({ state: 'RUNNING', cycleBudget: 1000n, cyclesUsed: 250n, remainingCycles: 750n })
  })

  it('checkWorkspaceStatus throws on NotFound', async () => {
    const actor = fakeActor({ check_workspace_status: async () => ({ Err: { NotFound: null } }) })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    await expect(client.checkWorkspaceStatus('99')).rejects.toThrow(/NotFound/)
  })

  it('addCycles returns the post-topup status view', async () => {
    const client = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    const status = await client.addCycles('7', 1000n)
    expect(status.cycleBudget).toBe(2000n)
    expect(status.remainingCycles).toBe(1750n)
  })

  it('recordCycleUsage maps the suspended post-usage status view', async () => {
    const client = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    const status = await client.recordCycleUsage('7', 1750n)
    expect(status).toEqual({ state: 'SUSPENDED', cycleBudget: 2000n, cyclesUsed: 2000n, remainingCycles: 0n })
  })

  it('getOutputs maps opt signature to null and decodes fields', async () => {
    const sig = new Uint8Array([1, 2, 3])
    const actor = fakeActor({
      get_outputs: async () => ({
        Ok: [
          { uri: 'canister://out/1', signature: [] as [], metadata: '{}', created_at: 123n, output_type: 'text', chain_hash: FAKE_CHAIN_HASH },
          { uri: 'canister://out/2', signature: [sig] as [Uint8Array], metadata: '{}', created_at: 124n, output_type: 'file', chain_hash: FAKE_CHAIN_HASH },
        ],
      }),
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    const outputs = await client.getOutputs('7')
    expect(outputs).toHaveLength(2)
    expect(outputs[0]).toMatchObject({ outputType: 'text', uri: 'canister://out/1', signature: null, createdAt: 123n })
    expect(outputs[1].signature).toEqual(sig)
  })

  it('destroyWorkspace resolves on Ok and throws on NotDestroyable', async () => {
    const okClient = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    await expect(okClient.destroyWorkspace('7')).resolves.toBeUndefined()

    const errActor = fakeActor({
      destroy_workspace: async () => ({ Err: { NotDestroyable: { state: { Running: null } } } }),
    })
    const errClient = createWorkspaceCanisterClient(errActor, CANISTER_ID)
    await expect(errClient.destroyWorkspace('7')).rejects.toThrow(/NotDestroyable/)
  })

  it('searchContext maps rows and unwraps errors (ADR-321 D3)', async () => {
    const okActor = fakeActor({
      search_context: async () => ({
        Ok: [{ content: 'fact one', source: 'chat:user', score: 0.9, created_at: 5n }],
      }),
    })
    const okClient = createWorkspaceCanisterClient(okActor, CANISTER_ID)
    const results = await okClient.searchContext('7', 'query text', 5)
    expect(results).toEqual([{ content: 'fact one', source: 'chat:user', score: 0.9, createdAt: 5n }])

    const errActor = fakeActor({ search_context: async () => ({ Err: { ConfigNotInjected: null } }) })
    const errClient = createWorkspaceCanisterClient(errActor, CANISTER_ID)
    await expect(errClient.searchContext('7', 'query text', 5)).rejects.toThrow(/ConfigNotInjected/)
  })

  it('seedContext relays content+source and unwraps errors (ADR-352 D1/FU-607)', async () => {
    const calls: string[] = []
    const okActor = fakeActor({
      seed_context: async (id, content, source) => {
        calls.push(`${id}:${content}:${source}`)
        return { Ok: null }
      },
    })
    const okClient = createWorkspaceCanisterClient(okActor, CANISTER_ID)
    await expect(okClient.seedContext('7', 'previous step output', 'handoff:offer-a')).resolves.toBeUndefined()
    expect(calls).toEqual(['7:previous step output:handoff:offer-a'])

    const errActor = fakeActor({ seed_context: async () => ({ Err: { ConfigNotInjected: null } }) })
    const errClient = createWorkspaceCanisterClient(errActor, CANISTER_ID)
    await expect(errClient.seedContext('7', 'x', 'handoff:offer-a')).rejects.toThrow(/ConfigNotInjected/)
  })

  it('completeWorkspace / expireWorkspace return the mapped state', async () => {
    const client = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    await expect(client.completeWorkspace('7')).resolves.toBe('COMPLETED')
    await expect(client.expireWorkspace('7')).resolves.toBe('EXPIRED')
  })

  it('ensureOutputKey / injectConfig unwrap the canister results', async () => {
    const calls: string[] = []
    const actor = fakeActor({
      inject_config: async (id, sender, ciphertext) => {
        calls.push(`${id}:${sender}:${ciphertext}`)
        return { Ok: null }
      },
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    await expect(client.ensureOutputKey()).resolves.toBe('cd'.repeat(32))
    await expect(client.injectConfig('7', 'ab'.repeat(32), 'Zm9v')).resolves.toBeUndefined()
    expect(calls).toEqual([`7:${'ab'.repeat(32)}:Zm9v`])
  })

  it('injectConfig surfaces ConfigAlreadyInjected', async () => {
    const actor = fakeActor({ inject_config: async () => ({ Err: { ConfigAlreadyInjected: null } }) })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    await expect(client.injectConfig('7', 'ab'.repeat(32), 'Zm9v')).rejects.toThrow(/ConfigAlreadyInjected/)
  })

  // FU-434 Slice C: buyer-signed harness actions.
  it('postMessage relays content/timestamp/signature and maps the output', async () => {
    const calls: string[] = []
    const actor = fakeActor({
      post_message: async (id, content, timestamp, signature) => {
        calls.push(`${id}:${content}:${timestamp}:${signature.length}`)
        return { Ok: { uri: 'inline:chat', signature: [] as [], metadata: '{"role":"assistant"}', created_at: 5n, output_type: 'chat', chain_hash: FAKE_CHAIN_HASH } }
      },
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    const out = await client.postMessage('7', 'hello', 42n, new Uint8Array(64))
    expect(out).toMatchObject({ outputType: 'chat', uri: 'inline:chat', createdAt: 5n })
    expect(calls).toEqual(['7:hello:42:64'])
  })

  it('callTool maps Executed and PendingApproval outcomes', async () => {
    const executedActor = fakeActor({
      call_tool: async () => ({
        Ok: { Executed: { uri: 'https://api.example.com/x', signature: [] as [], metadata: '{}', created_at: 9n, output_type: 'tool', chain_hash: FAKE_CHAIN_HASH } },
      }),
    })
    const executed = await createWorkspaceCanisterClient(executedActor, CANISTER_ID).callTool('7', 'https://api.example.com/x', null, 1n, new Uint8Array(64))
    expect(executed).toMatchObject({ executed: { outputType: 'tool' } })

    const parked = await createWorkspaceCanisterClient(fakeActor(), CANISTER_ID).callTool('7', 'https://danger.example.com/x', '{}', 1n, new Uint8Array(64))
    expect(parked).toEqual({ pendingApprovalId: 0n })
  })

  it('approveToolCall maps the executed output and surfaces ApprovalNotFound', async () => {
    const client = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    await expect(client.approveToolCall('7', 0n, 2n, new Uint8Array(64))).resolves.toMatchObject({ outputType: 'tool' })
    const errActor = fakeActor({ approve_tool_call: async () => ({ Err: { ApprovalNotFound: { id: 99n } } }) })
    await expect(createWorkspaceCanisterClient(errActor, CANISTER_ID).approveToolCall('7', 99n, 2n, new Uint8Array(64)))
      .rejects.toThrow(/ApprovalNotFound/)
  })

  it('verifyAuditChain relays the intact/broken flag', async () => {
    const intactClient = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    await expect(intactClient.verifyAuditChain('7')).resolves.toBe(true)

    const brokenActor = fakeActor({ verify_audit_chain: async () => ({ Ok: false }) })
    await expect(createWorkspaceCanisterClient(brokenActor, CANISTER_ID).verifyAuditChain('7')).resolves.toBe(false)
  })

  it('getOutputs surfaces the ADR-322 D5 chain_hash on each output', async () => {
    const actor = fakeActor({
      get_outputs: async () => ({
        Ok: [{ uri: 'canister://out/1', signature: [] as [], metadata: '{}', created_at: 123n, output_type: 'text', chain_hash: FAKE_CHAIN_HASH }],
      }),
    })
    const outputs = await createWorkspaceCanisterClient(actor, CANISTER_ID).getOutputs('7')
    expect(outputs[0].chainHash).toEqual(FAKE_CHAIN_HASH)
  })

  it('signed actions surface ReplayRejected and SignatureVerificationFailed', async () => {
    const replayActor = fakeActor({ post_message: async () => ({ Err: { ReplayRejected: { reason: 'stale' } } }) })
    await expect(createWorkspaceCanisterClient(replayActor, CANISTER_ID).postMessage('7', 'x', 1n, new Uint8Array(64)))
      .rejects.toThrow(/ReplayRejected/)
    const sigActor = fakeActor({ post_message: async () => ({ Err: { SignatureVerificationFailed: { reason: 'nope' } } }) })
    await expect(createWorkspaceCanisterClient(sigActor, CANISTER_ID).postMessage('7', 'x', 1n, new Uint8Array(64)))
      .rejects.toThrow(/SignatureVerificationFailed/)
  })

  it('getWorkspaceView maps the redacted view and null', async () => {
    const client = createWorkspaceCanisterClient(fakeActor(), CANISTER_ID)
    const view = await client.getWorkspaceView('7')
    expect(view).toMatchObject({ externalId: 'ws_cuid_123', state: 'RUNNING', hasConfig: false })
    const empty = createWorkspaceCanisterClient(fakeActor({ get_workspace: async () => [] }), CANISTER_ID)
    await expect(empty.getWorkspaceView('99')).resolves.toBeNull()
  })

  it('completeWorkspace throws on canister rejection', async () => {
    const actor = fakeActor({
      complete_workspace: async () => ({
        Err: { InvalidTransition: { action: 'complete', from: { PendingDeploy: null } } },
      }),
    })
    const client = createWorkspaceCanisterClient(actor, CANISTER_ID)
    await expect(client.completeWorkspace('7')).rejects.toThrow(/InvalidTransition/)
  })
})

describe('workspaceServerIdentity', () => {
  it('derives a deterministic Ed25519 principal from a 32-byte hex seed', () => {
    const seed = 'ab'.repeat(32)
    const a = workspaceServerIdentity(seed).getPrincipal().toText()
    const b = workspaceServerIdentity(seed).getPrincipal().toText()
    expect(a).toBe(b)
    expect(a).not.toBe('2vxsx-fae') // not anonymous
    expect(workspaceServerIdentity('cd'.repeat(32)).getPrincipal().toText()).not.toBe(a)
  })

  it('rejects malformed seeds', () => {
    expect(() => workspaceServerIdentity('too-short')).toThrow(/64 hex chars/)
    expect(() => workspaceServerIdentity('zz'.repeat(32))).toThrow(/64 hex chars/)
  })
})

describe('isWorkspaceRelayInSyncError', () => {
  it('treats NotFound and InvalidTransition as in-sync, everything else as failure', () => {
    const inSyncNotFound = new WorkspaceCanisterError('expire_workspace', { NotFound: null })
    const inSyncTransition = new WorkspaceCanisterError('complete_workspace', {
      InvalidTransition: { action: 'complete', from: { Completed: null } },
    })
    const real = new WorkspaceCanisterError('expire_workspace', {
      NotExpired: { now: 1n, expires_at: 2n },
    })
    expect(isWorkspaceRelayInSyncError(inSyncNotFound)).toBe(true)
    expect(isWorkspaceRelayInSyncError(inSyncTransition)).toBe(true)
    expect(isWorkspaceRelayInSyncError(real)).toBe(false)
    expect(isWorkspaceRelayInSyncError(new Error('network down'))).toBe(false)
    expect(isWorkspaceRelayInSyncError('bogus')).toBe(false)
  })
})
