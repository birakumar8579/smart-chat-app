import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import socket from "../services/socket";
import { searchYouTube } from "../services/youtube";

export default function WatchPartyPage() {
  const { user, token } = useAuth();
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  const [watchParty, setWatchParty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [joinRoomId, setJoinRoomId] = useState("");
  
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const syncTimeoutRef = useRef(null);

  // Load watch party data
  useEffect(() => {
    if (roomId) {
      loadWatchParty(roomId);
    } else {
      setLoading(false);
    }
  }, [roomId]);

  const loadWatchParty = async (roomId) => {
    try {
      setLoading(true);
      const { data } = await api.get(`/watchparty/${roomId}`);
      setWatchParty(data.watchParty);
      setParticipants(data.watchParty.participants || []);
      setIsPlaying(data.watchParty.isPlaying);
      setCurrentTime(data.watchParty.currentTime);
      setIsHost(data.watchParty.host._id === user._id);
      
      // Join socket room
      if (socket.connected) {
        socket.emit("join-watch-party", { roomId }, (res) => {
          if (!res?.ok) {
            console.error("[watchparty] Failed to join room:", res?.error);
          }
        });
      }
    } catch (err) {
      console.error("[watchparty] Load failed:", err);
      setError("Watch party not found");
    } finally {
      setLoading(false);
    }
  };

  // Socket event listeners
  useEffect(() => {
    if (!roomId || !socket.connected) return;

    const onPlay = (data) => {
      if (data.roomId === roomId && videoRef.current && !isHost) {
        videoRef.current.play();
        setIsPlaying(true);
        setCurrentTime(data.currentTime);
      }
    };

    const onPause = (data) => {
      if (data.roomId === roomId && videoRef.current && !isHost) {
        videoRef.current.pause();
        setIsPlaying(false);
        setCurrentTime(data.currentTime);
      }
    };

    const onSeek = (data) => {
      if (data.roomId === roomId && videoRef.current && !isHost) {
        videoRef.current.currentTime = data.currentTime;
        setCurrentTime(data.currentTime);
      }
    };

    const onParticipantJoined = (data) => {
      if (data.roomId === roomId) {
        setParticipants(prev => [...prev, data.participant]);
      }
    };

    const onParticipantLeft = (data) => {
      if (data.roomId === roomId) {
        setParticipants(prev => prev.filter(p => p.user._id !== data.userId));
      }
    };

    socket.on("play", onPlay);
    socket.on("pause", onPause);
    socket.on("seek", onSeek);
    socket.on("participant-joined", onParticipantJoined);
    socket.on("participant-left", onParticipantLeft);

    return () => {
      socket.off("play", onPlay);
      socket.off("pause", onPause);
      socket.off("seek", onSeek);
      socket.off("participant-joined", onParticipantJoined);
      socket.off("participant-left", onParticipantLeft);
      
      if (roomId) {
        socket.emit("leave-watch-party", { roomId });
      }
    };
  }, [roomId, isHost]);

  // Video event handlers
  const handleVideoLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      if (watchParty && !isHost) {
        videoRef.current.currentTime = watchParty.currentTime;
        setCurrentTime(watchParty.currentTime);
      }
    }
  };

  const handleVideoTimeUpdate = () => {
    if (videoRef.current && isHost) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      
      // Throttle sync updates
      if (!syncTimeoutRef.current) {
        syncTimeoutRef.current = setTimeout(() => {
          syncTimeoutRef.current = null;
        }, 1000);
      }
    }
  };

  // Host control functions
  const handlePlay = () => {
    if (!isHost || !videoRef.current) return;
    
    videoRef.current.play();
    setIsPlaying(true);
    
    socket.emit("watch-party-play", {
      roomId,
      currentTime: videoRef.current.currentTime,
    }, (res) => {
      if (!res?.ok) {
        console.error("[watchparty] Play failed:", res?.error);
      }
    });
  };

  const handlePause = () => {
    if (!isHost || !videoRef.current) return;
    
    videoRef.current.pause();
    setIsPlaying(false);
    
    socket.emit("watch-party-pause", {
      roomId,
      currentTime: videoRef.current.currentTime,
    }, (res) => {
      if (!res?.ok) {
        console.error("[watchparty] Pause failed:", res?.error);
      }
    });
  };

  const handleSeek = (time) => {
    if (!isHost || !videoRef.current) return;
    
    videoRef.current.currentTime = time;
    setCurrentTime(time);
    
    socket.emit("watch-party-seek", {
      roomId,
      currentTime: time,
    }, (res) => {
      if (!res?.ok) {
        console.error("[watchparty] Seek failed:", res?.error);
      }
    });
  };

  const handleProgressClick = (e) => {
    if (!progressRef.current || !isHost) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * duration;
    
    handleSeek(time);
  };

  // YouTube search function
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError("Search query is required");
      return;
    }

    try {
      setSearching(true);
      const results = await searchYouTube(searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      console.error("[youtube] Search failed:", err);
      setError(err.message || "Failed to search YouTube");
    } finally {
      setSearching(false);
    }
  };

  // Create watch party
  const handleCreateRoom = async () => {
    if (!selectedVideo) {
      setError("Please select a video");
      return;
    }

    try {
      const { data } = await api.post("/watchparty/create", {
        videoUrl: selectedVideo.embedUrl,
        videoTitle: selectedVideo.title,
      });
      
      navigate(`/watchparty/${data.watchParty.roomId}`);
      setShowCreateModal(false);
      setSelectedVideo(null);
      setSearchResults([]);
      setSearchQuery("");
    } catch (err) {
      console.error("[watchparty] Create failed:", err);
      setError(err.response?.data?.message || "Failed to create watch party");
    }
  };

  // Join watch party
  const handleJoinRoom = async () => {
    if (!joinRoomId.trim()) {
      setError("Room ID is required");
      return;
    }

    try {
      const { data } = await api.post(`/watchparty/join/${joinRoomId.trim()}`);
      navigate(`/watchparty/${data.watchParty.roomId}`);
      setShowJoinModal(false);
      setJoinRoomId("");
    } catch (err) {
      console.error("[watchparty] Join failed:", err);
      setError(err.response?.data?.message || "Failed to join watch party");
    }
  };

  // Format time
  const formatTime = (time) => {
    if (!time || isNaN(time)) return "0:00";
    
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50">
        <div className="flex items-center gap-3 text-slate-600">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"></div>
          <span className="text-sm">Loading watch party...</span>
        </div>
      </div>
    );
  }

  if (!roomId) {
    // Landing page
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50 p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
              WATCH PARTY
            </h1>
            <p className="text-slate-600">Watch videos together with friends</p>
          </div>

          {error && (
            <div className="mb-6 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 border border-red-200/50">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={() => setShowSearchModal(true)}
              className="w-full rounded-2xl bg-gradient-to-r from-red-600 via-pink-600 to-purple-600 py-4 font-semibold text-white shadow-lg transition-all hover:from-red-500 hover:via-pink-500 hover:to-purple-500 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
            >
              🔍 Search YouTube
            </button>
            
            <button
              onClick={() => setShowJoinModal(true)}
              className="w-full rounded-2xl border border-slate-200/60 bg-white/90 py-4 font-semibold text-slate-700 shadow-md transition-all hover:bg-slate-50 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] backdrop-blur-sm"
            >
              Join Room
            </button>
          </div>

          <div className="mt-8 text-center">
            <button
              onClick={() => navigate("/")}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Back to Chat
            </button>
          </div>
        </div>

        {/* YouTube Search Modal */}
        {showSearchModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Search YouTube</h2>
              
              <div className="space-y-4 mb-6">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for videos..."
                    className="flex-1 rounded-2xl border border-slate-200/60 px-5 py-4 text-slate-900 outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch();
                      }
                    }}
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                    className="rounded-2xl bg-gradient-to-r from-red-600 via-pink-600 to-purple-600 px-6 py-4 font-semibold text-white shadow-lg transition-all hover:from-red-500 hover:via-pink-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {searching ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                        <span>Searching...</span>
                      </div>
                    ) : (
                      "Search"
                    )}
                  </button>
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="space-y-3 max-h-60 overflow-y-auto border-t border-slate-200 pt-4">
                  {searchResults.map((video) => (
                    <div
                      key={video.videoId}
                      onClick={() => setSelectedVideo(video)}
                      className={`flex gap-4 p-4 rounded-xl cursor-pointer transition-all hover:bg-slate-50 ${
                        selectedVideo?.videoId === video.videoId ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'border border-slate-200'
                      }`}
                    >
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        className="h-20 w-28 rounded-lg object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-slate-900 truncate">{video.title}</h3>
                        <p className="text-sm text-slate-600 truncate">{video.channelTitle}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(video.publishedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setShowSearchModal(false);
                    setSearchResults([]);
                    setSelectedVideo(null);
                    setSearchQuery("");
                  }}
                  className="flex-1 rounded-2xl border border-slate-200/60 py-3 font-semibold text-slate-600 transition-all hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateRoom}
                  disabled={!selectedVideo}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 py-3 font-semibold text-white shadow-lg transition-all hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Room with {selectedVideo ? 'Selected Video' : 'No Video'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Join Room Modal */}
        {showJoinModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Join Watch Party</h2>
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Room ID
                </label>
                <input
                  type="text"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                  placeholder="ABCD1234"
                  className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-slate-900 outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 uppercase"
                  required
                />
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setShowJoinModal(false);
                    setJoinRoomId("");
                  }}
                  className="flex-1 rounded-2xl border border-slate-200/60 py-3 font-semibold text-slate-600 transition-all hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleJoinRoom}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 py-3 font-semibold text-white shadow-lg transition-all hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500"
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Watch party room view
  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-700/50 bg-slate-900/80 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="rounded-xl border border-slate-600/60 px-4 py-2 text-xs font-semibold text-slate-300 transition-all hover:bg-slate-800 hover:shadow-md"
            >
              Back to Chat
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Watch Party</h1>
              <p className="text-sm text-slate-400">Room: {roomId}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-indigo-600/20 px-3 py-1 text-sm font-medium text-indigo-300">
              {participants.length} participants
            </span>
            {isHost && (
              <span className="rounded-full bg-green-600/20 px-3 py-1 text-sm font-medium text-green-300">
                Host
              </span>
            )}
          </div>
        </header>

        {/* Video Player */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-4xl">
            {watchParty ? (
              <div className="rounded-2xl overflow-hidden bg-black shadow-2xl">
                <iframe
                  ref={videoRef}
                  src={watchParty.videoUrl}
                  className="w-full aspect-video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  frameBorder="0"
                />
                
                {/* Custom Controls Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 p-4 backdrop-blur-sm">
                  <div className="text-white text-sm font-medium text-center mb-2">
                    {watchParty.videoTitle || "YouTube Video"}
                  </div>
                  <div className="text-white text-xs text-center text-slate-400">
                    Note: Use YouTube player controls for playback
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-white">
                <div className="text-6xl mb-4">Loading video...</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Participants Sidebar */}
      <aside className="w-80 border-l border-slate-700/50 bg-slate-900/80 backdrop-blur-sm">
        <div className="p-6 border-b border-slate-700/50">
          <h2 className="text-lg font-semibold text-white mb-2">Participants</h2>
          <p className="text-sm text-slate-400">
            {isHost ? "You are the host" : "Host: " + (watchParty?.host?.username || "Unknown")}
          </p>
        </div>
        
        <div className="p-6 space-y-3">
          {participants.map((participant) => (
            <div key={participant.user._id} className="flex items-center gap-3">
              <img
                src={participant.user.avatar || `https://ui-avatars.com/api/?name=${participant.user.username}&background=random`}
                alt=""
                className="h-8 w-8 rounded-full"
              />
              <div className="flex-1">
                <p className="text-white text-sm font-medium">
                  {participant.user.username}
                  {participant.user._id === user._id && " (You)"}
                </p>
                <p className="text-slate-400 text-xs">
                  Joined {new Date(participant.joinedAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
