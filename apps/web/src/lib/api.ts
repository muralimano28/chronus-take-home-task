import axios from "axios";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3010";

export const api = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Response interceptor for unified error parsing
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Standardized API error extraction
    const message = error.response?.data?.error || error.message || "An unknown network error occurred";
    return Promise.reject(new Error(message));
  }
);

export default api;
