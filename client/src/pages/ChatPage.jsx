  import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import socket from "../services/socket";
import EditProfileModal from "../components/EditProfileModal.jsx";
import StoryBar from "../components/StoryBar.jsx";
import StoryViewer from "../components/StoryViewer.jsx";

const QUICK_REACTIONS = ["👍", "❤️", "😂"];

function idEqual(a, b) {
  return (a && b && a.toString()) === (b && b.toString());
}

function MessageFileBlock({ message: m, mine }) {
  if (!m.fileUrl) return null;
  const isImage = (m.fileType || "").startsWith("image/");
  return (
    <div className="mb-2">
      {isImage ? (
        <a href={m.fileUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={m.fileUrl}
            alt=""
            className="max-h-56 max-w-full rounded-xl object-cover shadow-md"
          />
        </a>
      ) : (
        <a
          href={m.fileUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex max-w-full items-center gap-2 truncate rounded-xl px-4 py-2.5 text-sm font-semibold shadow transition ${
            mine
              ? "bg-white/20 text-white hover:bg-white/30"
              : "bg-slate-100 text-indigo-700 ring-1 ring-slate-200 hover:bg-slate-200"
          }`}
        >
          <span aria-hidden>{"\u{1F4CE}"}</span>
          <span className="truncate">{m.fileName || "File"}</span>
        </a>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { user, logout, token, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [typingUser, setTypingUser] = useState(null);
  const incomingTypingClear = useRef(null);
  const outgoingTypingTimer = useRef(null);
  const bottomRef = useRef(null);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(null);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showStoryViewer, setShowStoryViewer] = useState(null);
  const [storyViewerData, setStoryViewerData] = useState({ user: null, stories: [], index: 0 });
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [callState, setCallState] = useState("idle");
  const [callError, setCallError] = useState("");
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // Debug scroll containers
    const debugScroll = () => {
      const mainContainer = document.querySelector('.flex.h-screen');
      const sidebarScroll = document.querySelector('aside .overflow-y-auto');
      const chatScroll = document.querySelector('section .overflow-y-auto');

      console.log('=== SCROLL DEBUG ===');
      console.log('Main container height:', mainContainer?.clientHeight);
      console.log('Sidebar scroll height:', sidebarScroll?.clientHeight);
      console.log('Chat scroll height:', chatScroll?.clientHeight);
      console.log('Window height:', window.innerHeight);
    };

    // Debug on mount and when selected changes
    debugScroll();
  }, [selected]);
  const [callType, setCallType] = useState("audio");
  const [callLabel, setCallLabel] = useState("");
  const [callPartner, setCallPartner] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const incomingOfferRef = useRef(null);
  const pendingCallTarget = useRef(null);
  const currentCallConv = useRef(null);

  const clearPendingFile = useCallback(() => {
    setPendingFile((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const getDirectPeerId = useCallback(
    (conv) => {
      if (!conv || conv.type !== "direct" || !Array.isArray(conv.members)) return null;
      const peer = conv.members.find((m) => !idEqual(m._id || m, user._id));
      return peer?._id?.toString() || peer?.toString() || null;
    },
    [user._id],
  );

  const cleanupCall = useCallback(() => {
    console.log("[client] Cleaning up call");
    stopTimer();
    resetTimer();
    setCallState("idle");
    setCallLabel("");
    setCallPartner(null);
    setCallError("");
    currentCallConv.current = null;
    pendingCallTarget.current = null;
    incomingOfferRef.current = null;
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    // Stop local stream tracks but don't clear state if called from error recovery
    setLocalStream((stream) => {
      if (stream) {
        console.log("[client] Stopping local stream tracks");
        stream.getTracks().forEach((track) => track.stop());
      }
      return null;
    });
    setRemoteStream((stream) => {
      if (stream) {
        console.log("[client] Stopping remote stream tracks");
        stream.getTracks().forEach((track) => track.stop());
      }
      return null;
    });
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && currentCallConv.current) {
        socket.emit("ice-candidate", {
          conversationId: currentCallConv.current,
          toUserId: pendingCallTarget.current,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("[client] ontrack received:", event.streams);
      console.log("[client] Track types:", event.streams[0]?.getTracks().map(t => t.kind));
      
      if (event.streams[0]) {
        setRemoteStream(event.streams[0]);
        
        // Handle remote audio playback
        if (remoteAudioRef.current) {
          console.log("[client] Setting remote audio stream");
          remoteAudioRef.current.srcObject = event.streams[0];
        }
        
        // Handle remote video playback
        if (remoteVideoRef.current && event.streams[0].getVideoTracks().length > 0) {
          console.log("[client] Setting remote video stream");
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const pc = peerConnectionRef.current;
      if (!pc || !pc.connectionState) return;
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        cleanupCall();
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [cleanupCall]);

  const getMediaStream = useCallback(async (type) => {
    console.log("[client] Creating stream once only for type:", type);
    
    // Clean up any existing stream before creating new one
    if (localStream) {
      console.log("[client] Stopping existing stream before creating new one");
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    try {
      let stream;
      if (type === "video") {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user"
          },
          audio: true
        });
      } else {
        // Audio-only call - ensure audio only
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true
        });
      }
      
      // Ensure microphone is enabled
      stream.getAudioTracks().forEach(track => {
        console.log("[client] Enabling audio track:", track.kind, track.enabled);
        track.enabled = true;
      });
      
      console.log("[client] Stream created successfully, tracks:", stream.getTracks());
      console.log("[client] Audio tracks:", stream.getAudioTracks());
      console.log("[client] Video tracks:", stream.getVideoTracks());
      
      return stream;
    } catch (err) {
      console.error("[client] getMediaStream error:", err.name, err.message);
      
      // Fallback to audio if video fails
      if (type === "video" && (err.name === 'NotReadableError' || err.name === 'NotFoundError')) {
        console.log("[client] Video failed, falling back to audio-only");
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true
          });
          // Ensure microphone is enabled in fallback
          audioStream.getAudioTracks().forEach(track => {
            track.enabled = true;
          });
          console.log("[client] Audio fallback successful, tracks:", audioStream.getTracks());
          return audioStream;
        } catch (audioErr) {
          console.error("[client] Audio fallback also failed:", audioErr.name, audioErr.message);
          throw audioErr;
        }
      }
      
      throw err;
    }
  }, [localStream, setLocalStream]);

  // Timer functions
  const startTimer = () => {
    if (timerRef.current) return;
    
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetTimer = () => {
    setCallDuration(0);
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const startCall = useCallback(
    async (type) => {
      if (!selected?._id || !socket.connected || selected.type !== "direct") return;
      const targetUserId = getDirectPeerId(selected);
      if (!targetUserId) return;

      // Prevent multiple calls
      if (callState !== "idle") {
        console.log("[client] Cannot start call - not idle, current state:", callState);
        return;
      }

      setCallType(type);
      setCallState("calling");
      setCallLabel(type === "video" ? "Calling with video..." : "Calling...");
      setCallPartner({ userId: targetUserId, username: selected.title, conversationId: selected._id });
      currentCallConv.current = selected._id;
      pendingCallTarget.current = targetUserId;
      setCallError("");
      setAudioEnabled(true);
      setVideoEnabled(type === "video");

      try {
        const pc = createPeerConnection();
        console.log("[client] Peer connection created");
        
        // Use single getMediaStream function
        const stream = await getMediaStream(type);
        setLocalStream(stream);
        
        // Add all tracks to peer connection with detailed logging
        console.log("[client] Adding tracks to peer connection:");
        stream.getTracks().forEach((track) => {
          console.log("[client] Adding track:", track.kind, "enabled:", track.enabled, "id:", track.id);
          pc.addTrack(track, stream);
        });
        
        // Ensure audio tracks are enabled
        stream.getAudioTracks().forEach(track => {
          console.log("[client] Audio track status:", track.enabled, track.readyState);
          track.enabled = true;
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log("[client] offer created", { conversationId: selected._id, targetUserId, type });

        console.log("[client] Call Type:", type);
        socket.emit(
          "call-user",
          { conversationId: selected._id, targetUserId, offer, callType: type },
          (res) => {
            if (!res?.ok) {
              console.warn("[client] call-user failed", res?.error);
              setCallError(res?.error || "Unable to place call");
              cleanupCall();
            } else {
              startTimer();
            }
          },
        );
      } catch (err) {
      console.error("[client] Camera error:", err.name, err.message);
      console.error("[client] Full error:", err);
      
      if (err.name === 'NotReadableError') {
        setCallError("Camera is busy. Continuing with audio-only call.");
      } else if (err.name === 'NotAllowedError') {
        setCallError("Camera/microphone access denied. Please allow permissions and try again.");
      } else if (err.name === 'NotFoundError') {
        setCallError("No camera device found. Please check your camera connection.");
      } else {
        setCallError(err?.message || "Call failed");
      }
      // Don't call cleanupCall() - let user retry or continue with audio
    }
    },
    [selected, getDirectPeerId, createPeerConnection, cleanupCall, getMediaStream],
  );

  const acceptCall = useCallback(async () => {
    if (!callPartner?.userId || !incomingOfferRef.current) return;
    const remoteOffer = incomingOfferRef.current;
    const callType = remoteOffer?.callType ?? "audio";
    console.log("[client] CALL TYPE RECEIVED:", callType);
    console.log("[client] Remote offer payload:", remoteOffer);
    
    // Prevent multiple calls
    if (callState !== "incoming") {
      console.log("[client] Cannot accept call - not in incoming state, current state:", callState);
      return;
    }
    
    // Update state before getting media
    setCallType(callType);
    setCallLabel("Connecting...");
    currentCallConv.current = callPartner.conversationId;
    pendingCallTarget.current = callPartner.userId;
    setAudioEnabled(true);
    setVideoEnabled(callType === "video");

    let pc = null;
    
    try {
      // Create peer connection first
      pc = createPeerConnection();
      console.log("[client] Peer connection created");
      
      // Use single getMediaStream function
      const stream = await getMediaStream(callType);
      setLocalStream(stream);
      
      // Add all tracks to peer connection with detailed logging
      console.log("[client] Adding tracks to peer connection in accept:");
      stream.getTracks().forEach((track) => {
        console.log("[client] Adding track:", track.kind, "enabled:", track.enabled, "id:", track.id);
        pc.addTrack(track, stream);
      });
      
      // Ensure audio tracks are enabled
      stream.getAudioTracks().forEach(track => {
        console.log("[client] Audio track status in accept:", track.enabled, track.readyState);
        track.enabled = true;
      });

      // Set remote description and create answer
      await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer.offer));
      console.log("[client] Remote description set");
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log("[client] answer created", callPartner, { callType });

      // Send answer to server
      socket.emit(
        "accept-call",
        { conversationId: callPartner.conversationId, toUserId: callPartner.userId, answer },
        (res) => {
          if (!res?.ok) {
            console.warn("[client] accept-call failed", res?.error);
            setCallError(res?.error || "Unable to accept call");
            cleanupCall();
          } else {
            console.log("[client] accept-call successful");
            setCallState("in-call");
            setCallLabel(callType === "video" ? "Video Call" : "Audio Call");
            startTimer();
          }
        },
      );
    } catch (err) {
      console.error("[client] Camera error:", err.name, err.message);
      console.error("[client] Full error:", err);
      
      if (err.name === 'NotReadableError') {
        setCallError("Camera is busy. Continuing with audio-only call.");
      } else if (err.name === 'NotAllowedError') {
        setCallError("Camera/microphone access denied. Please allow permissions and try again.");
      } else if (err.name === 'NotFoundError') {
        setCallError("No camera device found. Please check your camera connection.");
      } else {
        setCallError(err?.message || "Accept failed");
      }
      
      // Cleanup peer connection only
      if (pc) {
        pc.close();
      }
      // Don't call cleanupCall() - let user retry or continue with audio
    }
  }, [callPartner, createPeerConnection, cleanupCall]);

  const rejectCall = useCallback(() => {
    if (!callPartner?.userId || !callPartner?.conversationId) {
      cleanupCall();
      return;
    }
    socket.emit(
      "reject-call",
      { conversationId: callPartner.conversationId, toUserId: callPartner.userId },
      (res) => {
        if (!res?.ok) console.warn("[client] reject-call failed", res?.error);
      },
    );
    cleanupCall();
  }, [callPartner, cleanupCall]);

  const endCall = useCallback(() => {
    const targetUserId = callPartner?.userId || pendingCallTarget.current;
    const conversationId = currentCallConv.current;
    if (targetUserId && conversationId) {
      socket.emit(
        "end-call",
        { conversationId, toUserId: targetUserId },
        (res) => {
          if (!res?.ok) console.warn("[client] end-call failed", res?.error);
        },
      );
    }
    cleanupCall();
  }, [callPartner, cleanupCall]);

  const toggleMute = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      localStream?.getAudioTracks().forEach((track) => {
        track.enabled = next;
      });
      return next;
    });
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      localStream?.getVideoTracks().forEach((track) => {
        track.enabled = next;
      });
      return next;
    });
  }, [localStream]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
    if (localAudioRef.current) localAudioRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    const onIncomingCall = async (payload) => {
      if (!payload || !payload.conversationId || !payload.fromUserId) return;
      
      // Prevent multiple calls and state conflicts
      if (callState !== "idle") {
        console.log("[client] Rejecting call - not idle, current state:", callState);
        socket.emit("reject-call", {
          conversationId: payload.conversationId,
          toUserId: payload.fromUserId,
        });
        return;
      }
      
      // Prevent duplicate incoming calls for same conversation
      if (incomingOfferRef.current?.conversationId === payload.conversationId) {
        console.log("[client] Duplicate incoming call detected, ignoring");
        return;
      }
      
      console.log("[client] Incoming call payload:", payload);
      const callType = payload.callType || "audio";
      console.log("[client] CALL TYPE:", callType);
      
      // Set call state first
      setCallPartner({
        userId: payload.fromUserId,
        username: payload.fromUsername || "Caller",
        conversationId: payload.conversationId,
      });
      incomingOfferRef.current = payload;
      setCallType(callType);
      setCallState("incoming");
      setCallLabel(callType === "video" ? "Incoming video call" : "Incoming audio call");
      setCallError("");
    };

    const onCallAccepted = (payload) => {
      if (!payload || payload.conversationId !== currentCallConv.current) return;
      const pc = peerConnectionRef.current;
      if (!pc || !payload.answer) return;
      pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
      setCallState("in-call");
      setCallLabel(callType === "video" ? "Video Call" : "Audio Call");
      console.log("[client] answer received", payload);
    };

    const onCallRejected = (payload) => {
      if (!payload || payload.conversationId !== currentCallConv.current) return;
      setCallError("Call was rejected");
      cleanupCall();
      console.log("[client] call rejected", payload);
    };

    const onIceCandidate = (payload) => {
      if (!payload || payload.conversationId !== currentCallConv.current) return;
      const pc = peerConnectionRef.current;
      if (!pc || !payload.candidate) return;
      pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch((err) => {
        console.warn("[client] addIceCandidate failed", err);
      });
    };

    const onEndCall = (payload) => {
      if (!payload || payload.conversationId !== currentCallConv.current) return;
      cleanupCall();
      console.log("[client] call ended by peer", payload);
    };

    socket.on("incoming-call", onIncomingCall);
    socket.on("call-accepted", onCallAccepted);
    socket.on("call-rejected", onCallRejected);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("end-call", onEndCall);

    return () => {
      socket.off("incoming-call", onIncomingCall);
      socket.off("call-accepted", onCallAccepted);
      socket.off("call-rejected", onCallRejected);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("end-call", onEndCall);
    };
  }, [callState, cleanupCall]);

  useEffect(() => {
    const loadConversations = async () => {
      setLoadingList(true);
      try {
        const { data } = await api.get("/conversations");
        setConversations(data.conversations || []);
      } catch {
        setConversations([]);
      } finally {
        setLoadingList(false);
      }
    };
    loadConversations();
  }, []);

  useEffect(() => {
    if (!selected?._id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    const loadMessages = async (convId) => {
      if (!convId) return;
      setLoadingMessages(true);
      try {
        const { data } = await api.get(`/conversations/${convId}/messages?limit=80`);
        setMessages(data.messages || []);
      } catch {
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    };
    loadMessages(selected._id);
  }, [selected?._id]);

  useEffect(() => {
    if (!selected?._id) return;
    const join = () => {
      socket.emit("join-conversation", selected._id, (res) => {
        if (!res?.ok) console.warn("[chat] join-conversation:", res?.error);
      });
    };
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      socket.emit("leave-conversation", selected._id);
    };
  }, [selected?._id, token]);

  useEffect(() => {
    const onNew = ({ conversationId, message }) => {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c._id === conversationId
            ? {
                ...c,
                lastMessageAt: message.createdAt || new Date().toISOString(),
                lastMessagePreview: (message.text || message.fileName || "File").slice(0, 120),
              }
            : c,
        );
        return [...next].sort(
          (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0),
        );
      });
      if (selected?._id === conversationId) {
        setMessages((prev) => {
          if (prev.some((m) => m._id === message._id)) return prev;
          return [...prev, message];
        });
      }
    };

    const onTyping = ({ conversationId, userId, username, isTyping }) => {
      if (selected?._id !== conversationId) return;
      if (idEqual(userId, user._id)) return;
      if (isTyping) {
        setTypingUser(username || "Someone");
        if (incomingTypingClear.current) clearTimeout(incomingTypingClear.current);
        incomingTypingClear.current = setTimeout(() => setTypingUser(null), 2500);
      } else {
        setTypingUser(null);
      }
    };

    const onRead = ({ conversationId, messageIds, readByUserId }) => {
      if (selected?._id !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (!messageIds.includes(m._id)) return m;
          const mine = idEqual(m.sender?._id || m.sender, user._id);
          if (!mine) return m;
          const already = (m.readBy || []).some((r) =>
            idEqual(r.user?._id || r.user, readByUserId),
          );
          if (already) return m;
          return {
            ...m,
            readBy: [
              ...(m.readBy || []),
              { user: readByUserId, readAt: new Date().toISOString() },
            ],
          };
        }),
      );
    };

    const onReaction = ({ conversationId, messageId, reactions }) => {
      if (selected?._id !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => (m._id === messageId ? { ...m, reactions } : m)),
      );
    };

    const onMessageEdited = ({ conversationId, message }) => {
      if (selected?._id !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m._id === message._id ? { ...m, ...message } : m)));
    };

    const onMessageDeleted = ({ conversationId, messageId, forEveryone }) => {
      if (selected?._id !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? {
                ...m,
                deleted: true,
                deletedAt: new Date().toISOString(),
                text: forEveryone ? "" : m.text,
                fileUrl: forEveryone ? "" : m.fileUrl,
                fileName: forEveryone ? "" : m.fileName,
                fileType: forEveryone ? "" : m.fileType,
              }
            : m,
        ),
      );
    };

    socket.on("new-message", onNew);
    socket.on("typing", onTyping);
    socket.on("read-receipt", onRead);
    socket.on("reaction-updated", onReaction);
    socket.on("message-edited", onMessageEdited);
    socket.on("message-deleted", onMessageDeleted);

    return () => {
      socket.off("new-message", onNew);
      socket.off("typing", onTyping);
      socket.off("read-receipt", onRead);
      socket.off("reaction-updated", onReaction);
      socket.off("message-edited", onMessageEdited);
      socket.off("message-deleted", onMessageDeleted);
    };
  }, [selected?._id, user._id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selected?._id]);

  useEffect(() => {
    if (!selected?._id || !messages.length || !socket.connected) return;
    const me = user._id;
    const ids = messages
      .filter((m) => {
        const sid = m.sender?._id || m.sender;
        if (idEqual(sid, me)) return false;
        const read = (m.readBy || []).some((r) => {
          const uid = r.user?._id || r.user;
          return idEqual(uid, me);
        });
        return !read;
      })
      .map((m) => m._id);
    if (ids.length) {
      socket.emit("mark-read", { conversationId: selected._id, messageIds: ids });
    }
  }, [messages, selected?._id, user._id]);

  const sendTyping = useCallback(
    (isTyping) => {
      if (!socket.connected || !selected?._id) return;
      socket.emit("typing", { conversationId: selected._id, isTyping });
    },
    [selected],
  );

  const handleInput = (v) => {
    setInput(v);
    sendTyping(true);
    if (outgoingTypingTimer.current) clearTimeout(outgoingTypingTimer.current);
    outgoingTypingTimer.current = setTimeout(() => sendTyping(false), 1200);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!selected?._id || !socket.connected || uploading) return;
    if (!text && !pendingFile) return;

    let fileMeta = null;
    if (pendingFile) {
      setUploading(true);
      try {
        console.log("[client] file upload start", pendingFile.file.name);
        const form = new FormData();
        form.append("file", pendingFile.file);
        const { data } = await api.post("/messages/upload", form);
        fileMeta = {
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileType: data.fileType,
        };
        console.log("[client] file upload success", data.fileName);
      } catch (err) {
        console.warn("[client] file upload failed", err?.response?.data?.message || err.message);
        setUploading(false);
        return;
      }
      setUploading(false);
      clearPendingFile();
    }

    setInput("");
    setReplyTo(null);
    sendTyping(false);
    socket.emit(
      "send-message",
      {
        conversationId: selected._id,
        text,
        replyTo: replyTo?._id,
        ...fileMeta
      },
      (res) => {
        if (!res?.ok) console.warn("[chat] send failed", res?.error);
      },
    );
  };

  const onFilePick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const previewUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    setPendingFile({ file: f, previewUrl });
  };

  const toggleReaction = (messageId, emoji) => {
    if (!socket.connected || !selected?._id) return;
    socket.emit("add-reaction", {
      conversationId: selected._id,
      messageId,
      emoji,
    });
  };

  const replyToMessage = (message) => {
    setReplyTo(message);
  };

  const editMessage = (message) => {
    setEditingMessage(message);
    setEditText(message.text);
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setEditText("");
  };

  const saveEdit = () => {
    if (!editingMessage || !editText.trim()) return;
    socket.emit("edit-message", {
      messageId: editingMessage._id,
      text: editText.trim(),
    }, (res) => {
      if (res.ok) {
        setEditingMessage(null);
        setEditText("");
      }
    });
  };

  const deleteMessage = (messageId, forEveryone = false) => {
    socket.emit("delete-message", {
      messageId,
      forEveryone,
    });
  };

  const handleAddStory = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        // WhatsApp-style validation
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
          alert('File size too large. Maximum size is 50MB.');
          return;
        }
        
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
          alert('Please select an image or video file.');
          return;
        }
        
        const formData = new FormData();
        formData.append('media', file);
        
        try {
          console.log('Uploading story file:', file.name, 'Size:', file.size, 'Type:', file.type);
          
          // Show upload progress
          const progressDiv = document.createElement('div');
          progressDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-xl p-4 z-50';
          progressDiv.innerHTML = `
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 border-2 border-blue-500 rounded-full animate-spin"></div>
              <div>
                <p class="font-semibold">Uploading story...</p>
                <p class="text-sm text-gray-600">${file.name}</p>
              </div>
            </div>
          `;
          document.body.appendChild(progressDiv);
          
          const response = await api.post('/stories', formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          });
          
          console.log('Story upload response:', response.data);
          
          // Remove progress indicator
          document.body.removeChild(progressDiv);
          
          if (response.data?.success) {
            alert('✅ Story uploaded successfully!');
            // Optional: Force StoryBar to refetch
            const event = new CustomEvent('storyUploaded');
            window.dispatchEvent(event);
          } else {
            console.error('Story upload failed:', response.data?.message);
            alert('❌ Failed to upload story: ' + (response.data?.message || 'Unknown error'));
          }
        } catch (error) {
          console.error('Failed to upload story:', error);
          alert('❌ Failed to upload story. Please try again.');
          // Remove progress indicator if error
          const progressDiv = document.querySelector('.fixed.top-20');
          if (progressDiv) document.body.removeChild(progressDiv);
        }
      }
    };
    input.click();
  };

  const handleStoryClick = (user, stories) => {
    setShowStoryViewer(null);
    setTimeout(() => {
      setStoryViewerData({ user, stories, index: 0 });
      setShowStoryViewer(true);
    }, 0);
  };



  const title = useMemo(() => selected?.title || "Select a chat", [selected]);
  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) => {
      const titleText = conversation.title?.toLowerCase() || "";
      const preview = (conversation.lastMessagePreview || "").toLowerCase();
      return titleText.includes(query) || preview.includes(query);
    });
  }, [conversations, searchQuery]);

  const selectedPeer = useMemo(() => {
    if (!selected || selected.type !== "direct" || !Array.isArray(selected.members)) return null;
    return selected.members.find((m) => !idEqual(m._id || m, user._id));
  }, [selected, user._id]);

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <aside className="flex w-full max-w-sm flex-col h-full border-r border-slate-200/60 bg-white/95 shadow-xl backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-slate-100/60 px-6 py-4">
          <div className="flex items-center gap-3">
            {user?.avatar ? (
              <div className="relative">
                <img
                  src={user.avatar}
                  alt=""
                  className="h-10 w-10 rounded-full border-2 border-white shadow-md cursor-pointer hover:scale-105 transition-transform object-cover"
                  onClick={() => setShowEditProfileModal(true)}
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-white shadow-sm"></span>
              </div>
            ) : (
              <div className="relative">
                <div 
                  className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold shadow-md cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => setShowEditProfileModal(true)}
                >
                  {user?.username?.charAt(0).toUpperCase() || '?'}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-white shadow-sm"></span>
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
                SMARTCHAT
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">{user?.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/rave")}
              className="rounded-xl bg-gradient-to-r from-pink-600 via-red-600 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition-all duration-200 hover:from-pink-500 hover:via-red-500 hover:to-purple-500 hover:shadow-lg active:scale-95"
            >
              RAVE Party
            </button>
          </div>
        </div>
        <div className="flex gap-3 border-b border-slate-100/60 px-4 py-4">
          <button
            type="button"
            onClick={() => setShowUserSearch(true)}
            className="flex-1 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 py-3 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => setShowGroupModal(true)}
            className="flex-1 rounded-2xl border border-slate-200/60 bg-white/95 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] backdrop-blur-sm"
          >
            New group
          </button>
        </div>
        <div className="px-4 py-4">
          <div className="relative">
            <input
              id="searchChats"
              name="searchChats"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-2xl border border-slate-200/60 bg-slate-50/90 px-4 py-3 pl-10 text-sm text-slate-700 outline-none ring-indigo-500/30 transition-all duration-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 focus:bg-white shadow-sm"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {loadingList ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-slate-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"></div>
                <span className="text-sm">Loading chats…</span>
              </div>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 text-4xl">💬</div>
              <p className="text-slate-500">No conversations yet.</p>
              <p className="text-xs text-slate-400 mt-1">Start a new chat to get connected!</p>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const peer = c.members?.find((m) => !idEqual(m._id || m, user._id));
              const statusLabel =
                c.type === "group"
                  ? `${c.members?.length || 0} members`
                  : peer?.isOnline
                  ? "Online"
                  : "Offline";
              const timeLabel = c.lastMessageAt
                ? new Date(c.lastMessageAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";

              return (
                <button
                  key={c._id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`mb-3 w-full rounded-2xl px-4 py-4 text-left transition-all duration-300 ${
                    selected?._id === c._id 
                      ? "bg-gradient-to-r from-indigo-50 to-blue-50 ring-2 ring-indigo-200/50 shadow-lg scale-[1.02] border border-indigo-200/30" 
                      : "hover:bg-slate-50/80 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] border border-transparent"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {c.type === "direct" && peer?.avatar ? (
                        <div className="relative">
                          <img
                            src={peer.avatar}
                            alt=""
                            className="h-12 w-12 rounded-full border-2 border-white shadow-md object-cover"
                          />
                          {peer?.isOnline && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-green-500 border-2 border-white shadow-sm"></span>
                          )}
                        </div>
                      ) : c.type === "direct" ? (
                        <div className="relative">
                          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold shadow-md">
                            {peer?.username?.charAt(0).toUpperCase() || '?'}
                          </div>
                          {peer?.isOnline && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-green-500 border-2 border-white shadow-sm"></span>
                          )}
                        </div>
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white font-semibold shadow-md">
                          {c.title?.charAt(0).toUpperCase() || '?'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{c.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {c.type === "group" ? `${c.members?.length || 0} members` : peer?.isOnline ? "Online" : "Offline"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {timeLabel && <span className="text-[11px] text-slate-400">{timeLabel}</span>}
                      {c.unreadCount > 0 ? (
                        <span className="rounded-full bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white shadow-sm">
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="truncate text-sm text-slate-600">
                    {c.lastMessagePreview || (c.type === "group" ? "Group chat" : "Direct message")}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex flex-col flex-1 h-full bg-gradient-to-br from-white via-slate-50/30 to-indigo-50/40">
        {/* Story Bar */}
        <StoryBar onStoryClick={handleStoryClick} onAddStory={handleAddStory} />
        
        <header className="sticky top-0 z-10 flex-shrink-0 border-b border-slate-200/60 bg-white/95 px-6 py-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {selected?.type === "direct" && selectedPeer?.avatar ? (
                <div className="relative">
                  <img
                    src={selectedPeer.avatar}
                    alt=""
                    className="h-14 w-14 rounded-full border-2 border-white shadow-lg cursor-pointer hover:scale-105 transition-transform object-cover"
                    onClick={() => setShowProfileModal(selectedPeer)}
                  />
                  {selectedPeer?.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-green-500 border-3 border-white shadow-md"></span>
                  )}
                </div>
              ) : selected?.type === "direct" ? (
                <div className="relative">
                  <div 
                    className="h-14 w-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg cursor-pointer hover:scale-105 transition-transform"
                    onClick={() => setShowProfileModal(selectedPeer)}
                  >
                    {selectedPeer?.username?.charAt(0).toUpperCase() || '?'}
                  </div>
                  {selectedPeer?.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-green-500 border-3 border-white shadow-md"></span>
                  )}
                </div>
              ) : selected?.type === "group" ? (
                <div className="h-14 w-14 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white font-bold shadow-lg">
                  {selected.title?.charAt(0).toUpperCase() || '?'}
                </div>
              ) : null}
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
                {selected ? (
                  <p className="text-sm text-slate-500 mt-1">
                    {selected.type === "group"
                      ? `${(selected.members || []).length} members`
                      : selectedPeer?.isOnline
                      ? "Active now"
                      : `Offline${selectedPeer?.lastSeen ? ` • ${new Date(selectedPeer.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ""}`}
                  </p>
                ) : null}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {callState !== "idle" ? (
                <span className="rounded-full bg-indigo-100 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm">
                  {callLabel}
                </span>
              ) : null}
              
              {selected && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      console.log("Audio call clicked");
                      startCall("audio");
                    }}
                    disabled={!socket.connected || callState !== "idle"}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 shadow-md transition-all duration-200 hover:bg-slate-200 hover:shadow-lg active:scale-95 disabled:opacity-50"
                    title="Audio call"
                  >
                    <span className="text-lg">📞</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      console.log("Video call clicked");
                      startCall("video");
                    }}
                    disabled={!socket.connected || callState !== "idle"}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 shadow-md transition-all duration-200 hover:bg-slate-200 hover:shadow-lg active:scale-95 disabled:opacity-50"
                    title="Video call"
                  >
                    <span className="text-lg">🎥</span>
                  </button>
                </>
              )}
              
              {/* 3-dot Menu */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 transition-all duration-200"
                  title="Menu"
                >
                  <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a.75.75 0 110-1.5.75.75 0 010 1.5zm0 7a.75.75 0 110-1.5.75.75 0 010 1.5zm0 7a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                  </svg>
                </button>
                
                {/* Dropdown Menu */}
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-slate-200 z-50">
                    <button
                      onClick={() => {
                        logout();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors text-sm text-slate-700"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-8">
          {!selected ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-6 text-6xl">💬</div>
                <p className="text-xl font-semibold text-slate-700 mb-2">Welcome to SMARTCHAT</p>
                <p className="text-slate-500 max-w-md">Pick a conversation from the sidebar or start a new chat to begin messaging.</p>
              </div>
            </div>
          ) : loadingMessages ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-slate-500">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"></div>
                <span className="text-sm">Loading messages…</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => {
                const mine = idEqual(m.sender?._id || m.sender, user._id);
                const isEdited = m.edited;
                const isDeleted = m.deleted;
                const hasReply = m.replyTo;
                const readByCount = (m.readBy || []).length;
                const deliveredToCount = (m.deliveredTo || []).length;
                const messageTime = new Date(m.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                });

                return (
                  <div
                    key={m._id}
                    className={`flex ${mine ? "justify-end" : "justify-start"} group`}
                  >
                    <div
                    className={`group relative max-w-[70%] rounded-2xl px-5 py-3 shadow-md transition-all duration-200 hover:shadow-lg ${
                      mine
                        ? "bg-gradient-to-br from-indigo-600 via-blue-600 to-purple-600 text-white rounded-br-sm"
                        : "bg-white text-slate-900 ring-1 ring-slate-200/60 shadow-sm rounded-bl-sm"
                    } ${isDeleted ? 'opacity-60' : ''}`}
                  >  
                      {/* Reply indicator */}
                      {hasReply && (
                        <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${
                          mine ? 'bg-white/20' : 'bg-slate-100'
                        }`}>
                          <p className={`text-xs font-medium ${mine ? 'text-white/70' : 'text-slate-500'}`}>
                            Replying to {hasReply.sender?.username || 'Unknown'}
                          </p>
                          <p className={`truncate ${mine ? 'text-white/90' : 'text-slate-700'}`}>
                            {hasReply.text || (hasReply.fileName ? `📎 ${hasReply.fileName}` : 'Attachment')}
                          </p>
                        </div>
                      )}

                      {!mine && (
                        <div className="mb-2 flex items-center gap-2">
                          <div className="relative">
                            <img
                              src={m.sender?.avatar || `https://ui-avatars.com/api/?name=${m.sender?.username}&background=random`}
                              alt=""
                              className="h-8 w-8 rounded-full border-2 border-white shadow-sm object-cover"
                            />
                            {m.sender?.isOnline && (
                              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border border-white"></span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-indigo-600">
                            {m.sender?.username}
                          </p>
                        </div>
                      )}

                      {!isDeleted && <MessageFileBlock message={m} mine={mine} />}

                      {isDeleted ? (
                        <p className="italic text-slate-500">
                          {mine ? 'You deleted this message' : 'This message was deleted'}
                        </p>
                      ) : (
                        <>
                          {editingMessage?._id === m._id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                                rows={2}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={saveEdit}
                                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {m.text && (
                                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                  {m.text}
                                  {isEdited && <span className="ml-1 text-xs opacity-70">(edited)</span>}
                                </p>
                              )}
                            </>
                          )}
                        </>
                      )}

                      {/* Message actions */}
                      {!isDeleted && (
                        <div className={`mt-2 flex items-center justify-between gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200`}>
                          <div className="flex gap-1">
                            <button
                              onClick={() => replyToMessage(m)}
                              className={`rounded-lg p-1.5 text-xs transition-all duration-200 hover:scale-110 active:scale-95 ${
                                mine ? 'hover:bg-white/20 text-white/80' : 'hover:bg-slate-100 text-slate-500'
                              }`}
                              title="Reply"
                            >
                              ↩️
                            </button>
                            {mine && (
                              <>
                                <button
                                  onClick={() => editMessage(m)}
                                  className={`rounded-lg p-1.5 text-xs transition-all duration-200 hover:scale-110 active:scale-95 ${
                                    mine ? 'hover:bg-white/20 text-white/80' : 'hover:bg-slate-100 text-slate-500'
                                  }`}
                                  title="Edit"
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => deleteMessage(m._id, true)}
                                  className={`rounded-lg p-1.5 text-xs transition-all duration-200 hover:scale-110 active:scale-95 ${
                                    mine ? 'hover:bg-white/20 text-white/80' : 'hover:bg-slate-100 text-slate-500'
                                  }`}
                                  title="Delete for everyone"
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </div>
                          <span className={`text-xs ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                            {messageTime}
                          </span>
                        </div>
                      )}

                      {/* Reactions */}
                      {!isDeleted && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {QUICK_REACTIONS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => toggleReaction(m._id, em)}
                              className={`rounded-lg px-2 py-1 text-sm leading-none transition-all duration-200 hover:scale-110 active:scale-95 ${
                                mine ? "text-white/90 hover:bg-white/20" : "text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Reaction display */}
                      {(m.reactions || []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(
                            (m.reactions || []).reduce((acc, r) => {
                              const k = r.emoji;
                              acc[k] = (acc[k] || 0) + 1;
                              return acc;
                            }, {}),
                          ).map(([emoji, count]) => (
                            <span
                              key={emoji}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium shadow-sm ${
                                mine ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {emoji} {count}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Message status */}
                      {mine && !isDeleted && (
                        <div className="mt-2 flex items-center justify-end gap-1">
                          <span className="text-[11px] opacity-80">
                            {readByCount > 0 ? "✓✓ Read" : deliveredToCount > 0 ? "✓✓ Delivered" : "✓ Sent"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {selected ? (
          <footer className="flex-shrink-0 border-t border-slate-200/60 bg-white/95 px-6 py-5 backdrop-blur-sm">
            {/* Reply indicator */}
            {replyTo && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-slate-200/60 bg-slate-50/90 p-3">
                <div className="h-1 w-4 rounded-full bg-indigo-500"></div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-indigo-600">
                    Replying to {replyTo.sender?.username || 'Unknown'}
                  </p>
                  <p className="truncate text-sm text-slate-700">
                    {replyTo.text || (replyTo.fileName ? `📎 ${replyTo.fileName}` : 'Attachment')}
                  </p>
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
            )}

            {typingUser ? (
              <div className="mb-4 flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400"></div>
                  <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{animationDelay: '0.1s'}}></div>
                  <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{animationDelay: '0.2s'}}></div>
                </div>
                <p className="text-sm text-slate-500">{typingUser} is typing…</p>
              </div>
            ) : null}
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePick} />
            {pendingFile ? (
              <div className="mx-auto mb-4 flex max-w-4xl items-start gap-4 rounded-2xl border border-slate-200/60 bg-white/90 p-4 shadow-lg backdrop-blur-sm">
                {pendingFile.previewUrl ? (
                  <img
                    src={pendingFile.previewUrl}
                    alt=""
                    className="h-24 w-24 shrink-0 rounded-2xl object-cover shadow-md"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-3xl shadow-inner">
                    {"\u{1F4CE}"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 mb-1">{pendingFile.file.name}</p>
                  <p className="text-xs text-slate-500 mb-3">
                    {(pendingFile.file.size / 1024).toFixed(1)} KB
                  </p>
                  <div className="flex gap-2">
                    <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
                      Ready to send
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearPendingFile}
                  className="shrink-0 rounded-xl border border-slate-200/60 px-4 py-2 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-50 hover:shadow-md active:scale-95"
                >
                  Remove
                </button>
              </div>
            ) : null}
            <div className="mx-auto flex max-w-4xl gap-3">
              <div className="relative flex-1">
                <textarea
                  id="messageInput"
                  name="messageInput"
                  rows={1}
                  value={input}
                  onChange={(e) => handleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!uploading) sendMessage();
                    }
                  }}
                  placeholder={pendingFile ? "Add a caption (optional)…" : "Type a message…"}
                  className="min-h-[56px] w-full resize-none rounded-full border border-slate-200/60 bg-white/95 pr-24 pl-6 py-4 text-sm text-slate-900 shadow-lg outline-none ring-indigo-500/30 transition-all duration-200 focus:ring-2 focus:ring-indigo-300 focus:shadow-xl focus:border-indigo-400 backdrop-blur-sm"
                />
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || !socket.connected}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 active:scale-95 disabled:opacity-50 shadow-sm"
                    title="Attach file"
                  >
                    📎
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 active:scale-95 shadow-sm"
                    title="Add emoji"
                  >
                    😊
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={sendMessage}
                disabled={
                  !socket.connected || uploading || (!input.trim() && !pendingFile)
                }
                className="rounded-full bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 px-8 py-4 font-semibold text-white shadow-lg transition-all duration-200 hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500 hover:shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
              >
                {uploading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    <span>Sending…</span>
                  </div>
                ) : (
                  "Send"
                )}
              </button>
            </div>
            {uploading ? (
              <p className="mt-3 text-center text-sm font-medium text-indigo-600">Uploading file…</p>
            ) : null}
            {!socket.connected ? (
              <div className="mt-3 flex items-center justify-center gap-2 text-amber-600">
                <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500"></div>
                <p className="text-sm font-medium">Connecting to chat server…</p>
              </div>
            ) : null}
          </footer>
        ) : null}
      </section>

      {showUserSearch ? (
        <UserSearchModal
          onClose={() => setShowUserSearch(false)}
          onPick={async (peer) => {
            const { data } = await api.post("/conversations", {
              type: "direct",
              peerId: peer._id,
            });
            setShowUserSearch(false);
            setConversations((prev) => {
              const exists = prev.some((c) => c._id === data.conversation._id);
              if (exists) return prev;
              return [data.conversation, ...prev];
            });
            setSelected(data.conversation);
          }}
        />
      ) : null}

      {showGroupModal ? (
        <NewGroupModal
          onClose={() => setShowGroupModal(false)}
          onCreated={(conv) => {
            setShowGroupModal(false);
            setConversations((prev) => [conv, ...prev]);
            setSelected(conv);
          }}
        />
      ) : null}

      <audio ref={remoteAudioRef} autoPlay />
      <audio ref={localAudioRef} autoPlay muted />

      {callState !== "idle" ? (
        <div className="fixed inset-0 z-50 bg-black">
          {/* Full Screen Remote Video */}
          <div className="relative h-full w-full">
            {callType === "video" ? (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover brightness-110 contrast-110"
                />
                <div className="absolute inset-0 bg-black/20 pointer-events-none"></div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                <div className="text-center">
                  <div className="mb-8 text-6xl animate-pulse">{'\ud83c\udfa4'}</div>
                  <p className="text-2xl font-medium text-white/90">
                    {callState === "incoming" || callState === "calling" ? "Waiting for connection..." : "Audio Call Active"}
                  </p>
                </div>
              </div>
            )}
            
            {/* Call Header */}
            <div className="absolute top-0 left-0 right-0 p-6">
              <div className="flex items-center justify-between">
                <div className="bg-black/40 backdrop-blur-sm rounded-lg px-3 py-2">
                  <h2 className="text-xl font-bold text-white">{callPartner?.username || "Unknown"}</h2>
                  <p className="text-sm text-white/90">
                    {callState === "incoming"
                      ? "Incoming Call"
                      : callState === "calling"
                      ? "Calling..."
                      : callType === "video"
                      ? "Video Call"
                      : "Audio Call"}
                  </p>
                </div>
                <div className="bg-black/40 backdrop-blur-sm rounded-lg px-3 py-2">
                  <div className="text-white text-sm font-mono font-bold tracking-wide shadow-sm">
                    {formatTime(callDuration)}
                  </div>
                </div>
              </div>
            </div>

            {/* Floating Local Video */}
            {callType === "video" && (
              <div className="absolute top-20 right-6 w-36 h-36 rounded-xl overflow-hidden shadow-lg border border-white/20 backdrop-blur-sm bg-black/30">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover brightness-105"
                />
                {/* Local video indicator */}
                <div className="absolute top-2 left-2 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            )}

            {/* Error Message */}
            {callError && (
              <div className="absolute top-32 left-1/2 transform -translate-x-1/2 max-w-md">
                <div className="rounded-2xl bg-red-500/90 backdrop-blur px-6 py-4 text-white text-center">
                  <p className="text-sm font-medium">{callError}</p>
                </div>
              </div>
            )}

            {/* Incoming/Calling Controls */}
            {callState === "incoming" ? (
              <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
                <div className="backdrop-blur-md bg-white/10 rounded-full px-6 py-3 flex items-center gap-6 shadow-2xl border border-white/20">
                  <button
                    type="button"
                    onClick={rejectCall}
                    className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg"
                  >
                    <span className="text-xl">{'\ud83d\udcde'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={acceptCall}
                    className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg"
                  >
                    <span className="text-2xl">{'\ud83d\udcde'}</span>
                  </button>
                </div>
              </div>
            ) : callState === "calling" ? (
              <>
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
                  <div className="backdrop-blur-md bg-white/10 rounded-full px-6 py-3 flex items-center gap-4 shadow-2xl border border-white/20">
                    <div className="text-center text-white">
                      <div className="mb-2">
                        <div className="w-10 h-10 border-3 border-white/40 border-t-white rounded-full animate-spin mx-auto"></div>
                      </div>
                      <p className="text-sm font-medium">Ringing...</p>
                    </div>
                  </div>
                </div>
                
                {/* End Call Button for Calling State */}
                <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2">
                  <button
                    onClick={endCall}
                    className="bg-red-500 hover:bg-red-600 text-white rounded-full w-16 h-16 flex items-center justify-center shadow-xl transition transform hover:scale-110 active:scale-95"
                  >
                    <span className="text-xl">{'\ud83d\udcde'}</span>
                  </button>
                </div>
              </>
            ) : (
              /* Active Call Controls */
              <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
                <div className="backdrop-blur-md bg-white/10 rounded-full px-6 py-3 flex items-center gap-4 shadow-2xl border border-white/20">
                  <button
                    type="button"
                    onClick={toggleMute}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${
                      audioEnabled 
                        ? "bg-white/20 hover:bg-white/30 text-white" 
                        : "bg-red-500 hover:bg-red-600 text-white"
                    }`}
                  >
                    <span className="text-lg">
                      {audioEnabled ? '\ud83c\udfa4' : '\ud83d\udd07'}
                    </span>
                  </button>
                  
                  {callType === "video" && (
                    <button
                      type="button"
                      onClick={toggleCamera}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${
                        videoEnabled 
                          ? "bg-white/20 hover:bg-white/30 text-white" 
                          : "bg-red-500 hover:bg-red-600 text-white"
                      }`}
                    >
                      <span className="text-lg">
                        {videoEnabled ? '\ud83d\udcf9' : '\ud83d\udcf7'}
                      </span>
                    </button>
                  )}
                  
                  <button
                    type="button"
                    onClick={endCall}
                    className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg"
                  >
                    <span className="text-xl">{'\ud83d\udcde'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Profile View Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white/95 p-8 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
                Profile
              </h3>
              <button
                type="button"
                onClick={() => setShowProfileModal(null)}
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 transition-all hover:scale-110 active:scale-95"
              >
                ×
              </button>
            </div>
            
            <div className="flex flex-col items-center">
              {showProfileModal.avatar ? (
                <img
                  src={showProfileModal.avatar}
                  alt=""
                  className="h-24 w-24 rounded-full border-4 border-white shadow-xl mb-4"
                />
              ) : (
                <div className="h-24 w-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold shadow-xl mb-4">
                  {showProfileModal.username?.charAt(0).toUpperCase() || '?'}
                </div>
              )}
              
              <h4 className="text-2xl font-bold text-slate-900 mb-2">{showProfileModal.username}</h4>
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-2 h-2 rounded-full ${showProfileModal.isOnline ? 'bg-green-500' : 'bg-slate-400'}`}></div>
                <span className="text-sm text-slate-600">
                  {showProfileModal.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              
              {showProfileModal.bio && (
                <p className="text-center text-slate-600 mb-6">{showProfileModal.bio}</p>
              )}
              
              <div className="w-full space-y-2 text-sm text-slate-500">
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className={showProfileModal.isOnline ? 'text-green-600 font-medium' : 'text-slate-600'}>
                    {showProfileModal.isOnline ? 'Active now' : 'Offline'}
                  </span>
                </div>
                {showProfileModal.lastSeen && !showProfileModal.isOnline && (
                  <div className="flex justify-between">
                    <span>Last seen:</span>
                    <span>{new Date(showProfileModal.lastSeen).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditProfileModal && (
        <EditProfileModal
          user={user}
          onClose={() => setShowEditProfileModal(false)}
          onUpdate={(updatedUser) => {
            if (updatedUser) {
              refreshUser();
            }
            setShowEditProfileModal(false);
          }}
        />
      )}

      {/* Story Viewer */}
      {showStoryViewer && (
        <StoryViewer
          user={storyViewerData.user}
          currentUser={user}
          stories={storyViewerData.stories}
          initialIndex={storyViewerData.index}
          onClose={() => setShowStoryViewer(false)}
        />
      )}
    </div>
  );
}

function UserSearchModal({ onClose, onPick }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 1) {
        setUsers([]);
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get("/users/search", { params: { q: q.trim() } });
        setUsers(data.users || []);
      } catch {
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white/95 p-8 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            New chat
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 transition-all hover:scale-110 active:scale-95"
          >
            ✕
          </button>
        </div>
        <input
          name="userSearch"
          className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-sm outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 backdrop-blur-sm"
          placeholder="Search by username or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-6 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-slate-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"></div>
                <span className="text-sm">Searching…</span>
              </div>
            </div>
          ) : users.length === 0 && q.trim() ? (
            <div className="text-center py-8">
              <div className="mb-4 text-3xl">🔍</div>
              <p className="text-slate-500">No users found</p>
              <p className="text-xs text-slate-400 mt-1">Try a different search term</p>
            </div>
          ) : (
            users.map((u) => (
              <button
                key={u._id}
                type="button"
                onClick={() => onPick(u)}
                className="flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all hover:bg-gradient-to-r hover:from-indigo-50 hover:to-blue-50 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
              >
                <img
                  src={u.avatar || `https://ui-avatars.com/api/?name=${u.username}&background=random`}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{u.username}</span>
                    {u.isOnline ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Online
                      </span>
                    ) : null}
                  </div>
                  <span className="block truncate text-sm text-slate-500">{u.email}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NewGroupModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 1) {
        setUsers([]);
        return;
      }
      try {
        const { data } = await api.get("/users/search", { params: { q: q.trim() } });
        setUsers(data.users || []);
      } catch {
        setUsers([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const addMember = (u) => {
    if (picked.some((p) => p._id === u._id)) return;
    setPicked((p) => [...p, u]);
    setQ("");
  };

  const create = async () => {
    if (!name.trim() || picked.length < 1) return;
    setSaving(true);
    try {
      const { data } = await api.post("/conversations", {
        type: "group",
        name: name.trim(),
        memberIds: picked.map((p) => p._id),
      });
      onCreated(data.conversation);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white/95 p-8 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            New group
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 transition-all hover:scale-110 active:scale-95"
          >
            ✕
          </button>
        </div>
        <input
          name="groupName"
          className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-sm outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 backdrop-blur-sm mb-4"
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          name="groupMemberSearch"
          className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-sm outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 backdrop-blur-sm mb-4"
          placeholder="Search people to add…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-40 overflow-y-auto mb-4">
          {users.map((u) => (
            <button
              key={u._id}
              type="button"
              onClick={() => addMember(u)}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-gradient-to-r hover:from-indigo-50 hover:to-blue-50 transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              <img
                src={u.avatar || `https://ui-avatars.com/api/?name=${u.username}&background=random`}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{u.username}</span>
                  {u.isOnline ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Online
                    </span>
                  ) : null}
                </div>
                <span className="block truncate text-slate-500">{u.email}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          {picked.map((p) => (
            <span
              key={p._id}
              className="rounded-full bg-gradient-to-r from-indigo-100 to-blue-100 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm"
            >
              {p.username}
            </span>
          ))}
        </div>
        <button
          type="button"
          disabled={saving || !name.trim() || picked.length < 1}
          onClick={create}
          className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 py-4 font-semibold text-white shadow-lg transition-all hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
        >
          {saving ? (
            <div className="flex items-center justify-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              <span>Creating…</span>
            </div>
          ) : (
            "Create group"
          )}
        </button>
      </div>
    </div>
  );
}
