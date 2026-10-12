#!/usr/bin/env node
// One-time Spotify authorisation for the media board's "now playing" line.
//
// Uses the Authorization Code + PKCE flow (no client secret leaves the script's
// local machine — but we still print a `supabase secrets set` command that
// includes your secret for convenience). Starts a loopback server, opens the
// browser, captures the redirect, exchanges the code, and prints the refresh
// token to store as a Supabase function secret.
//
// Setup: add this exact redirect URI in the Spotify dashboard
// (https://developer.spotify.com/dashboard): http://127.0.0.1:8888/callback
//
// Run:  node media/scripts/spotify_auth.mjs

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadEnv() {
  const map = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) map[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — fall back to process.env below */
  }
  return map;
}

const env = { ...loadEnv(), ...process.env };
const CLIENT_ID = env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = env.SPOTIFY_CLIENT_SECRET || "<your-secret>";
const PROJECT_REF = env.SUPABASE_PROJECT_REF || "gzwhuwzmrrmtswyhjheu";
const PORT = Number(env.SPOTIFY_PORT || 8888);
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "user-read-currently-playing user-read-recently-played";

if (!CLIENT_ID) {
  console.error("SPOTIFY_CLIENT_ID is not set (add it to .env)");
  process.exit(1);
}

const verifier = randomBytes(64).toString("base64url").slice(0, 128);
const challenge = createHash("sha256").update(verifier).digest("base64url");

const authorize = new URL("https://accounts.spotify.com/authorize");
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: CLIENT_ID,
  scope: SCOPES,
  redirect_uri: REDIRECT,
  code_challenge_method: "S256",
  code_challenge: challenge
}).toString();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/callback") {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error || !code) {
    response.end(`authorisation failed: ${error || "no code"}\n`);
    console.error(`authorisation failed: ${error || "no code"}`);
    server.close();
    process.exitCode = 1;
    return;
  }

  try {
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier
      })
    });
    const data = await tokenResponse.json();
    if (!tokenResponse.ok || !data.refresh_token) {
      throw new Error(JSON.stringify(data));
    }
    response.end("done — return to your terminal\n");
    console.log("\nRefresh token obtained. Store it as a Supabase function secret:\n");
    console.log(
      `  supabase secrets set SPOTIFY_CLIENT_ID=${CLIENT_ID} SPOTIFY_CLIENT_SECRET=${CLIENT_SECRET} SPOTIFY_REFRESH_TOKEN=${data.refresh_token} --project-ref ${PROJECT_REF}\n`
    );
    console.log(`(refresh token: ${data.refresh_token})\n`);
  } catch (err) {
    response.end("token exchange failed — see terminal\n");
    console.error(`token exchange failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nRedirect URI must be registered in your Spotify app: ${REDIRECT}\n`);
  console.log("Open this URL to authorise:\n");
  console.log(authorize.toString() + "\n");
  if (process.platform === "darwin") {
    spawn("open", [authorize.toString()], { stdio: "ignore", detached: true }).unref();
  }
});
