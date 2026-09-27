import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { VoiceSeat } from '../types';
import { apiFetch } from '../services/api';

interface UseWebRTCAudioOptions {
  socket: Socket | null;
  currentUserId: string;
  contextType: 'room' | 'live';
  contextId: string;
  seats: VoiceSeat[];
  isListening: boolean;
  isHost?: boolean;
  autoStartMic?: boolean;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

function getOrCreateAudioDomContainer(): HTMLElement {
  let container = document.getElementById('nabd-webrtc-audio-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'nabd-webrtc-audio-container';
    container.style.position = 'fixed';
    container.style.bottom = '0px';
    container.style.left = '0px';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-1';
    document.body.appendChild(container);
  }
  return container;
}

export function useWebRTCAudio({
  socket,
  currentUserId,
  contextType,
  contextId,
  seats,
  isListening,
  isHost = false,
  autoStartMic = true
}: UseWebRTCAudioOptions) {
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micVolumeLevel, setMicVolumeLevel] = useState<number>(0);
  const [remoteVolumeLevel, setRemoteVolumeLevel] = useState<number>(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [connectedPeersCount, setConnectedPeersCount] = useState(0);
  const [remoteAudioPeerIds, setRemoteAudioPeerIds] = useState<string[]>([]);
  const [turnConfigured, setTurnConfigured] = useState<boolean>(false);

  // Optional Real Camera States
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Record<string, MediaStream>>({});

  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoStreamRef = useRef<MediaStream | null>(null);

  // All WebRTC PeerConnection state is keyed by peerKey (peerSocketId, or fallback peerUserId)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerKeyToUserIdRef = useRef<Map<string, string>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const remoteVideoStreamsMapRef = useRef<Map<string, MediaStream>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const lastOfferAtRef = useRef<Map<string, number>>(new Map());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const remoteAudioCtxRef = useRef<AudioContext | null>(null);
  const remoteAnalysersRef = useRef<Map<string, { analyser: AnalyserNode; dataArray: Uint8Array }>>(new Map());

  const isListeningRef = useRef<boolean>(isListening);
  isListeningRef.current = isListening;

  const mySeat = seats.find((s) => s.userId === currentUserId);
  const isSeated = Boolean(mySeat) || (contextType === 'live' && isHost);
  const isMutedOnSeat = mySeat?.isMuted ?? false;

  const isSeatedRef = useRef<boolean>(isSeated);
  isSeatedRef.current = isSeated;

  const isMutedOnSeatRef = useRef<boolean>(isMutedOnSeat);
  isMutedOnSeatRef.current = isMutedOnSeat;

  const seatsRef = useRef<VoiceSeat[]>(seats);
  seatsRef.current = seats;

  const syncPeerStats = useCallback(() => {
    let activeCount = 0;
    const activeRemoteUserIds = new Set<string>();
    const videoByUserId: Record<string, MediaStream> = {};

    peersRef.current.forEach((pc, peerKey) => {
      if (
        pc.connectionState === 'connected' ||
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        activeCount += 1;
      }
      const uid = peerKeyToUserIdRef.current.get(peerKey) || peerKey;
      if (remoteStreamsRef.current.has(peerKey)) {
        activeRemoteUserIds.add(uid);
      }
      const vidStream = remoteVideoStreamsMapRef.current.get(peerKey);
      if (vidStream && vidStream.getVideoTracks().some((t) => t.readyState === 'live')) {
        videoByUserId[uid] = vidStream;
      }
    });

    setConnectedPeersCount(activeCount);
    setRemoteAudioPeerIds(Array.from(activeRemoteUserIds));
    setRemoteVideoStreams(videoByUserId);
  }, []);

  // Fetch STUN / TURN ICE configuration from backend
  useEffect(() => {
    let mounted = true;
    apiFetch<{ iceServers: RTCIceServer[]; turnConfigured: boolean }>('/api/webrtc/ice-config')
      .then((res) => {
        if (!mounted) return;
        if (res.iceServers && res.iceServers.length > 0) {
          iceServersRef.current = res.iceServers;
        }
        setTurnConfigured(Boolean(res.turnConfigured));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Monitor incoming remote audio levels so Listener sees real-time proof of incoming audio
  useEffect(() => {
    const timer = setInterval(() => {
      if (remoteAnalysersRef.current.size === 0 || !isListeningRef.current) {
        setRemoteVolumeLevel(0);
        return;
      }
      let maxLevel = 0;
      remoteAnalysersRef.current.forEach(({ analyser, dataArray }) => {
        try {
          analyser.getByteFrequencyData(dataArray as any);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const scaled = Math.min(100, Math.round((avg / 70) * 100));
          if (scaled > maxLevel) maxLevel = scaled;
        } catch {}
      });
      setRemoteVolumeLevel(maxLevel);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const attemptPlayAudioElement = useCallback((audioEl: HTMLAudioElement) => {
    audioEl.muted = !isListeningRef.current;
    audioEl.volume = 1.0;
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch(() => {
          setAutoplayBlocked(true);
        });
    }
  }, []);

  // Unlock browser autoplay restriction via user gesture
  const unlockAudioPlayback = useCallback(async () => {
    try {
      getOrCreateAudioDomContainer();
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {});
      }
      if (remoteAudioCtxRef.current && remoteAudioCtxRef.current.state === 'suspended') {
        await remoteAudioCtxRef.current.resume().catch(() => {});
      }
      const playPromises: Promise<any>[] = [];
      remoteAudioElsRef.current.forEach((audioEl) => {
        audioEl.muted = !isListeningRef.current;
        audioEl.volume = 1.0;
        playPromises.push(audioEl.play());
      });
      await Promise.all(playPromises);
      setAutoplayBlocked(false);
    } catch {
      // Will retry when user clicks the explicit unlock banner
    }
  }, []);

  const cleanupPeer = useCallback(
    (peerKey: string) => {
      const pc = peersRef.current.get(peerKey);
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        try {
          pc.close();
        } catch {}
        peersRef.current.delete(peerKey);
      }
      peerKeyToUserIdRef.current.delete(peerKey);
      pendingCandidatesRef.current.delete(peerKey);
      makingOfferRef.current.delete(peerKey);
      lastOfferAtRef.current.delete(peerKey);
      remoteStreamsRef.current.delete(peerKey);
      remoteVideoStreamsMapRef.current.delete(peerKey);
      remoteAnalysersRef.current.delete(peerKey);

      const audioEl = remoteAudioElsRef.current.get(peerKey);
      if (audioEl) {
        try {
          audioEl.pause();
          audioEl.srcObject = null;
          audioEl.remove();
        } catch {}
        remoteAudioElsRef.current.delete(peerKey);
      }
      syncPeerStats();
    },
    [syncPeerStats]
  );

  const cleanupPeersByUserId = useCallback(
    (targetUserId: string) => {
      const keysToRemove: string[] = [];
      peerKeyToUserIdRef.current.forEach((uid, key) => {
        if (uid === targetUserId || key === targetUserId) {
          keysToRemove.push(key);
        }
      });
      keysToRemove.forEach((k) => cleanupPeer(k));
    },
    [cleanupPeer]
  );

  const cleanupAllPeers = useCallback(() => {
    Array.from(peersRef.current.keys()).forEach((peerKey) => {
      cleanupPeer(peerKey);
    });
    peerKeyToUserIdRef.current.clear();
    pendingCandidatesRef.current.clear();
    makingOfferRef.current.clear();
    lastOfferAtRef.current.clear();
    remoteStreamsRef.current.clear();
    remoteVideoStreamsMapRef.current.clear();
    remoteAnalysersRef.current.clear();
    if (remoteAudioCtxRef.current) {
      remoteAudioCtxRef.current.close().catch(() => {});
      remoteAudioCtxRef.current = null;
    }
    syncPeerStats();
  }, [cleanupPeer, syncPeerStats]);

  const stopLocalCamera = useCallback(() => {
    const hadCamera = Boolean(localVideoStreamRef.current);
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
        peersRef.current.forEach((pc) => {
          pc.getSenders().forEach((sender) => {
            if (sender.track && sender.track.id === track.id) {
              try {
                pc.removeTrack(sender);
              } catch {}
            }
          });
        });
      });
      localVideoStreamRef.current = null;
    }
    setLocalVideoStream(null);
    setCameraActive(false);
    if (hadCamera && socket && contextId) {
      socket.emit('voice:camera', { contextType, contextId, isCameraOn: false });
      if (contextType === 'live') {
        const mySeatObj = seatsRef.current.find((s) => s.userId === currentUserId);
        socket.emit('live:seat:action', {
          liveId: contextId,
          seatIndex: mySeatObj?.seatIndex ?? 0,
          action: 'toggle_camera',
          isCameraOn: false
        });
      }
      if (localStreamRef.current) {
        socket.emit('webrtc:speaker-ready', { contextType, contextId });
      }
    }
  }, [socket, contextType, contextId, currentUserId]);

  const stopLocalMic = useCallback(() => {
    stopLocalCamera();
    if (analyserIntervalRef.current) {
      clearInterval(analyserIntervalRef.current);
      analyserIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    const hadStream = Boolean(localStreamRef.current);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      localStreamRef.current = null;
    }
    setMicActive(false);
    setMicVolumeLevel(0);
    if (hadStream && socket && contextId) {
      socket.emit('voice:speaking', { contextType, contextId, isSpeaking: false });
      socket.emit('webrtc:speaker-stopped', { contextType, contextId });
    }
  }, [socket, contextType, contextId, stopLocalCamera]);

  const flushPendingCandidates = useCallback(async (peerKey: string, pc: RTCPeerConnection) => {
    const queue = pendingCandidatesRef.current.get(peerKey);
    if (!queue || queue.length === 0) return;
    pendingCandidatesRef.current.set(peerKey, []);
    for (const candidateInit of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch {
        // Ignore stale candidate
      }
    }
  }, []);

  const attachRemoteStreamToAudioElement = useCallback(
    (peerKey: string, peerUserId: string, remoteStream: MediaStream) => {
      peerKeyToUserIdRef.current.set(peerKey, peerUserId);
      remoteStreamsRef.current.set(peerKey, remoteStream);

      // Ensure all audio tracks on remoteStream are enabled
      remoteStream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });

      const container = getOrCreateAudioDomContainer();
      let audioEl = remoteAudioElsRef.current.get(peerKey);

      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `webrtc-remote-audio-${contextId}-${peerKey}`;
        audioEl.autoplay = true;
        (audioEl as any).playsInline = true;
        audioEl.setAttribute('playsinline', 'true');
        audioEl.controls = false;
        container.appendChild(audioEl);
        remoteAudioElsRef.current.set(peerKey, audioEl);
      }

      if (audioEl.srcObject !== remoteStream) {
        audioEl.srcObject = remoteStream;
      }

      attemptPlayAudioElement(audioEl);

      // Attach Web Audio AnalyserNode (without destination connection) to monitor incoming audio signal
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx && remoteStream.getAudioTracks().length > 0) {
          if (!remoteAudioCtxRef.current || remoteAudioCtxRef.current.state === 'closed') {
            remoteAudioCtxRef.current = new AudioCtx();
          }
          if (remoteAudioCtxRef.current.state === 'suspended') {
            remoteAudioCtxRef.current.resume().catch(() => {});
          }
          const source = remoteAudioCtxRef.current.createMediaStreamSource(remoteStream);
          const analyser = remoteAudioCtxRef.current.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          remoteAnalysersRef.current.set(peerKey, { analyser, dataArray });
        }
      } catch {}

      syncPeerStats();
    },
    [contextId, attemptPlayAudioElement, syncPeerStats]
  );

  const attachLocalTracksToPeer = useCallback((pc: RTCPeerConnection) => {
    const senders = pc.getSenders();
    const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];

    // 1. Attach audio tracks
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      for (const track of audioTracks) {
        const existingSenderWithTrack = senders.find((s) => s.track && s.track.id === track.id);
        if (existingSenderWithTrack) continue;

        const audioTransceiver = transceivers.find(
          (t) =>
            t.sender &&
            !t.sender.track &&
            t.receiver &&
            t.receiver.track &&
            t.receiver.track.kind === 'audio'
        );

        if (audioTransceiver) {
          try {
            audioTransceiver.sender.replaceTrack(track).catch(() => {});
            if (audioTransceiver.direction === 'recvonly' || audioTransceiver.direction === 'inactive') {
              audioTransceiver.direction = 'sendrecv';
            }
            continue;
          } catch {}
        }

        try {
          pc.addTrack(track, localStreamRef.current);
        } catch {}
      }
    }

    // 2. Attach optional video tracks if camera is active
    if (localVideoStreamRef.current) {
      const videoTracks = localVideoStreamRef.current
        .getVideoTracks()
        .filter((t) => t.readyState === 'live');
      for (const vTrack of videoTracks) {
        const existingVideoSender = senders.find((s) => s.track && s.track.id === vTrack.id);
        if (existingVideoSender) continue;

        try {
          pc.addTrack(vTrack, localVideoStreamRef.current);
        } catch {}
      }
    }
  }, []);

  const createOrGetPeerConnection = useCallback(
    (peerKey: string, peerUserId: string): RTCPeerConnection => {
      peerKeyToUserIdRef.current.set(peerKey, peerUserId);
      const existing = peersRef.current.get(peerKey);
      if (
        existing &&
        existing.signalingState !== 'closed' &&
        existing.connectionState !== 'closed' &&
        existing.connectionState !== 'failed'
      ) {
        attachLocalTracksToPeer(existing);
        return existing;
      }

      if (existing) {
        cleanupPeer(peerKey);
      }

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current
      });
      peersRef.current.set(peerKey, pc);
      peerKeyToUserIdRef.current.set(peerKey, peerUserId);

      // Attach local audio & optional video tracks
      attachLocalTracksToPeer(pc);

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc:ice-candidate', {
            targetSocketId: peerKey !== peerUserId ? peerKey : undefined,
            targetUserId: peerUserId,
            contextType,
            contextId,
            candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
          });
        }
      };

      pc.ontrack = (event) => {
        if (event.track.kind === 'video') {
          let videoStream = remoteVideoStreamsMapRef.current.get(peerKey);
          if (!videoStream) {
            videoStream = new MediaStream([event.track]);
          } else {
            videoStream.getVideoTracks().forEach((oldTrack) => {
              if (oldTrack.id !== event.track.id) {
                videoStream!.removeTrack(oldTrack);
              }
            });
            if (!videoStream.getTracks().some((t) => t.id === event.track.id)) {
              videoStream.addTrack(event.track);
            }
          }
          remoteVideoStreamsMapRef.current.set(peerKey, videoStream);
          syncPeerStats();

          event.track.onunmute = () => syncPeerStats();
          event.track.onended = () => {
            remoteVideoStreamsMapRef.current.delete(peerKey);
            syncPeerStats();
          };
          return;
        }

        let remoteStream = remoteStreamsRef.current.get(peerKey);
        if (event.streams && event.streams[0]) {
          remoteStream = event.streams[0];
        } else if (!remoteStream) {
          remoteStream = new MediaStream([event.track]);
        } else if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }

        event.track.enabled = true;
        attachRemoteStreamToAudioElement(peerKey, peerUserId, remoteStream);

        // In Chromium/WebKit, ontrack fires during setRemoteDescription before ICE completes;
        // onunmute fires when the first real RTP audio packet arrives!
        event.track.onunmute = () => {
          const audioEl = remoteAudioElsRef.current.get(peerKey);
          if (audioEl && remoteStream) {
            if (audioEl.srcObject !== remoteStream) {
              audioEl.srcObject = remoteStream;
            }
            attemptPlayAudioElement(audioEl);
          }
          syncPeerStats();
        };
      };

      pc.onconnectionstatechange = () => {
        syncPeerStats();
        if (pc.connectionState === 'connected') {
          const audioEl = remoteAudioElsRef.current.get(peerKey);
          if (audioEl && audioEl.paused && isListeningRef.current) {
            attemptPlayAudioElement(audioEl);
          }
        } else if (pc.connectionState === 'failed') {
          if (localStreamRef.current && socket) {
            lastOfferAtRef.current.delete(peerKey);
            pc.createOffer({ iceRestart: true, offerToReceiveAudio: true })
              .then((offer) => pc.setLocalDescription(offer))
              .then(() => {
                if (pc.localDescription) {
                  socket.emit('webrtc:offer', {
                    targetSocketId: peerKey !== peerUserId ? peerKey : undefined,
                    targetUserId: peerUserId,
                    contextType,
                    contextId,
                    sdp: {
                      type: pc.localDescription.type,
                      sdp: pc.localDescription.sdp
                    }
                  });
                }
              })
              .catch(() => {});
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        syncPeerStats();
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          const audioEl = remoteAudioElsRef.current.get(peerKey);
          if (audioEl && audioEl.paused && isListeningRef.current) {
            attemptPlayAudioElement(audioEl);
          }
        } else if (pc.iceConnectionState === 'failed') {
          if (localStreamRef.current && socket) {
            lastOfferAtRef.current.delete(peerKey);
            pc.createOffer({ iceRestart: true, offerToReceiveAudio: true })
              .then((offer) => pc.setLocalDescription(offer))
              .then(() => {
                if (pc.localDescription) {
                  socket.emit('webrtc:offer', {
                    targetSocketId: peerKey !== peerUserId ? peerKey : undefined,
                    targetUserId: peerUserId,
                    contextType,
                    contextId,
                    sdp: {
                      type: pc.localDescription.type,
                      sdp: pc.localDescription.sdp
                    }
                  });
                }
              })
              .catch(() => {});
          } else if (socket) {
            socket.emit('webrtc:listener-ready', { contextType, contextId });
          }
        }
      };

      return pc;
    },
    [
      socket,
      contextType,
      contextId,
      cleanupPeer,
      attachLocalTracksToPeer,
      attachRemoteStreamToAudioElement,
      attemptPlayAudioElement,
      syncPeerStats
    ]
  );

  const sendOfferToPeer = useCallback(
    async (peerKey: string, peerUserId: string, forceRestart = false) => {
      if (!socket || !peerKey) return;
      // Never connect a socket to itself
      if (socket.id && peerKey === socket.id) return;
      if (!localStreamRef.current) return;

      // Prevent concurrent offer collision on the same peer
      if (makingOfferRef.current.get(peerKey)) return;

      const existingPc = peersRef.current.get(peerKey);
      if (existingPc && !forceRestart) {
        if (existingPc.signalingState !== 'stable') {
          return;
        }
        const isAlreadyConnected =
          existingPc.connectionState === 'connected' ||
          existingPc.iceConnectionState === 'connected' ||
          existingPc.iceConnectionState === 'completed';

        const localAudioTrack = localStreamRef.current?.getAudioTracks()[0];
        const isSendingLocalTrack =
          Boolean(localAudioTrack) &&
          existingPc.getSenders().some((s) => s.track && s.track.id === localAudioTrack!.id);

        const localVideoTrack = localVideoStreamRef.current?.getVideoTracks()[0];
        const isSendingVideoTrack =
          !localVideoTrack ||
          existingPc.getSenders().some((s) => s.track && s.track.id === localVideoTrack.id);

        if (isAlreadyConnected && isSendingLocalTrack && isSendingVideoTrack) {
          return;
        }

        const lastOfferAt = lastOfferAtRef.current.get(peerKey) || 0;
        if (
          Date.now() - lastOfferAt < 1800 &&
          (existingPc.connectionState === 'connecting' || existingPc.iceConnectionState === 'checking')
        ) {
          return;
        }
      }

      makingOfferRef.current.set(peerKey, true);
      lastOfferAtRef.current.set(peerKey, Date.now());

      try {
        const pc = createOrGetPeerConnection(peerKey, peerUserId);
        attachLocalTracksToPeer(pc);

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
          iceRestart: forceRestart
        });
        await pc.setLocalDescription(offer);

        if (pc.localDescription) {
          socket.emit('webrtc:offer', {
            targetSocketId: peerKey !== peerUserId ? peerKey : undefined,
            targetUserId: peerUserId,
            contextType,
            contextId,
            sdp: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp
            }
          });
        }
      } catch {
        // Reset timestamp so retry can happen if needed
        lastOfferAtRef.current.delete(peerKey);
      } finally {
        makingOfferRef.current.set(peerKey, false);
      }
    },
    [socket, contextType, contextId, createOrGetPeerConnection, attachLocalTracksToPeer]
  );

  // Start local microphone stream when user is seated (Host or Guest Speaker)
  const startMicrophone = useCallback(async () => {
    if (!contextId || !isSeatedRef.current) return;

    // Check if we already have an active live audio track
    if (localStreamRef.current) {
      const activeTracks = localStreamRef.current
        .getAudioTracks()
        .filter((t) => t.readyState === 'live');
      if (activeTracks.length > 0) {
        activeTracks.forEach((track) => {
          track.enabled = !isMutedOnSeatRef.current;
        });
        setMicActive(true);
        socket?.emit('webrtc:speaker-ready', { contextType, contextId });
        return;
      }
    }

    try {
      setMicError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedOnSeatRef.current;
      });

      localStreamRef.current = stream;
      setMicActive(true);

      // Attach local tracks to any existing PeerConnections
      peersRef.current.forEach((pc) => {
        attachLocalTracksToPeer(pc);
      });

      // Setup Web Audio API AnalyserNode for real-time voice activity & volume meter
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
        }
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        let lastSpeaking = false;
        if (analyserIntervalRef.current) clearInterval(analyserIntervalRef.current);
        analyserIntervalRef.current = setInterval(() => {
          if (!localStreamRef.current) return;
          const audioTrack = localStreamRef.current.getAudioTracks()[0];
          if (!audioTrack || !audioTrack.enabled || isMutedOnSeatRef.current) {
            setMicVolumeLevel(0);
            if (lastSpeaking) {
              lastSpeaking = false;
              socket?.emit('voice:speaking', { contextType, contextId, isSpeaking: false });
            }
            return;
          }
          analyser.getByteFrequencyData(dataArray as any);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setMicVolumeLevel(Math.min(100, Math.round((avg / 75) * 100)));
          const speakingNow = avg > 10;
          if (speakingNow !== lastSpeaking) {
            lastSpeaking = speakingNow;
            socket?.emit('voice:speaking', { contextType, contextId, isSpeaking: speakingNow });
          }
        }, 180);
      }

      // Announce to server that our microphone MediaStream is ready so we get all listener/peer socket IDs!
      socket?.emit('webrtc:speaker-ready', { contextType, contextId });
    } catch {
      setMicError(
        'تعذر الوصول إلى الميكروفون. يرجى السماح بصلاحية الميكروفون في المتصفح ثم الضغط على تفعيل الميكروفون.'
      );
      setMicActive(false);
    }
  }, [contextId, contextType, socket, attachLocalTracksToPeer]);

  // 1. FIRST: Register all WebRTC Signaling event listeners on Socket.IO before emitting ready events
  useEffect(() => {
    if (!socket || !contextId) return;

    // Server sends list of all connected participant sockets to an active speaker
    const handlePeersList = async (payload: {
      contextType: string;
      contextId: string;
      peers?: Array<{ socketId: string; userId: string }>;
      peerUserIds?: string[];
    }) => {
      if (payload.contextType !== contextType || payload.contextId !== contextId) return;
      if (!localStreamRef.current) return;

      if (payload.peers && payload.peers.length > 0) {
        for (const peer of payload.peers) {
          if (peer.socketId && peer.socketId !== socket.id) {
            await sendOfferToPeer(peer.socketId, peer.userId);
          }
        }
      } else if (payload.peerUserIds) {
        for (const peerUserId of payload.peerUserIds) {
          if (peerUserId && peerUserId !== currentUserId) {
            await sendOfferToPeer(peerUserId, peerUserId);
          }
        }
      }
    };

    // A new Listener socket joined the Live / Room (or PK Battle bridged peer) -> Active speaker immediately sends them an Offer!
    const handleListenerJoined = async (payload: {
      contextType: string;
      contextId: string;
      listenerSocketId?: string;
      listenerUserId: string;
    }) => {
      if (payload.contextType !== contextType) return;
      if (!localStreamRef.current) return;
      const peerKey = payload.listenerSocketId || payload.listenerUserId;
      if (!peerKey || (socket.id && peerKey === socket.id)) return;
      await sendOfferToPeer(peerKey, payload.listenerUserId);
    };

    // A Speaker left their seat or stopped mic -> Close their PeerConnection and stop their audio
    const handleSpeakerLeft = (payload: {
      contextType: string;
      contextId: string;
      speakerSocketId?: string;
      speakerUserId: string;
    }) => {
      if (payload.contextType !== contextType || payload.contextId !== contextId) return;
      if (payload.speakerSocketId) {
        cleanupPeer(payload.speakerSocketId);
      } else if (payload.speakerUserId && payload.speakerUserId !== currentUserId) {
        cleanupPeersByUserId(payload.speakerUserId);
      }
    };

    // A Peer (Listener or Speaker) left the room/live session or disconnected -> Clean up their PeerConnection
    const handlePeerLeft = (payload: {
      contextType: string;
      contextId: string;
      peerSocketId?: string;
      peerUserId: string;
    }) => {
      if (payload.contextType !== contextType || payload.contextId !== contextId) return;
      if (payload.peerSocketId) {
        cleanupPeer(payload.peerSocketId);
      }
    };

    // Force mute from Host / Moderator
    const handleForceMute = (payload: { contextType: string; contextId: string }) => {
      if (payload.contextType !== contextType || payload.contextId !== contextId) return;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
    };

    // Kicked from seat by Host / Moderator
    const handleKickedFromSeat = (payload: { contextType: string; contextId: string }) => {
      if (payload.contextType !== contextType || payload.contextId !== contextId) return;
      stopLocalMic();
    };

    // Incoming SDP Offer
    const handleOffer = async (payload: {
      fromSocketId?: string;
      fromUserId: string;
      contextType: string;
      contextId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (payload.contextType !== contextType) return;
      const peerKey = payload.fromSocketId || payload.fromUserId;
      if (!peerKey || (socket.id && peerKey === socket.id)) return;

      try {
        const pc = createOrGetPeerConnection(peerKey, payload.fromUserId);

        // Handle signaling collision (glare) gracefully using rollback
        if (pc.signalingState !== 'stable') {
          const myIdForGlare = socket.id || currentUserId;
          const isPolite = myIdForGlare < peerKey;
          if (!isPolite) {
            return;
          }
          await pc.setLocalDescription({ type: 'rollback' } as any).catch(() => {});
        }

        await pc.setRemoteDescription(
          new RTCSessionDescription({
            type: payload.sdp.type,
            sdp: payload.sdp.sdp
          })
        );
        await flushPendingCandidates(peerKey, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (pc.localDescription) {
          socket.emit('webrtc:answer', {
            targetSocketId: payload.fromSocketId,
            targetUserId: payload.fromUserId,
            contextType,
            contextId,
            sdp: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp
            }
          });
        }
      } catch {
        // Ignore transient SDP error
      }
    };

    // Incoming SDP Answer
    const handleAnswer = async (payload: {
      fromSocketId?: string;
      fromUserId: string;
      contextType: string;
      contextId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (payload.contextType !== contextType) return;
      const peerKey = payload.fromSocketId || payload.fromUserId;
      const pc = peersRef.current.get(peerKey) || peersRef.current.get(payload.fromUserId);
      if (!pc) return;
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: payload.sdp.type,
              sdp: payload.sdp.sdp
            })
          );
          await flushPendingCandidates(peerKey, pc);
        }
      } catch {
        // Ignore transient state mismatch
      }
    };

    // Incoming ICE Candidate (with queuing if remoteDescription is not yet set)
    const handleCandidate = async (payload: {
      fromSocketId?: string;
      fromUserId: string;
      contextType: string;
      contextId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (payload.contextType !== contextType) return;
      if (!payload.candidate) return;
      const peerKey = payload.fromSocketId || payload.fromUserId;
      if (!peerKey) return;

      const pc = peersRef.current.get(peerKey);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // Ignore invalid candidate
        }
      } else {
        if (!pendingCandidatesRef.current.has(peerKey)) {
          pendingCandidatesRef.current.set(peerKey, []);
        }
        pendingCandidatesRef.current.get(peerKey)!.push(payload.candidate);
      }
    };

    // Socket Reconnect Recovery
    const handleSocketReconnect = () => {
      if (contextType === 'live') {
        socket.emit('live:join', { liveId: contextId });
      } else {
        socket.emit('room:join', { roomId: contextId });
      }
      setTimeout(() => {
        socket.emit('webrtc:listener-ready', { contextType, contextId });
        if (localStreamRef.current) {
          socket.emit('webrtc:speaker-ready', { contextType, contextId });
        }
      }, 250);
    };

    socket.on('webrtc:peers-list', handlePeersList);
    socket.on('webrtc:listener-joined', handleListenerJoined);
    socket.on('webrtc:speaker-left', handleSpeakerLeft);
    socket.on('webrtc:peer-left', handlePeerLeft);
    socket.on('webrtc:force-mute', handleForceMute);
    socket.on('webrtc:kicked-from-seat', handleKickedFromSeat);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleCandidate);
    socket.on('connect', handleSocketReconnect);

    return () => {
      socket.off('webrtc:peers-list', handlePeersList);
      socket.off('webrtc:listener-joined', handleListenerJoined);
      socket.off('webrtc:speaker-left', handleSpeakerLeft);
      socket.off('webrtc:peer-left', handlePeerLeft);
      socket.off('webrtc:force-mute', handleForceMute);
      socket.off('webrtc:kicked-from-seat', handleKickedFromSeat);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleCandidate);
      socket.off('connect', handleSocketReconnect);
    };
  }, [
    socket,
    contextType,
    contextId,
    currentUserId,
    createOrGetPeerConnection,
    sendOfferToPeer,
    flushPendingCandidates,
    cleanupPeer,
    cleanupPeersByUserId,
    stopLocalMic
  ]);

  // 2. SECOND: Automatically start/stop microphone when seated status changes, and announce listener readiness
  useEffect(() => {
    if (!contextId || !socket) return;
    socket.emit('webrtc:listener-ready', { contextType, contextId });

    if (isSeated && autoStartMic) {
      startMicrophone();
    } else if (!isSeated) {
      stopLocalMic();
    }
  }, [isSeated, autoStartMic, contextId, contextType, socket, startMicrophone, stopLocalMic]);

  // 3. THIRD: Self-healing check every 2.5s — if there is a seated speaker we haven't received audio from yet, request offer
  useEffect(() => {
    if (!socket || !contextId) return;
    const interval = setInterval(() => {
      // If we are an active speaker with a microphone, ensure any new peers are connected
      if (localStreamRef.current) {
        socket.emit('webrtc:speaker-ready', { contextType, contextId });
      }

      // Check if there are seated speakers whose audio stream we haven't received yet
      const currentSeats = seatsRef.current;
      const seatedSpeakerIds = currentSeats
        .filter((s) => Boolean(s.userId))
        .map((s) => s.userId as string);

      if (seatedSpeakerIds.length === 0) return;

      const connectedUserIds = new Set<string>();
      peersRef.current.forEach((pc, peerKey) => {
        if (
          pc.connectionState === 'connected' ||
          pc.connectionState === 'connecting' ||
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed' ||
          pc.iceConnectionState === 'checking'
        ) {
          const uid = peerKeyToUserIdRef.current.get(peerKey) || peerKey;
          connectedUserIds.add(uid);
        }
      });

      const missingSpeaker = seatedSpeakerIds.some((speakerUid) => {
        if (speakerUid === currentUserId && localStreamRef.current) return false;
        return !connectedUserIds.has(speakerUid);
      });

      if (missingSpeaker) {
        socket.emit('webrtc:listener-ready', { contextType, contextId });
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [socket, contextType, contextId, currentUserId]);

  // Sync hardware audioTrack.enabled with seat mute status
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedOnSeat;
      });
    }
  }, [isMutedOnSeat]);

  // Sync remote <audio> elements mute status when user toggles speaker listening
  useEffect(() => {
    remoteAudioElsRef.current.forEach((audioEl) => {
      audioEl.muted = !isListening;
      if (isListening && audioEl.paused) {
        audioEl.play().catch(() => {
          setAutoplayBlocked(true);
        });
      }
    });
  }, [isListening]);

  const toggleCamera = useCallback(async () => {
    if (!contextId || !isSeatedRef.current) return;

    if (localVideoStreamRef.current) {
      stopLocalCamera();
      return;
    }

    try {
      setCameraError(null);
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 720 },
          height: { ideal: 1280 },
          facingMode: 'user'
        },
        audio: false
      });

      localVideoStreamRef.current = videoStream;
      setLocalVideoStream(videoStream);
      setCameraActive(true);

      // Attach video track to all existing peer connections
      peersRef.current.forEach((pc) => {
        attachLocalTracksToPeer(pc);
      });

      socket?.emit('voice:camera', { contextType, contextId, isCameraOn: true });
      if (contextType === 'live') {
        const mySeatObj = seatsRef.current.find((s) => s.userId === currentUserId);
        socket?.emit('live:seat:action', {
          liveId: contextId,
          seatIndex: mySeatObj?.seatIndex ?? 0,
          action: 'toggle_camera',
          isCameraOn: true
        });
      }

      // Trigger SDP renegotiation so listeners receive the new video track without disrupting audio
      socket?.emit('webrtc:speaker-ready', { contextType, contextId });
    } catch {
      setCameraError('تعذر الوصول إلى الكاميرا. يستمر البث الصوتي بشكل طبيعي.');
      setCameraActive(false);
    }
  }, [contextId, contextType, socket, currentUserId, attachLocalTracksToPeer, stopLocalCamera]);

  // Complete cleanup on session change or unmount
  useEffect(() => {
    return () => {
      stopLocalMic();
      cleanupAllPeers();
    };
  }, [contextId, stopLocalMic, cleanupAllPeers]);

  return {
    micActive,
    micError,
    micVolumeLevel,
    remoteVolumeLevel,
    autoplayBlocked,
    connectedPeersCount,
    remoteAudioPeerIds,
    turnConfigured,
    cameraActive,
    cameraError,
    localVideoStream,
    remoteVideoStreams,
    startMicrophone,
    stopLocalMic,
    toggleCamera,
    stopLocalCamera,
    unlockAudioPlayback
  };
}
