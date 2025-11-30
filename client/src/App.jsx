// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import 'webrtc-adapter';

const App = () => {
  const [status, setStatus] = useState('disconnected');
  const [partnerId, setPartnerId] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionTime, setConnectionTime] = useState(0);
  const [audioUnblocked, setAudioUnblocked] = useState(false); // Autoplay fix

  // Diagnostics State
  const [iceStatus, setIceStatus] = useState('new');
  const [remoteTrackInfo, setRemoteTrackInfo] = useState('No tracks');

  const socketRef = useRef();
  const localAudioRef = useRef();
  const remoteAudioRef = useRef();
  const peerConnectionRef = useRef();
  const timerRef = useRef();

  // ICE Queue Refs
  const iceCandidatesQueue = useRef([]);
  const isRemoteDescriptionSet = useRef(false);
  const localStreamRef = useRef(null);

  // Unblock browser autoplay policy on first user interaction
  const unblockAudio = () => {
    if (!audioUnblocked) {
      const audio = new Audio();
      audio.play().catch(() => { });
      setAudioUnblocked(true);
      console.log('Audio autoplay unblocked');
    }
  };

  useEffect(() => {
    socketRef.current = io('http://localhost:3001');

    socketRef.current.on('connect', () => {
      console.log('Connected to server:', socketRef.current.id);
    });

    socketRef.current.on('searching', () => {
      console.log('Searching for partner...');
    });

    socketRef.current.on('matchFound', (data) => {
      console.log('Match found!', data);
      setStatus('connected');
      setPartnerId(data.partnerId);
      startTimer();

      if (data.shouldInitiate) {
        console.log('I will initiate the call');
        // Wait a bit to ensure local stream is ready
        setTimeout(() => {
          startCall(data.partnerId);
        }, 100);
      } else {
        console.log('Waiting for offer from partner');
      }
    });

    socketRef.current.on('userLeft', () => {
      console.log('Partner left');
      setStatus('disconnected');
      setPartnerId(null);
      endCall();
      stopTimer();
    });

    socketRef.current.on('offer', async (data) => {
      console.log('Received offer from:', data.from);
      await handleOffer(data.offer, data.from);
    });

    socketRef.current.on('answer', async (data) => {
      console.log('Received answer from:', data.from);
      await handleAnswer(data.answer);
    });

    socketRef.current.on('ice-candidate', async (data) => {
      console.log('Received ICE candidate');
      await handleIceCandidate(data.candidate);
    });

    return () => {
      socketRef.current?.disconnect();
      stopTimer();
      endCall();
    };
  }, []);

  const startTimer = () => {
    setConnectionTime(0);
    timerRef.current = setInterval(() => {
      setConnectionTime(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startSearching = async () => {
    unblockAudio(); // Critical: Unblocks autoplay

    try {
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false
      });

      console.log('Microphone access granted');
      setLocalStream(stream);
      localStreamRef.current = stream;

      // Assign local stream (for echo/debug only)
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      setStatus('searching');
      socketRef.current.emit('searchPartner');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Cannot access microphone. Please allow access and refresh.');
    }
  };

  const stopSearching = () => {
    setStatus('disconnected');
    socketRef.current.emit('stopSearch');
    endCall();
    stopTimer();
  };

  const disconnectCall = () => {
    setStatus('disconnected');
    setPartnerId(null);
    socketRef.current.emit('leaveCall');
    endCall();
    stopTimer();
  };

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const newMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !newMuted; // disable track when muted
    });
    setIsMuted(newMuted);
  };

  const createPeerConnection = (remotePartnerId) => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
    };

    const pc = new RTCPeerConnection(configuration);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      console.log('Remote track received:', event.track.kind);
      const stream = event.streams[0];
      setRemoteStream(stream);
      setRemoteTrackInfo(`${event.streams.length} stream(s), ${stream?.getAudioTracks().length} audio track(s)`);

      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;

        // Attempt to play immediately
        remoteAudioRef.current.play().catch(e => {
          console.warn('Remote audio play blocked (expected before interaction):', e);
        });
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: remotePartnerId
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE state changed:', pc.iceConnectionState);
      setIceStatus(pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected') {
        console.log('ICE Connected! Audio should be flowing.');
      }
      if (pc.iceConnectionState === 'failed') {
        console.error('ICE Connection Failed');
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state changed:', pc.connectionState);
    };

    return pc;
  };

  const checkStats = async () => {
    if (!peerConnectionRef.current) {
      alert('No connection');
      return;
    }
    const stats = await peerConnectionRef.current.getStats();
    let statsOutput = '';

    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        statsOutput += `Inbound Audio: ${report.bytesReceived} bytes received, ${report.packetsLost} packets lost\n`;
      }
      if (report.type === 'outbound-rtp' && report.kind === 'audio') {
        statsOutput += `Outbound Audio: ${report.bytesSent} bytes sent\n`;
      }
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        statsOutput += `Round Trip Time: ${report.currentRoundTripTime}s\n`;
      }
    });

    console.log(statsOutput);
    alert(statsOutput || 'No audio RTP stats found yet (wait a few seconds)');
  };

  const startCall = async (partnerId) => {
    if (!localStreamRef.current) return;

    peerConnectionRef.current = createPeerConnection(partnerId);

    try {
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await peerConnectionRef.current.setLocalDescription(offer);

      socketRef.current.emit('offer', {
        offer,
        to: partnerId
      });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  };

  const handleOffer = async (offer, from) => {
    console.log('Handling offer from:', from);
    if (!localStreamRef.current) {
      console.warn('No local stream, cannot handle offer');
      return;
    }

    setPartnerId(from);
    setStatus('connected');
    startTimer();

    peerConnectionRef.current = createPeerConnection(from);

    try {
      await peerConnectionRef.current.setRemoteDescription(offer);
      isRemoteDescriptionSet.current = true;
      console.log('Remote description set (Offer)');

      // Process queued candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        console.log('Adding queued ICE candidate');
        await peerConnectionRef.current.addIceCandidate(candidate);
      }

      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);

      socketRef.current.emit('answer', { answer, to: from });
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  };

  const handleAnswer = async (answer) => {
    console.log('Handling answer');
    if (!peerConnectionRef.current) return;
    try {
      await peerConnectionRef.current.setRemoteDescription(answer);
      isRemoteDescriptionSet.current = true;
      console.log('Remote description set (Answer)');

      // Process queued candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        console.log('Adding queued ICE candidate');
        await peerConnectionRef.current.addIceCandidate(candidate);
      }
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  };

  const handleIceCandidate = async (candidate) => {
    console.log('Received ICE candidate');
    if (peerConnectionRef.current && candidate) {
      if (isRemoteDescriptionSet.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
          console.log('Added ICE candidate immediately');
        } catch (e) {
          console.error('Error adding ICE candidate:', e);
        }
      } else {
        console.log('Queuing ICE candidate (Remote description not set)');
        iceCandidatesQueue.current.push(candidate);
      }
    }
  };

  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      setLocalStream(null);
      localStreamRef.current = null;
    }

    setRemoteStream(null);
    if (localAudioRef.current) localAudioRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setIsMuted(false);

    // Reset refs
    isRemoteDescriptionSet.current = false;
    iceCandidatesQueue.current = [];
    setIceStatus('new');
    setRemoteTrackInfo('No tracks');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500">
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <h1 className="text-3xl font-bold text-white">VoiceChat</h1>
            <div className="flex items-center gap-4 bg-white/20 rounded-full px-6 py-3">
              <div className={`w-3 h-3 rounded-full ${status === 'connected' ? 'bg-green-400 animate-pulse' :
                  status === 'searching' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
                }`}></div>
              <span className="text-white font-semibold capitalize">
                {status === 'connected' ? 'Connected' : status === 'searching' ? 'Searching...' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Hidden Audio Elements - Critical: NO muted, NO display:none */}
      <audio ref={localAudioRef} autoPlay playsInline muted className="hidden" />
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[70vh]">

          {/* Disconnected */}
          {status === 'disconnected' && (
            <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
              <div className="w-24 h-24 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                <span className="text-5xl">Microphone</span>
              </div>
              <h2 className="text-3xl font-bold text-gray-800 mb-4">Start Voice Chat</h2>
              <p className="text-gray-600 mb-8 text-lg">Talk to random people worldwide</p>
              <button onClick={startSearching} className="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg px-8 py-4 rounded-full hover:scale-105 transition shadow-lg">
                Find a Partner
              </button>
            </div>
          )}

          {/* Searching */}
          {status === 'searching' && (
            <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
              <div className="w-20 h-20 border-8 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Searching for Partner...</h2>
              <p className="text-gray-600 mb-8">Finding someone to talk to</p>
              <button onClick={stopSearching} className="bg-red-500 text-white px-6 py-3 rounded-full hover:bg-red-600 transition">
                Stop Searching
              </button>
            </div>
          )}

          {/* Connected */}
          {status === 'connected' && (
            <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full">
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-gradient-to-r from-green-400 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                  <span className="text-4xl">Connected</span>
                </div>
                <h2 className="text-3xl font-bold text-gray-800">You're Connected!</h2>
                <p className="text-2xl font-mono text-green-600 mt-4">{formatTime(connectionTime)}</p>

                {/* Diagnostics */}
                <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-500 font-mono">
                  ICE: {iceStatus} | Remote: {remoteTrackInfo}
                </div>
                <button
                  onClick={checkStats}
                  className="mt-2 text-xs bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700 transition"
                >
                  Check WebRTC Stats (Bytes Received)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="bg-green-50 rounded-xl p-6 text-center border-2 border-green-200">
                  <p className="text-sm text-gray-600">Your Mic</p>
                  <p className={`text-2xl font-bold ${isMuted ? 'text-red-500' : 'text-green-500'}`}>
                    {isMuted ? 'Muted' : 'Live'}
                  </p>
                </div>
                <div className="bg-blue-50 rounded-xl p-6 text-center border-2 border-blue-200">
                  <p className="text-sm text-gray-600">Partner</p>
                  <p className="text-2xl font-bold text-blue-500">
                    {remoteStream ? 'Live' : 'Connecting...'}
                  </p>
                  {remoteStream && (
                    <button
                      onClick={() => {
                        if (remoteAudioRef.current) {
                          remoteAudioRef.current.play().catch(e => console.error(e));
                        }
                      }}
                      className="mt-2 text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition"
                    >
                      Force Play Audio
                    </button>
                  )}
                </div>
              </div>

              <div className="flex justify-center gap-6">
                <button
                  onClick={toggleMute}
                  className={`px-8 py-4 rounded-full font-bold text-lg transition flex items-center gap-3 ${isMuted
                      ? 'bg-orange-500 hover:bg-orange-600 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                    }`}
                >
                  {isMuted ? 'Unmute' : 'Mute'} {isMuted ? 'Muted' : 'Speaking'}
                </button>

                <button
                  onClick={disconnectCall}
                  className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-full font-bold text-lg transition flex items-center gap-3"
                >
                  End Call
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white/10 backdrop-blur-md border-t border-white/20 mt-auto">
        <div className="container mx-auto px-4 py-6 text-center text-white/80">
          <p>VoiceChat • Random voice connections • Built with WebRTC</p>
        </div>
      </footer>
    </div>
  );
};

export default App;