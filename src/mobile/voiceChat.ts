type VoiceRequest = <T>(path: string, body: unknown) => Promise<T>;
type VoiceMember = { id: string; name: string };
type VoiceSignal = { id: number; from: string; fromName: string; kind: 'offer' | 'answer' | 'candidate' | 'left'; payload: any };
type VoiceState = { active: boolean; muted: boolean; joining: boolean; members: number; label: string };

const rtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/** Opt-in peer-to-peer voice for authenticated players in one lounge room. */
export class VoiceChat {
  private room = '';
  private self = '';
  private stream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private joining = false;
  private muted = false;
  private members = 0;

  constructor(private request: VoiceRequest, private changed: (state: VoiceState) => void) { this.emit(); }

  get isActive() { return this.active; }
  get isMuted() { return this.muted; }

  async join(room: string, self: string) {
    if (this.active || this.joining) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) throw new Error('Voice chat is not supported by this browser.');
    this.joining = true; this.emit('Requesting microphone…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.room = room; this.self = self;
      const joined = await this.request<{ members: VoiceMember[] }>('voice/join', { code: room });
      this.active = true; this.muted = false; this.members = joined.members.length;
      this.emit(this.members > 1 ? `Voice · ${this.members} people` : 'Voice · waiting for friends');
      for (const member of joined.members) if (member.id !== self) await this.offer(member.id);
      this.schedulePoll(0);
    } catch (error) {
      this.stopLocal();
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) throw new Error('Microphone access was blocked. Allow microphone access, then select Join voice again.');
      throw error;
    } finally { this.joining = false; this.emit(); }
  }

  toggleMute() {
    if (!this.stream) return;
    this.muted = !this.muted;
    for (const track of this.stream.getAudioTracks()) track.enabled = !this.muted;
    this.emit();
  }

  async leave() {
    const room = this.room;
    this.active = false; this.joining = false; this.members = 0; this.room = ''; this.self = '';
    if (this.pollTimer) clearTimeout(this.pollTimer); this.pollTimer = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stopLocal(); this.emit('Voice off');
    if (room) try { await this.request('voice/leave', { code: room }); } catch { /* Room expiry also removes voice membership. */ }
  }

  private emit(label?: string) {
    this.changed({ active: this.active, muted: this.muted, joining: this.joining, members: this.members, label: label ?? (this.active ? `Voice · ${this.members || 1} ${this.members === 1 ? 'person' : 'people'}` : 'Voice off') });
  }

  private stopLocal() {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private peer(id: string) {
    const existing = this.peers.get(id); if (existing) return existing;
    const peer = new RTCPeerConnection(rtcConfig); this.peers.set(id, peer);
    for (const track of this.stream?.getTracks() ?? []) peer.addTrack(track, this.stream!);
    peer.onicecandidate = event => {
      if (!event.candidate || !this.active) return;
      void this.request('voice/signal', { code: this.room, to: id, kind: 'candidate', payload: event.candidate.toJSON() }).catch(() => undefined);
    };
    peer.ontrack = event => {
      let audio = this.audios.get(id);
      if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.dataset.voicePeer = id; document.body.append(audio); this.audios.set(id, audio); }
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => this.emit('Tap Join voice again to enable audio'));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.closePeer(id);
    };
    return peer;
  }

  private async offer(id: string) {
    const peer = this.peer(id), description = await peer.createOffer({ offerToReceiveAudio: true });
    await peer.setLocalDescription(description);
    await this.request('voice/signal', { code: this.room, to: id, kind: 'offer', payload: { type: 'offer', sdp: description.sdp } });
  }

  private async handle(signal: VoiceSignal) {
    if (signal.kind === 'left') { this.closePeer(signal.from); return; }
    const peer = this.peer(signal.from);
    if (signal.kind === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.payload);
      else this.pendingCandidates.set(signal.from, [...(this.pendingCandidates.get(signal.from) ?? []), signal.payload]);
      return;
    }
    await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
    for (const candidate of this.pendingCandidates.get(signal.from) ?? []) await peer.addIceCandidate(candidate);
    this.pendingCandidates.delete(signal.from);
    if (signal.kind === 'offer') {
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
      await this.request('voice/signal', { code: this.room, to: signal.from, kind: 'answer', payload: { type: 'answer', sdp: answer.sdp } });
    }
  }

  private schedulePoll(delay = 450) {
    if (!this.active) return;
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private async poll() {
    if (!this.active) return;
    try {
      const update = await this.request<{ members: VoiceMember[]; signals: VoiceSignal[] }>('voice/poll', { code: this.room });
      this.members = update.members.length;
      for (const signal of update.signals) try { await this.handle(signal); } catch { this.closePeer(signal.from); }
      this.emit(); this.schedulePoll();
    } catch {
      if (this.active) { this.emit('Voice reconnecting…'); this.schedulePoll(1200); }
    }
  }

  private closePeer(id: string) {
    const peer = this.peers.get(id); if (peer) { peer.ontrack = null; peer.onicecandidate = null; peer.close(); this.peers.delete(id); }
    const audio = this.audios.get(id); if (audio) { audio.srcObject = null; audio.remove(); this.audios.delete(id); }
    this.pendingCandidates.delete(id);
  }
}
