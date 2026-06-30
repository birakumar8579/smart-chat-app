import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import api from "../services/api";

function StoryViewer({ user, currentUser, stories, initialIndex = 0, onClose, onNext, onPrevious }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showViewersModal, setShowViewersModal] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const viewedRef = useRef(new Set());

  const currentStory = useMemo(() => {
    if (!stories || !Array.isArray(stories) || !stories.length || currentIndex < 0 || currentIndex >= stories.length) {
      return null;
    }
    return stories[currentIndex];
  }, [stories, currentIndex]);

// Convert relative URL to full URL
const getFullMediaUrl = (mediaUrl) => {
  if (!mediaUrl) return null;
  
  // If already a full URL, return as-is
  if (mediaUrl.startsWith('http')) {
    return mediaUrl;
  }
  
  // Convert relative path to full URL
  return `http://localhost:3001${mediaUrl}`;
};


  // Auto-progress story
  useEffect(() => {
    if (!currentStory) return;

    const duration = currentStory.mediaType === 'video' ? 15000 : 5000; // 15s for video, 5s for image
    const interval = 50; // Update every 50ms
    const increment = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev + increment;
        if (newProgress >= 100) {
          clearInterval(timer);
          // Auto-advance to next story
          if (currentIndex < stories.length - 1) {
            // Use setTimeout to avoid state update during render
            setTimeout(() => {
              setCurrentIndex(prev => prev + 1);
              setProgress(0);
            }, 0);
          } else {
            // Use setTimeout to avoid state update during render
            setTimeout(onClose, 0); // Close if last story
          }
          return 0;
        }
        return newProgress;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [currentStory, currentIndex, stories.length]);

  // Handle story loading state
  useEffect(() => {
    if (!currentStory) return;

    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [currentStory]);

  // Mark story as viewed
  useEffect(() => {
    if (!currentStory?._id) return;

    if (viewedRef.current.has(currentStory._id)) return;

    viewedRef.current.add(currentStory._id);

    api.post(`/stories/${currentStory._id}/view`)
      .catch(err => {
        console.error("Story view API error:", err?.message);
        if (err?.code === 'ERR_CONNECTION_REFUSED') {
          console.warn("Backend not running or connection refused");
        } else if (err.response?.status === 404) {
          console.warn("Story not found - it may have been deleted");
          // Don't do anything else, just log the error
        }
      });
  }, [currentStory?._id]);

  const handleNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setProgress(0);
      onNext?.();
    } else {
      // Use setTimeout to avoid state update during render
      setTimeout(onClose, 0);
    }
  }, [currentIndex, stories.length, onNext, onClose]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setProgress(0);
      onPrevious?.();
    }
  }, [currentIndex, onPrevious]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'ArrowRight') handleNext();
    if (e.key === 'ArrowLeft') handlePrevious();
    if (e.key === 'Escape') onClose();
  }, [handleNext, handlePrevious]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  const handleDeleteStory = useCallback(async (storyId) => {
  // Early validation
  if (!storyId) {
    console.warn("Invalid story ID");
    return;
  }
  
  if (!currentUser?._id) {
    console.warn("User not authenticated");
    return;
  }
  
  if (!currentStory?.userId?._id) {
    console.warn("Story owner information not available");
    return;
  }
  
  if (currentStory?.userId?._id !== currentUser?._id) {
    console.warn("You can only delete your own stories");
    return;
  }
  
  try {
    const res = await api.delete(`/stories/${storyId}`);
    
    // Close viewer
    setTimeout(onClose, 0);
  } catch (err) {
    console.error("Delete failed:", err?.message);
    
    if (err?.code === 'ERR_CONNECTION_REFUSED') {
      console.warn("Backend not running or connection refused");
      return;
    }
    
    // Show specific error messages
    if (err.response?.status === 403) {
      console.warn("You are not authorized to delete this story");
    } else if (err.response?.status === 404) {
      console.warn("Story not found - it may have been already deleted");
      // Close viewer since story doesn't exist
      setTimeout(onClose, 0);
    } else if (err.response?.status === 500) {
      console.warn("Server error occurred while deleting story");
    } else {
      console.warn(`Failed to delete story: ${err.response?.data?.message || err.message}`);
    }
  }
}, [currentUser, currentStory, onClose]);

  const handleReply = useCallback(() => {
    if (!replyText.trim()) return;
    if (!currentStory?._id) return;
    
    api.post(`/stories/${currentStory._id}/reply`, { text: replyText })
      .then(() => {
        setReplyText('');
        setShowReplyInput(false);
      })
      .catch(err => {
        console.error("Failed to send reply:", err?.message);
        if (err?.code === 'ERR_CONNECTION_REFUSED') {
          console.warn("Backend not running or connection refused");
        }
      });
  }, [replyText, currentStory]);

  const handleReaction = useCallback((emoji) => {
    if (!currentStory?._id) return;
    
    api.post(`/stories/${currentStory._id}/react`, { emoji })
      .then(() => {
        setShowReactions(false);
      })
      .catch(err => {
        console.error("Failed to send reaction:", err?.message);
        if (err?.code === 'ERR_CONNECTION_REFUSED') {
          console.warn("Backend not running or connection refused");
        }
      });
  }, [currentStory]);

  // Touch event handlers for swipe navigation
  const handleTouchStart = useCallback((e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }, []);

  const handleTouchMove = useCallback((e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchStart === null || touchEnd === null) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;
    
    if (isLeftSwipe) {
      handleNext();
    } else if (isRightSwipe) {
      handlePrevious();
    }
  }, [touchStart, touchEnd, handleNext, handlePrevious]);

  // Enhanced click navigation
  const handleStoryClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    
    // Left 1/3 = previous, Right 1/3 = next
    if (x < width / 3) {
      handlePrevious();
    } else if (x > (2 * width) / 3) {
      handleNext();
    }
  }, [handlePrevious, handleNext]);

  if (!currentStory) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-3">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.username}
              className="w-10 h-10 rounded-full border-2 border-white"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold">
              {user.username?.[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-white font-medium">{user.username}</p>
            <p className="text-white/70 text-sm">
              {new Date(currentStory.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Delete button for story owner */}
          {(() => {
            const isOwner = 
              currentStory?.userId?._id === currentUser?._id ||
              currentStory?.userId === currentUser?._id ||
              String(currentStory?.userId?._id) === String(currentUser?._id) ||
              String(currentStory?.userId) === String(currentUser?._id);
            return isOwner;
          })() && (
            <button
              onClick={() => handleDeleteStory(currentStory?._id)}
              className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium transition-colors"
              title="Delete story"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors p-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 p-4 bg-gradient-to-b from-black/70 to-transparent mt-16">
        {stories.map((_, index) => (
          <div
            key={index}
            className={`flex-1 h-1 rounded-full overflow-hidden ${
              index <= currentIndex ? 'bg-white/30' : 'bg-white/10'
            }`}
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                index === currentIndex ? 'bg-white' : 'bg-white/30'
              }`}
              style={{ width: `${index === currentIndex ? (progress / 100) * 100 : 100}%` }}
            />
          </div>
        ))}
      </div>

      {/* Story Content - Full Screen */}
      <div className="flex-1 relative w-full h-full bg-black">
        {/* Story media with touch and click navigation */}
        <div 
          className="w-full h-full relative cursor-pointer"
          onClick={handleStoryClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {!isLoading && currentStory && (
            currentStory.mediaType === 'image' ? (
              <img
                src={getFullMediaUrl(currentStory.mediaUrl)}
                alt="Story"
                className="w-full h-full object-contain bg-black"
                onError={(e) => {
                  console.error("Image failed to load:", e.target.src);
                  e.target.style.display = 'none';
                }}
                onLoad={() => {
                  console.log("Image loaded successfully:", getFullMediaUrl(currentStory.mediaUrl));
                }}
              />
            ) : (
              <video
                src={getFullMediaUrl(currentStory.mediaUrl)}
                className="w-full h-full object-contain bg-black"
                controls
                autoPlay
                onError={(e) => {
                  console.error("Video failed to load:", e.target.src);
                  e.target.style.display = 'none';
                }}
                onLoadedData={() => {
                  console.log("Video loaded successfully:", getFullMediaUrl(currentStory.mediaUrl));
                }}
              />
            )
          )}
        </div>

        {/* Viewers count for story owner */}
        {(() => {
          const isOwner = 
            currentStory?.userId?._id === currentUser?._id ||
            currentStory?.userId === currentUser?._id ||
            String(currentStory?.userId?._id) === String(currentUser?._id) ||
            String(currentStory?.userId) === String(currentUser?._id);
          return isOwner && currentStory?.views;
        })() && (
          <div className="absolute bottom-4 left-4 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
            <button
              onClick={() => setShowViewersModal(true)}
              className="text-white text-sm hover:text-white/80 transition-colors"
            >
              Seen by {currentStory.views.length}
            </button>
          </div>
        )}

        {/* Story Interactions */}
        <div className="absolute bottom-4 right-4 flex gap-2">
          {/* Reply Button */}
          <button
            onClick={() => setShowReplyInput(!showReplyInput)}
            className="bg-white/20 backdrop-blur-sm rounded-full p-3 hover:bg-white/30 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </button>

          {/* Reaction Button */}
          <button
            onClick={() => setShowReactions(!showReactions)}
            className="bg-white/20 backdrop-blur-sm rounded-full p-3 hover:bg-white/30 transition-all"
          >
            <span className="text-lg">{"\u2764\ufe0f"}</span>
          </button>
        </div>

        {/* Reply Input */}
        {showReplyInput && (
          <div className="absolute bottom-20 left-4 right-4 bg-black/80 backdrop-blur-sm rounded-2xl p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply to story..."
                className="flex-1 bg-white/20 text-white placeholder-white/50 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-white/50"
                onKeyPress={(e) => e.key === 'Enter' && handleReply()}
              />
              <button
                onClick={handleReply}
                className="bg-blue-500 hover:bg-blue-600 text-white rounded-full px-4 py-2 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {/* Emoji Reactions Bar */}
        {showReactions && (
          <div className="absolute bottom-20 left-4 right-4 bg-black/80 backdrop-blur-sm rounded-2xl p-4">
            <div className="flex justify-center gap-4">
              {["\ud83d\ude00", "\u2764\ufe0f", "\ud83d\ude02", "\ud83d\ude2e", "\ud83d\ude22"].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="text-2xl hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="w-12 h-12 border-4 border-white rounded-full border-t-transparent animate-spin"></div>
          </div>
        )}

        {/* Viewers Modal */}
        {showViewersModal && currentStory.views && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-96 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Story Views ({currentStory.views.length})</h3>
                <button
                  onClick={() => setShowViewersModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-3">
                {currentStory.views.map((view) => (
                  <div key={view._id} className="flex items-center gap-3">
                    {view.userId?.avatar ? (
                      <img
                        src={view.userId.avatar}
                        alt={view.userId.username}
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-sm">
                        {view.userId?.username?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <span className="text-gray-800">{view.userId?.username}</span>
                      <p className="text-xs text-gray-500">
                        {new Date(view.viewedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
                {currentStory.views.length === 0 && (
                  <p className="text-gray-500 text-center">No views yet</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default StoryViewer;
