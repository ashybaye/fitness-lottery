const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
]);

export function isYoutubeVideoUrl(value) {
  if (typeof value !== "string" || value === "") return false;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !YOUTUBE_HOSTS.has(url.hostname) ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return false;
    }

    if (url.hostname === "youtu.be") return url.pathname.length > 1;
    if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"));
    return /^\/(embed|shorts|live)\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}
