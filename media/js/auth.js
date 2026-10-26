import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./data.js?v=20261026c";

// Email/password auth against Supabase Auth over REST (no supabase-js). The
// session is cached in localStorage and refreshed when it nears expiry.

const SESSION_KEY = "media:session:v1";
const AUTH = `${SUPABASE_URL}/auth/v1`;

function readStored() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

function store(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — session stays in memory only */
  }
}

function fromToken(payload) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (payload.expires_in || 3600),
    email: (payload.user && payload.user.email) || ""
  };
}

async function errorMessage(response, fallback) {
  try {
    const body = await response.json();
    return body.error_description || body.msg || body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

export async function signIn(email, password) {
  const response = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `sign-in failed (HTTP ${response.status})`));
  }
  const session = fromToken(await response.json());
  store(session);
  return session;
}

export async function signOut() {
  const session = readStored();
  store(null);
  if (session && session.accessToken) {
    try {
      await fetch(`${AUTH}/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` }
      });
    } catch {
      /* best effort — local session is already cleared */
    }
  }
}

async function refresh(session) {
  let response;
  try {
    response = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    store(null);
    return null;
  }
  const next = fromToken(await response.json());
  store(next);
  return next;
}

export async function getSession() {
  const session = readStored();
  if (!session) return null;
  if (session.expiresAt - 60 < Math.floor(Date.now() / 1000)) {
    return refresh(session);
  }
  return session;
}
