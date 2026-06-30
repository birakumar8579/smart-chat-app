const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY;

export const searchYouTube = async (searchTerm) => {
  if (!API_KEY) {
    throw new Error("YouTube API key not configured");
  }

  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?` +
      new URLSearchParams({
        part: 'snippet',
        q: searchTerm.trim(),
        type: 'video',
        maxResults: 10,
        key: API_KEY
      })
    );

    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'YouTube API error');
    }

    return data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
      watchUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));
  } catch (error) {
    console.error('[youtube] Search error:', error.message);
    throw error;
  }
};
