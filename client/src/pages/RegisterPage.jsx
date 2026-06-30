import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await register(username, email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50 p-6">
      <div className="w-full max-w-md rounded-3xl bg-white/95 p-10 shadow-2xl transition-all hover:shadow-3xl backdrop-blur-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            SMARTCHAT
          </h1>
          <p className="text-slate-600">Join the conversation</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error ? (
            <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 border border-red-200/50">
              {error}
            </div>
          ) : null}
          <div>
            <label htmlFor="username" className="block text-sm font-semibold text-slate-700 mb-2">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-slate-900 outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 backdrop-blur-sm"
              required
              minLength={2}
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-slate-900 outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 backdrop-blur-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-slate-200/60 px-5 py-4 text-slate-900 outline-none ring-indigo-500/30 transition-all focus:ring-2 focus:shadow-lg bg-slate-50/50 backdrop-blur-sm"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 py-4 font-semibold text-white shadow-lg transition-all hover:from-indigo-500 hover:via-blue-500 hover:to-purple-500 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
          >
            {submitting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                <span>Creating account…</span>
              </div>
            ) : (
              "Create account"
            )}
          </button>
        </form>
        <div className="mt-8 text-center">
          <p className="text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent hover:from-indigo-500 hover:to-blue-500 transition-all">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
