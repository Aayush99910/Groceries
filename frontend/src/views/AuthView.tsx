import { useState } from "react";

import Icon from "../components/Icon";
import { User, login, signup } from "../api";

/**
 * Sign in / create account.
 *
 * No email verification and no password reset -- both need a mail service. If
 * someone forgets their password, you fix it from the sqlite3 CLI for now.
 */
export default function AuthView({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = isSignup
        ? await signup(email, password, displayName)
        : await login(email, password);
      onSignedIn(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-mark">
        <Icon name="cart" size="1.5em" />
      </div>
      <h1>Groceries</h1>
      <p className="tagline">
        {isSignup ? "Make an account to start your list" : "Sign in to your list"}
      </p>

      <form className="stack" onSubmit={submit}>
        {isSignup && (
          <div className="field">
            <label htmlFor="name">
              Your name <span className="muted">— optional</span>
            </label>
            <input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            // inputMode + autocomplete so her phone offers the right keyboard
            // and her saved address.
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />
          {isSignup && <span className="muted">At least 8 characters.</span>}
        </div>

        {error && (
          <p className="error">
            <Icon name="close" />
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? "…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <button
        className="link"
        onClick={() => {
          setMode(isSignup ? "login" : "signup");
          setError(null);
        }}
      >
        {isSignup ? "I already have an account" : "Create an account"}
      </button>
    </div>
  );
}
