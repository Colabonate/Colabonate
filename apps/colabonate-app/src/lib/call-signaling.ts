import {
  subscribeToCallEvents,
  publishCallOffer,
  publishCallAnswer,
  type CallEvent,
  type CallType,
  type HangupReason,
} from './nostr'
import { webRTCService, type WebRTCServiceEvents, type CallState } from './webrtc'

export type CallRole = 'caller' | 'callee'

export interface CallSession {
  sessionId: string
  role: CallRole
  peerPubkey: string
  ticketId: string
  callType: CallType
  state: CallState
}

export interface CallSignalingEvents {
  onIncomingOffer: (session: CallSession, sdp: string, callType: CallType) => void
  onCallStateChange: (session: CallSession, state: CallState) => void
  onCallEnded: (sessionId: string, reason: HangupReason) => void
}

export class CallSignalingService {
  private currentSession: CallSession | null = null
  private subscription: { close: () => void } | null = null
  private events: CallSignalingEvents | null = null
  private myPubkey: string = ''

  initialize(myPubkey: string, events: CallSignalingEvents): void {
    this.myPubkey = myPubkey
    this.events = events
  }

  async initiateCall(
    peerPubkey: string,
    ticketId: string,
    callType: CallType
  ): Promise<{ sessionId: string; sdp: string }> {
    const sessionId = crypto.randomUUID()
    
    this.currentSession = {
      sessionId,
      role: 'caller',
      peerPubkey,
      ticketId,
      callType,
      state: 'offering',
    }

    const webrtcEvents: WebRTCServiceEvents = {
      onRemoteStream: () => {},
      onStateChange: (state) => {
        this.currentSession!.state = state
        this.events?.onCallStateChange(this.currentSession!, state)
      },
      onError: (error) => console.error('WebRTC error:', error),
    }

    const sdp = await webRTCService.startCall(
      sessionId,
      peerPubkey,
      ticketId,
      callType,
      webrtcEvents
    )

    await publishCallOffer(sessionId, peerPubkey, ticketId, JSON.stringify(sdp), callType)

    return { sessionId, sdp: JSON.stringify(sdp) }
  }

  async handleIncomingOffer(
    event: CallEvent,
    callType: CallType
  ): Promise<{ sessionId: string; sdp: string }> {
    this.currentSession = {
      sessionId: event.sessionId || '',
      role: 'callee',
      peerPubkey: event.peerPubkey || '',
      ticketId: event.ticketId || '',
      callType,
      state: 'answering',
    }

    if (this.currentSession) {
      this.events?.onIncomingOffer(
        this.currentSession,
        event.content || '',
        callType
      )
    }

    return { sessionId: event.sessionId || '', sdp: event.content || '' }
  }

  async answerCall(
    sdp: RTCSessionDescriptionInit
  ): Promise<string> {
    if (!this.currentSession) throw new Error('No active call session')

    const answer = await webRTCService.handleOffer(
      this.currentSession.sessionId,
      this.currentSession.peerPubkey,
      this.currentSession.ticketId,
      sdp,
      this.currentSession.callType,
      {
        onRemoteStream: () => {},
        onStateChange: (state) => {
          this.currentSession!.state = state
          this.events?.onCallStateChange(this.currentSession!, state)
        },
        onError: (error) => console.error('WebRTC error:', error),
      }
    )

    await publishCallAnswer(
      this.currentSession.sessionId,
      this.currentSession.peerPubkey,
      this.currentSession.ticketId,
      '',
      JSON.stringify(answer)
    )

    return JSON.stringify(answer)
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    await webRTCService.handleAnswer(sdp)
  }

  async handleIceCandidate(candidateJson: string, _mid: string): Promise<void> {
    try {
      const candidate = JSON.parse(candidateJson)
      await webRTCService.addIceCandidate(candidate)
    } catch (e) {
      console.warn('Failed to handle ICE candidate:', e)
    }
  }

  async endCall(reason: 'ended' | 'rejected' | 'busy' | 'timeout' = 'ended'): Promise<void> {
    await webRTCService.endCall(reason)
    this.currentSession = null
  }

  subscribeToCalls(): void {
    if (!this.myPubkey) {
      console.warn('CallSignalingService not initialized')
      return
    }

    this.subscription = { close: subscribeToCallEvents(this.myPubkey, async (event: CallEvent) => {
      if (this.currentSession && this.currentSession.sessionId !== event.sessionId) {
        return
      }

      switch (event.kind) {
        case 30027: {
          const typeTag = event.tags.find(t => t[0] === 'type')?.[1] as CallType || 'audiovideo'
          await this.handleIncomingOffer(event, typeTag)
          break
        }
        case 30028: {
          try {
            const sdp = JSON.parse(event.content)
            await this.handleAnswer(sdp)
          } catch (e) {
            console.warn('Failed to parse answer SDP:', e)
          }
          break
        }
        case 30029: {
          const candidate = event.tags.find(t => t[0] === 'candidate')?.[1]
          const mid = event.tags.find(t => t[0] === 'mid')?.[1] || '0'
          if (candidate) {
            await this.handleIceCandidate(candidate, mid)
          }
          break
        }
        case 30030: {
          const reason = event.tags.find(t => t[0] === 'reason')?.[1] as 'ended' | 'rejected' | 'busy' | 'timeout' || 'ended'
          this.events?.onCallEnded(event.sessionId || '', reason)
          await webRTCService.endCall(reason)
          this.currentSession = null
          break
        }
      }
    }) }
  }

  unsubscribe(): void {
    if (this.subscription) {
      this.subscription.close()
      this.subscription = null
    }
  }

  getCurrentSession(): CallSession | null {
    return this.currentSession
  }
}

export const callSignalingService = new CallSignalingService()