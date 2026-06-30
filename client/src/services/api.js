import axios from "axios";

const TOKEN_KEY = "smartchat_token";

// In development, connect directly to backend; in production, use full URL
const baseURL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? "http://localhost:3001/api" : "/api");

const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Debug logging
console.log("API URL:", api.defaults.baseURL);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url || "";
    if (
      status === 401 &&
      localStorage.getItem(TOKEN_KEY) &&
      !url.includes("/auth/login") &&
      !url.includes("/auth/register")
    ) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event("auth:logout"));
    }
    return Promise.reject(err);
  },
);

export default api;
