// Syncs the Featured Repositories region of README.md from the user's pinned repositories.
// Only the text between the START/END markers is replaced. On any API error the README is left untouched.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const START = "<!-- FEATURED-REPOS:START -->";
export const END = "<!-- FEATURED-REPOS:END -->";

const PINNED_QUERY = `query($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes { ... on Repository { name url description isPrivate primaryLanguage { name } } }
    }
  }
}`;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fetch pinned repositories. Throws on any failure so the caller never writes partial data.
export async function fetchPinned(login, token, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "featured-repos-sync" },
    body: JSON.stringify({ query: PINNED_QUERY, variables: { login } }),
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`rate limited or forbidden (HTTP ${res.status}); README not changed`);
  }
  if (!res.ok) throw new Error(`GraphQL request failed (HTTP ${res.status}); README not changed`);
  const body = await res.json();
  if (body.errors?.length) throw new Error("GraphQL errors: " + body.errors.map((e) => e.message).join("; ") + "; README not changed");
  const user = body.data?.user;
  if (!user) throw new Error(`user "${login}" not found; README not changed`);
  return (user.pinnedItems?.nodes ?? []).filter((n) => n && n.name && !n.isPrivate);
}

// Build the generated region. Handles zero, one or many pinned repositories.
export function buildRegion(repos, login) {
  if (repos.length === 0) return `<p align="center"><em>No pinned repositories right now.</em></p>`;
  const cards = repos.map((r) => {
    const label = [r.name, r.description, r.primaryLanguage?.name].filter(Boolean).join(" - ");
    const card = `https://github-readme-stats.vercel.app/api/pin/?username=${encodeURIComponent(login)}&repo=${encodeURIComponent(r.name)}&theme=dark`;
    return `<a href="${esc(r.url)}"><img alt="${esc(label)}" src="${esc(card)}" /></a>`;
  });
  return `<p align="center">\n${cards.join("\n")}\n</p>`;
}

// Replace only the text between the markers. Refuses if markers are missing or duplicated.
export function replaceRegion(readme, region) {
  const s = readme.split(START), e = readme.split(END);
  if (s.length !== 2 || e.length !== 2) throw new Error("expected exactly one START and one END marker; README not changed");
  const a = readme.indexOf(START), b = readme.indexOf(END);
  if (b < a) throw new Error("END marker precedes START marker; README not changed");
  return readme.slice(0, a + START.length) + "\n" + region + "\n" + readme.slice(b);
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const login = process.env.PROFILE_LOGIN || "abufazal460";
  const path = process.env.README_PATH || "README.md";
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const repos = await fetchPinned(login, token);
  const readme = await readFile(path, "utf8");
  const next = replaceRegion(readme, buildRegion(repos, login));
  if (next !== readme) await writeFile(path, next);
  console.log(`pinned repositories: ${repos.length}; README ${next !== readme ? "updated" : "unchanged"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
