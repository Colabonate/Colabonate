// ADR-311 D2/D5 (backend) + ADR-326 D5 / FU-447 (status bridge) + ADR-314
// minimal chat slice (this session): a single Direct chat per workspace,
// relayed through the canister's post_message (FU-434 Slice C). The full
// ADR-314 scope (folder tree, multi-chat, roster, slash-commands, roles,
// context indexing) stays deferred — see the ADR's Implementation Record for
// the scope cut and why it's real value on its own (buyer can now actually
// talk to the agent, which FU-447 explicitly left unbuilt).
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Divider, TextField, Typography } from '@mui/material'
import { ChevronDown, Clock, Cpu, ExternalLink, Frame, Send, UserPlus, Users, Wrench } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { NotFoundState } from '../../components/NotFoundState'
import { Seo } from '../../components/Seo'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { BountyBriefCard, bountyBriefAsMessage } from '../../components/bounties/BountyBriefCard'
import { getWorkspaceSignerPubkey } from '../../lib/workspaceChat'
import { apiCall, ApiError } from '../../lib/api'
import {
  useWorkspace, useWorkspaceOutputs, useWorkspaceMembers, useCompleteWorkspace, useSendWorkspaceMessage,
  useInjectWorkspaceConfig, usePayMandatoryFunding, useInviteWorkspaceMember, useRemoveWorkspaceMember,
  useRegisterWorkspaceSigner, parseTimeline, type WorkspaceStatus,
} from '../../hooks/useWorkspaceQueries'

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  PENDING_DEPLOY: 'Deploying',
  RUNNING: 'Running',
  SUSPENDED: 'Suspended (out of cycles)',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
}

const STATUS_COLOR: Record<WorkspaceStatus, 'default' | 'warning' | 'success' | 'error'> = {
  PENDING_DEPLOY: 'default',
  RUNNING: 'success',
  SUSPENDED: 'warning',
  COMPLETED: 'default',
  EXPIRED: 'error',
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

export function WorkspaceDetail() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()

  const { data: workspace, isLoading, error } = useWorkspace(workspaceId)
  const { data: outputs = [] } = useWorkspaceOutputs(workspaceId)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const completeWorkspace = useCompleteWorkspace()
  const sendMessage = useSendWorkspaceMessage(workspaceId)
  const injectConfig = useInjectWorkspaceConfig(workspaceId)
  const payMandatoryFunding = usePayMandatoryFunding(workspaceId)
  const inviteMember = useInviteWorkspaceMember(workspaceId)
  const removeMember = useRemoveWorkspaceMember(workspaceId)
  const registerSigner = useRegisterWorkspaceSigner(workspaceId)
  const [actionError, setActionError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [inviteDraft, setInviteDraft] = useState('')
  const [canvasBusy, setCanvasBusy] = useState(false)
  const [canvasError, setCanvasError] = useState<string | null>(null)

  if (isLoading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <CircularProgress size={24} />
      </PageContainer>
    )
  }

  if (error || !workspace) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <NotFoundState
          icon={<Cpu size={48} />}
          title="Workspace not found"
          message="This workspace may not exist, or you don't have access to it."
          primary={{ label: 'Back to tickets', to: '/tickets' }}
          secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
        />
      </PageContainer>
    )
  }

  // ADR-349 D1: server-computed — an invited collaborator is neither buyer
  // nor seller, so `isSeller = !isBuyer` (the pre-D1 inference, safe only
  // when those were the sole two roles that could reach this page) would
  // misclassify them.
  const isBuyer = workspace.viewerRole === 'buyer'
  const isSeller = workspace.viewerRole === 'seller'
  // FU-589: an invited collaborator (ADR-349 D1) with a registered signer
  // gets full write parity with the buyer.
  const isCollaborator = workspace.viewerRole === 'collaborator'
  const canComplete = isBuyer && (workspace.status === 'RUNNING' || workspace.status === 'SUSPENDED')

  // ADR-314 (+ FU-589 for collaborators): chat only works when this device's
  // burner key matches the pubkey the canister trusts for THIS viewer (see
  // lib/workspaceChat.ts) — `viewerSignerPubkey` is canisterBuyerPubkey for
  // the buyer, or this collaborator's own registered signer (null until they
  // register one). The buyer's key is baked in at workspace creation and
  // can't be changed; a collaborator can always register a new device.
  const localSignerPubkey = getWorkspaceSignerPubkey()
  // ADR-351: null (pre-FU-376 legacy workspace) counts as already funded.
  const fundingPending = workspace.mandatoryFunding != null && workspace.mandatoryFunding.status !== 'PAID'
  const canChat = (isBuyer || isCollaborator)
    && workspace.status === 'RUNNING'
    && Boolean(workspace.canisterWorkspaceId)
    && workspace.viewerSignerPubkey === localSignerPubkey
    && !fundingPending
  const timeline = parseTimeline(outputs)

  async function handleRegisterSigner() {
    setActionError(null)
    try {
      await registerSigner.mutateAsync(localSignerPubkey)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not register this device')
    }
  }

  async function handleComplete() {
    setActionError(null)
    try {
      await completeWorkspace.mutateAsync(workspace!.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not complete workspace')
    }
  }

  function handlePayFunding() {
    const funding = workspace!.mandatoryFunding
    if (!funding) return
    payMandatoryFunding.pay(funding.id, funding.rail, funding.bolt11)
  }

  async function handleInjectConfig() {
    if (!workspace) return
    setActionError(null)
    try {
      await injectConfig.mutateAsync({ offerId: workspace.offerId, ticketId: workspace.ticketId || null })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not inject the agent config')
    }
  }

  // ADR-370 D8 (Phase 5 / FU-674): fetch the workspace-keyed one-time SSO
  // login URL (mirrors the ticket canvas-url button) and open it in a new tab.
  async function handleOpenCanvas() {
    if (canvasBusy || !workspace) return
    setCanvasBusy(true)
    setCanvasError(null)
    try {
      const res = await apiCall('/api/workspaces/' + workspace.id + '/canvas-url')
      const data = await res.json()
      if (typeof data?.url === 'string') window.open(data.url, '_blank', 'noopener')
    } catch (e) {
      if (e instanceof ApiError && e.data?.error === 'CANVAS_PRIVATE') {
        setCanvasError('Dieses Canvas ist privat.')
      } else if (e instanceof ApiError && e.data?.error === 'CANVAS_NOT_READY') {
        setCanvasError('Das Canvas ist noch nicht bereit.')
      } else if (e instanceof ApiError) {
        setCanvasError(e.data?.message ?? e.message)
      } else {
        setCanvasError(e instanceof Error ? e.message : 'Could not open the canvas')
      }
    } finally {
      setCanvasBusy(false)
    }
  }

  async function handleSend() {
    const content = draft.trim()
    if (!content || !workspace?.canisterWorkspaceId) return
    setActionError(null)
    try {
      await sendMessage.mutateAsync({ canisterWorkspaceId: workspace.canisterWorkspaceId, content })
      setDraft('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not send message')
    }
  }

  async function handleInvite() {
    const targetPubkey = inviteDraft.trim().toLowerCase()
    if (!HEX_PUBKEY_RE.test(targetPubkey)) {
      setActionError('Enter a 64-character hex pubkey')
      return
    }
    setActionError(null)
    try {
      await inviteMember.mutateAsync(targetPubkey)
      setInviteDraft('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not invite collaborator')
    }
  }

  async function handleRemoveMember(targetPubkey: string) {
    setActionError(null)
    try {
      await removeMember.mutateAsync(targetPubkey)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not remove collaborator')
    }
  }

  return (
    <PageContainer size="narrow" spacing="lg">
      <Seo noindex />
      <PageHeader
        icon={<Cpu />}
        title="Agent Workspace"
        subtitle={`#${workspace.id.slice(0, 8)}`}
        onBack={() => navigate(`/tickets/${workspace.ticketId}`)}
        backLabel="Back to ticket"
      />

      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-border)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
            <Chip label={STATUS_LABEL[workspace.status]} color={STATUS_COLOR[workspace.status]} size="small" sx={{ fontWeight: 600 }} />
            {canComplete && (
              <Button size="small" variant="outlined" onClick={handleComplete} disabled={completeWorkspace.isPending}>
                {completeWorkspace.isPending ? 'Completing…' : 'Mark as complete'}
              </Button>
            )}
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <Field label="Cycle budget">
              {workspace.cycleBudgetSats != null ? <SatsAmount sats={workspace.cycleBudgetSats} size="sm" /> : <Typography variant="body2" color="text.secondary">Not funded yet</Typography>}
            </Field>
            <Field label="Canister">
              <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                {workspace.canisterId ?? '— not deployed —'}
              </Typography>
            </Field>
            <Field label="Created">
              <Typography variant="body2">{formatTimestamp(workspace.createdAt)}</Typography>
            </Field>
            <Field label="Activated">
              <Typography variant="body2">{formatTimestamp(workspace.activatedAt)}</Typography>
            </Field>
            <Field label="Completed">
              <Typography variant="body2">{formatTimestamp(workspace.completedAt)}</Typography>
            </Field>
            <Field label="Expires">
              <Typography variant="body2">{formatTimestamp(workspace.expiresAt)}</Typography>
            </Field>
          </Box>
        </Box>

        {/* ADR-370 D8 (Phase 5 / FU-674): collaboration-canvas open parity —
            workspace-anchored hosted canvases (ticket AND coop) open through
            the workspace-keyed SSO route instead of the ticket one. */}
        {workspace.canvasProvider === 'doop-hosted' && (
          <Box sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-border)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Frame size={20} /> Collaboration Canvas
              </Typography>
              {workspace.canvasProvisioningStatus === 'ready' ? (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleOpenCanvas}
                  disabled={canvasBusy}
                  endIcon={<ExternalLink size={14} />}
                >
                  {canvasBusy ? 'Opening…' : 'Open Canvas'}
                </Button>
              ) : (
                <Button variant="outlined" size="small" disabled startIcon={<Clock size={14} />}>
                  Canvas wird vorbereitet…
                </Button>
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              Colabonate-hosted doop canvas — opened in a new tab.
            </Typography>
            {canvasError && (
              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'var(--color-status-error)' }}>
                {canvasError}
              </Typography>
            )}
          </Box>
        )}

        {/* ADR-349 D1/D2: the buyer can invite a third party (e.g. the
            Agent-Setup provider) as a read-scoped collaborator. Write access
            (chat/tool-calls) stays out of scope until FU-589 (canister
            multi-signer support) ships — collaborators see this workspace,
            they cannot yet act in it. */}
        <Box sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-border)' }}>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Users size={20} /> Collaborators
          </Typography>

          {isBuyer && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Collaborator pubkey (hex)"
                value={inviteDraft}
                onChange={e => setInviteDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInvite() } }}
                disabled={inviteMember.isPending}
              />
              <Button
                variant="outlined"
                onClick={handleInvite}
                disabled={inviteMember.isPending || !inviteDraft.trim()}
                startIcon={inviteMember.isPending ? <CircularProgress size={16} /> : <UserPlus size={16} />}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Invite
              </Button>
            </Box>
          )}

          {members.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No collaborators invited yet — the agent-setup provider already has read access as the ticket seller.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {members.map(m => (
                <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                    {m.member.name ?? `${m.pubkey.slice(0, 16)}…`}
                  </Typography>
                  {isBuyer && (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => handleRemoveMember(m.pubkey)}
                      disabled={removeMember.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {isBuyer && fundingPending && workspace.mandatoryFunding && (
          <Box sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-warning, #f0ad4e)' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Pay to activate</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              This workspace needs a mandatory minimum funding before you can chat with the agent — it covers the estimated
              ICP compute for this job, paid directly to Colabonate.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <SatsAmount sats={workspace.mandatoryFunding.amountSats} size="sm" />
              <Button
                size="small"
                variant="contained"
                onClick={handlePayFunding}
                disabled={payMandatoryFunding.state === 'paying'}
              >
                {payMandatoryFunding.state === 'paying' ? 'Paying…' : 'Pay now'}
              </Button>
            </Box>
            {payMandatoryFunding.error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>{payMandatoryFunding.error}</Alert>
            )}
          </Box>
        )}

        {isSeller && workspace.status === 'RUNNING' && Boolean(workspace.canisterWorkspaceId) && (
          <Box sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-border)' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Agent Configuration</Typography>
            {workspace.hasConfig ? (
              <Typography variant="body2" color="text.secondary">
                Configuration injected — your agent can respond to chat messages.
              </Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  This workspace is running but hasn't received its LLM configuration yet — the buyer can't chat with your agent until you inject it.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleInjectConfig}
                  disabled={injectConfig.isPending}
                >
                  {injectConfig.isPending ? 'Injecting…' : 'Inject Config'}
                </Button>
              </>
            )}
          </Box>
        )}

        {/* ADR-397 D6: the bounty brief this agent was hired for. The buyer
            drops it into the composer and sends it through the normal signed
            chat relay — never auto-sent, since every agent turn costs cycles. */}
        {workspace.bountyBrief && (
          <BountyBriefCard
            brief={workspace.bountyBrief}
            onUseAsMessage={canChat && timeline.length === 0 && !draft.trim()
              ? () => setDraft(bountyBriefAsMessage(workspace.bountyBrief!))
              : undefined}
          />
        )}

        {(isBuyer || isCollaborator) && (
          <Box sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-border)' }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>Chat</Typography>

            {!canChat ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  {workspace.status !== 'RUNNING'
                    ? 'Chat is available once the workspace is running.'
                    : !workspace.canisterWorkspaceId
                      ? 'No canister backend deployed for this workspace yet.'
                      : fundingPending
                        ? 'Pay the mandatory funding above to unlock chat.'
                        : isCollaborator
                          ? 'Register this device to chat as an invited collaborator.'
                          : 'This workspace was opened with a different chat key on another device or before chat support was added — it cannot be reused here.'}
                </Typography>
                {/* FU-589: unlike the buyer's canisterBuyerPubkey (baked in at
                    creation, no fix available), a collaborator can always
                    register — that's the whole point of this self-service flow. */}
                {isCollaborator && workspace.status === 'RUNNING' && Boolean(workspace.canisterWorkspaceId) && !fundingPending && (
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ mt: 1.5 }}
                    onClick={handleRegisterSigner}
                    disabled={registerSigner.isPending}
                  >
                    {registerSigner.isPending ? 'Registering…' : 'Register this device'}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2, maxHeight: 420, overflowY: 'auto' }}>
                  {timeline.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No messages yet — say hello to your agent.</Typography>
                  ) : (
                    timeline.map((item, i) =>
                      item.kind === 'chat' ? (
                        <Box
                          key={i}
                          sx={{
                            alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
                            maxWidth: '80%',
                            p: 1.5,
                            borderRadius: 2,
                            bgcolor: item.role === 'user' ? 'var(--theme-primary-container, action.selected)' : 'var(--theme-surface-variant, action.hover)',
                          }}
                        >
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
                            {item.role === 'user' ? 'You' : 'Agent'}
                          </Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{item.content}</Typography>
                        </Box>
                      ) : (
                        // ADR-314 D5: tool activity, woven inline instead of only
                        // showing up in the raw Outputs list below.
                        <Accordion key={i} disableGutters sx={{ alignSelf: 'flex-start', maxWidth: '90%', bgcolor: 'transparent', '&:before': { display: 'none' } }}>
                          <AccordionSummary expandIcon={<ChevronDown size={16} />} sx={{ minHeight: 36, px: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Wrench size={14} />
                              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                                {item.url}{item.status != null ? ` · ${item.status}` : ''}
                              </Typography>
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails sx={{ pt: 0 }}>
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                              {item.body ?? '(no response body)'}
                            </Typography>
                          </AccordionDetails>
                        </Accordion>
                      )
                    )
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Message the agent…"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    disabled={sendMessage.isPending}
                    multiline
                    maxRows={4}
                  />
                  <Button
                    variant="contained"
                    onClick={handleSend}
                    disabled={sendMessage.isPending || !draft.trim()}
                    sx={{ minWidth: 44, px: 1.5 }}
                  >
                    {sendMessage.isPending ? <CircularProgress size={18} color="inherit" /> : <Send size={18} />}
                  </Button>
                </Box>
              </>
            )}
          </Box>
        )}

        <Box>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Outputs ({outputs.length})</Typography>
          {!workspace.canisterWorkspaceId ? (
            <Typography variant="body2" color="text.secondary">
              No canister backend deployed for this workspace yet — outputs will appear here once one is.
            </Typography>
          ) : outputs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No outputs yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {outputs.map((o, i) => (
                <Box key={i} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--theme-border)' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Chip label={o.outputType} size="small" variant="outlined" />
                    <Typography variant="caption" color="text.secondary">
                      {formatTimestamp(o.createdAt)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{o.uri}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Divider />

        <Typography variant="caption" color="text.secondary">
          Folders, multi-agent chats, roles, and slash commands are on the roadmap (ADR-314) — this is a single Direct chat per workspace until then.
        </Typography>
      </Box>
    </PageContainer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" mb={0.25}>{label}</Typography>
      {children}
    </Box>
  )
}
