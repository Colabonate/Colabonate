import type { CallType } from './nostr'
import { publishIceCandidate, publishCallHangup } from './nostr'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type CallState = 'idle' | 'offering' | 'answering' | 'connecting' | 'connected' | 'ended'

export interface WebRTCServiceEvents {
  onRemoteStream: (stream: MediaStream) => void
  onStateChange: (state: CallState) => void
  onError: (error: Error) => void
}

export class WebRTCService {
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private sessionId: string = ''
  private peerPubkey: string = ''
  private ticketId: string = ''
  private events: WebRTCServiceEvents | null = null

  async startCall(
    sessionId: string,
    peerPubkey: string,
    ticketId: string,
    callType: CallType,
    events: WebRTCServiceEvents
  ): Promise<RTCSessionDescriptionInit> {
    this.sessionId = sessionId
    this.peerPubkey = peerPubkey
    this.ticketId = ticketId
    this.events = events

    this.localStream = await this.getUserMedia(callType)
    this.pc = this.createPeerConnection()

    this.localStream.getTracks().forEach(track => {
      this.pc!.addTrack(track, this.localStream!)
    })

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    events.onStateChange('offering')
    return offer
  }

  async handleOffer(
    sessionId: string,
    peerPubkey: string,
    ticketId: string,
    sdp: RTCSessionDescriptionInit,
    callType: CallType,
    events: WebRTCServiceEvents
  ): Promise<RTCSessionDescriptionInit> {
    this.sessionId = sessionId
    this.peerPubkey = peerPubkey
    this.ticketId = ticketId
    this.events = events

    this.localStream = await this.getUserMedia(callType)
    this.pc = this.createPeerConnection()

    this.localStream.getTracks().forEach(track => {
      this.pc!.addTrack(track, this.localStream!)
    })

    await this.pc.setRemoteDescription(sdp)
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)

    events.onStateChange('answering')
    return answer
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return
    await this.pc.setRemoteDescription(sdp)
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return
    await this.pc.addIceCandidate(candidate)
  }

  async endCall(reason: 'ended' | 'rejected' | 'busy' | 'timeout' = 'ended'): Promise<void> {
    try {
      if (this.sessionId && this.peerPubkey && this.ticketId) {
        await publishCallHangup(this.sessionId, this.peerPubkey, this.ticketId, reason)
      }
    } catch (e) {
      console.warn('Failed to publish hangup:', e)
    }

    this.cleanup()
    this.events?.onStateChange('ended')
  }

  private cleanup(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop())
      this.localStream = null
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(track => track.stop())
      this.remoteStream = null
    }

    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
  }

  private getUserMedia(type: CallType): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: type === 'audio' ? false : {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    }
    return navigator.mediaDevices.getUserMedia(constraints)
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    pc.ontrack = (event) => {
      this.remoteStream = event.streams[0]
      this.events?.onRemoteStream(this.remoteStream)
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && this.sessionId && this.peerPubkey && this.ticketId) {
        const candidateStr = JSON.stringify(event.candidate.toJSON())
        publishIceCandidate(
          this.sessionId,
          this.peerPubkey,
          this.ticketId,
          candidateStr,
          event.candidate.sdpMid || '0'
        ).catch(console.warn)
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'connected') {
        this.events?.onStateChange('connected')
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.events?.onStateChange('ended')
      }
    }

    return pc
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream
  }

  toggleAudio(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach(track => {
      track.enabled = enabled
    })
  }

  toggleVideo(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach(track => {
      track.enabled = enabled
    })
  }
}

export const webRTCService = new WebRTCService()