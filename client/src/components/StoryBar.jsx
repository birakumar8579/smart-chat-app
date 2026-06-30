import React, { useState, useEffect, useMemo, useCallback } from "react";
import api from "../services/api";

function StoryBar({ onStoryClick, onAddStory }) {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStories = useCallback(async () => {
    try {
      const response = await api.get("/stories");
      
      // Handle different response structures
      let storiesData = [];
      
      if (response.data?.stories && Array.isArray(response.data.stories)) {
        // New format: array of story objects
        storiesData = response.data.stories;
      } else if (response.data?.success && Array.isArray(response.data.stories)) {
        // Current format: array of user story groups
        storiesData = response.data.stories;
      } else {
        storiesData = [];
      }
      
      setStories(storiesData);
    } catch (error) {
      console.error("Failed to fetch stories:", error?.message);
      if (error?.code === 'ERR_CONNECTION_REFUSED') {
        console.warn("Backend not running or connection refused");
      }
      setStories([]); // Fallback to empty array
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStories();
    
    // Listen for story upload events
    const handleStoryUpload = () => {
      fetchStories();
    };
    
    window.addEventListener('storyUploaded', handleStoryUpload);
    
    return () => {
      window.removeEventListener('storyUploaded', handleStoryUpload);
    };
  }, [fetchStories]);

  const safeStories = stories || [];
  const memoStories = useMemo(() => safeStories, [safeStories]);

  if (loading) {
    return (
      <div className="flex gap-4 p-4 overflow-x-auto bg-white/90 border-b border-slate-200/60">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="w-16 h-16 rounded-full bg-slate-200 animate-pulse"></div>
            <div className="w-12 h-3 rounded bg-slate-200 animate-pulse"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-4 p-4 overflow-x-auto bg-white/95 border-b border-slate-200/60 backdrop-blur-sm">
      {/* Add Story Button */}
      <div className="flex flex-col items-center gap-2 flex-shrink-0">
        <button
          onClick={onAddStory}
          className="relative w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg hover:scale-105 transition-transform"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <div className="absolute bottom-0 right-0 w-5 h-5 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center">
            <svg className="w-3 h-3" fill="white" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
        </button>
        <span className="text-xs text-slate-600">Your story</span>
      </div>

      {/* User Stories */}
      {memoStories
        .filter(story => story?.user)
        .map((story) => {
          const { user, stories: userStories } = story;
          return (
            <div
              key={user?._id || 'unknown'}
              className="flex flex-col items-center gap-2 flex-shrink-0 cursor-pointer"
              onClick={() => onStoryClick(user, userStories)}
            >
              <div className="relative">
                {/* Story Ring */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5"></div>
                <div className="relative w-16 h-16 rounded-full bg-white p-0.5">
                  {user?.avatar ? (
                    <img
                      src={user?.avatar}
                      alt={user?.username || "Unknown"}
                      className="w-full h-full rounded-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div 
                    className="w-full h-full rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold"
                    style={{ display: user?.avatar ? 'none' : 'flex' }}
                  >
                    {user?.username?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                </div>
                {/* Online Indicator */}
                {user?.isOnline && (
                  <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></div>
                )}
                
                {/* Story Status Indicator */}
                {userStories?.some(story => 
                  !story.views?.some(view => view.userId === user?._id)
                ) && (
                  <div className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full border-2 border-white"></div>
                )}
              </div>
              <span className="text-xs text-slate-600 truncate w-16 text-center">
                {user?.username || "Unknown"}
              </span>
            </div>
          );
        })}
    </div>
  );
}

export default React.memo(StoryBar);
