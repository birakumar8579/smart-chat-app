import { useState } from "react";
import api from "../services/api";

function EditProfileModal({ user, onClose, onUpdate }) {
  const [username, setUsername] = useState(user.username || "");
  const [bio, setBio] = useState(user.bio || "");
  const [avatar, setAvatar] = useState(user.avatar || "");
  const [avatarPreview, setAvatarPreview] = useState(user.avatar || "");
  const [loading, setLoading] = useState(false);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    console.log("Avatar file selected:", file);
    
    if (file) {
      if (file.type.startsWith("image/")) {
        // Check file size first
        if (file.size > 5 * 1024 * 1024) {
          alert("Please select an image smaller than 5MB");
          return;
        }
        
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log("Avatar preview loaded");
          setAvatarPreview(reader.result);
          setAvatar(file);
          console.log("Avatar state set to file:", file.name);
        };
        reader.readAsDataURL(file);
      } else {
        alert("Please select an image file");
      }
    } else {
      console.log("No file selected");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let avatarUrl = user.avatar;

      // Upload avatar if changed
      if (avatar && typeof avatar !== 'string' && avatar !== user.avatar) {
        // Convert file to base64 and upload directly
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64 = reader.result;
            const response = await api.put("/users/profile", {
              username: username.trim(),
              bio: bio.trim(),
              avatar: base64,
            });
            
            if (response.data?.user) {
              console.log("Profile updated successfully:", response.data.user);
              onUpdate(response.data.user);
            } else {
              console.error("No user data in response");
              onUpdate(user);
            }
          } catch (error) {
            console.error("Failed to update profile with avatar:", error);
            alert("Failed to update profile. Please try again.");
            onUpdate(user);
          }
        };
        reader.readAsDataURL(avatar);
      } else {
        // Update profile without avatar change
        try {
          const response = await api.put("/users/profile", {
            username: username.trim(),
            bio: bio.trim(),
            avatar: avatarUrl,
          });
          
          if (response.data?.user) {
            console.log("Profile updated successfully:", response.data.user);
            onUpdate(response.data.user);
          } else {
            console.error("No user data in response");
            onUpdate(user);
          }
        } catch (profileError) {
          console.error("Failed to update profile:", profileError);
          alert("Failed to update profile. Please try again.");
          onUpdate(user);
        }
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      alert("An unexpected error occurred. Please try again.");
      onUpdate(user);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white/95 p-8 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            Edit Profile
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 transition-all hover:scale-110 active:scale-95"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar Upload */}
          <div className="flex flex-col items-center">
            <div className="relative mb-4">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Avatar preview"
                  className="h-24 w-24 rounded-full border-4 border-white shadow-xl object-cover"
                />
              ) : (
                <div className="h-24 w-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold shadow-xl">
                  {username?.charAt(0).toUpperCase() || '?'}
                </div>
              )}
              
              <label
                htmlFor="avatar-upload"
                className="absolute bottom-0 right-0 bg-indigo-600 text-white rounded-full p-2 cursor-pointer hover:bg-indigo-700 transition-colors shadow-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">Click to change photo</p>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/60 bg-slate-50/50 px-5 py-4 text-sm outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 backdrop-blur-sm"
              placeholder="Enter username"
              minLength={2}
              maxLength={32}
              required
            />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/60 bg-slate-50/50 px-5 py-4 text-sm outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 backdrop-blur-sm resize-none"
              placeholder="Tell us about yourself..."
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-slate-500 mt-1">
              {bio.length}/500 characters
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 py-4 font-semibold text-white shadow-lg transition-all hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                <span>Saving...</span>
              </div>
            ) : (
              "Save Changes"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default EditProfileModal;
