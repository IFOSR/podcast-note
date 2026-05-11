import type { ResolvedEpisode, ResolvedSource, SourceConnector } from "./types.ts";
import { rssConnector } from "./rss.ts";

export const manualConnector: SourceConnector = {
  type: "manual",
  canHandle(input: string): boolean {
    return /^https?:\/\//i.test(input);
  },
  async resolveSource(input: string): Promise<ResolvedSource> {
    if (rssConnector.canHandle(input)) return rssConnector.resolveSource(input);
    const html = await fetchHtml(input);
    return {
      type: "manual",
      url: input,
      canonicalUrl: meta(html, "og:url") ?? input,
      title: meta(html, "og:site_name") ?? hostname(input),
      imageUrl: meta(html, "og:image"),
      metadata: {
        pageTitle: title(html)
      }
    };
  },
  async listEpisodes(source: ResolvedSource): Promise<ResolvedEpisode[]> {
    return [await this.resolveEpisode(source.url)];
  },
  async resolveEpisode(input: string): Promise<ResolvedEpisode> {
    if (rssConnector.canHandle(input)) return rssConnector.resolveEpisode(input);
    const html = await fetchHtml(input);
    return {
      title: meta(html, "og:title") ?? title(html) ?? input,
      description: meta(html, "og:description") ?? meta(html, "description"),
      publishedAt: meta(html, "article:published_time"),
      durationSec: parseDuration(meta(html, "music:duration") ?? meta(html, "video:duration")),
      audioUrl: audioUrlFromHtml(html),
      pageUrl: meta(html, "og:url") ?? input,
      imageUrl: meta(html, "og:image"),
      language: html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1],
      metadata: {
        resolver: "manual"
      }
    };
  }
};

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "PodcastNoteBot/0.1 (+https://example.invalid/podcast-note)"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

function meta(html: string, property: string): string | undefined {
  const escaped = property.replace(":", "\\:");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return undefined;
}

function title(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1]).replace(/\s+/g, " ").trim() : undefined;
}

function audioTag(html: string): string | undefined {
  const match = html.match(/<audio[^>]+src=["']([^"']+)["'][^>]*>/i) ?? html.match(/<source[^>]+src=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ? decodeHtml(match[1]).trim() : undefined;
}

function audioUrlFromHtml(html: string): string | undefined {
  const audioUrl = meta(html, "og:audio")
    ?? jsonStringField(html, "contentUrl")
    ?? jsonStringField(html, "url")
    ?? audioTag(html);
  return audioUrl ? normalizeAudioUrl(audioUrl) : undefined;
}

export function normalizeAudioUrl(input: string): string {
  try {
    const url = new URL(input);
    const ximalayaTarget = url.searchParams.get("jt");
    if (ximalayaTarget && /\.(mp3|m4a|mp4a|wav|ogg|raw)(?:$|\?)/i.test(ximalayaTarget)) {
      return ximalayaTarget;
    }
  } catch {
    return input;
  }
  return input;
}

function jsonStringField(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, "i"));
  return match?.[1] ? decodeHtml(match[1]).replace(/\\u0026/g, "&").replace(/\\\//g, "/").trim() : undefined;
}

function hostname(input: string): string {
  try {
    return new URL(input).hostname;
  } catch {
    return input;
  }
}

function parseDuration(input?: string): number | undefined {
  if (!input) return undefined;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
