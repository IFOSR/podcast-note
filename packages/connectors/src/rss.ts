import type { ListEpisodeOptions, ResolvedEpisode, ResolvedSource, SourceConnector } from "./types.ts";

export const rssConnector: SourceConnector = {
  type: "rss",
  canHandle(input: string): boolean {
    return /^https?:\/\//i.test(input) && /\.(xml|rss)(\?|$)/i.test(input);
  },
  async resolveSource(input: string): Promise<ResolvedSource> {
    const xml = await fetchText(input);
    const channel = between(xml, "<channel", "</channel>") ?? xml;
    return {
      type: "rss",
      url: input,
      canonicalUrl: textContent(channel, "link") ?? input,
      title: textContent(channel, "title") ?? input,
      author: textContent(channel, "itunes:author") ?? textContent(channel, "author"),
      language: textContent(channel, "language"),
      imageUrl: attributeContent(channel, "itunes:image", "href") ?? textContent(channel, "url"),
      metadata: {
        description: textContent(channel, "description")
      }
    };
  },
  async listEpisodes(source: ResolvedSource, options: ListEpisodeOptions = {}): Promise<ResolvedEpisode[]> {
    const xml = await fetchText(source.url);
    const items = allBetween(xml, "<item", "</item>");
    const episodes = items.map((item) => parseItem(item, source));
    const since = options.since?.getTime();
    const filtered = since
      ? episodes.filter((episode) => !episode.publishedAt || new Date(episode.publishedAt).getTime() >= since)
      : episodes;
    return filtered.slice(0, options.limit ?? 100);
  },
  async resolveEpisode(input: string): Promise<ResolvedEpisode> {
    const source = await this.resolveSource(input);
    const episodes = await this.listEpisodes(source, { limit: 1 });
    const episode = episodes[0];
    if (!episode) throw new Error(`No RSS episodes found for ${input}`);
    return episode;
  }
};

export function parseRss(xml: string, sourceUrl = "inline:rss"): { source: ResolvedSource; episodes: ResolvedEpisode[] } {
  const channel = between(xml, "<channel", "</channel>") ?? xml;
  const source: ResolvedSource = {
    type: "rss",
    url: sourceUrl,
    canonicalUrl: textContent(channel, "link") ?? sourceUrl,
    title: textContent(channel, "title") ?? sourceUrl,
    author: textContent(channel, "itunes:author") ?? textContent(channel, "author"),
    language: textContent(channel, "language"),
    imageUrl: attributeContent(channel, "itunes:image", "href") ?? textContent(channel, "url"),
    metadata: {
      description: textContent(channel, "description")
    }
  };
  return {
    source,
    episodes: allBetween(xml, "<item", "</item>").map((item) => parseItem(item, source))
  };
}

function parseItem(item: string, source: ResolvedSource): ResolvedEpisode {
  const pageUrl = textContent(item, "link") ?? source.url;
  const guid = textContent(item, "guid") ?? attributeContent(item, "guid", "isPermaLink");
  return {
    guid: guid ?? pageUrl,
    externalId: guid ?? pageUrl,
    title: textContent(item, "title") ?? "Untitled episode",
    description: cleanHtml(textContent(item, "description") ?? textContent(item, "content:encoded") ?? ""),
    publishedAt: normalizeDate(textContent(item, "pubDate") ?? textContent(item, "published")),
    durationSec: parseDuration(textContent(item, "itunes:duration")),
    audioUrl: attributeContent(item, "enclosure", "url"),
    pageUrl,
    imageUrl: attributeContent(item, "itunes:image", "href") ?? source.imageUrl,
    language: source.language,
    metadata: {
      sourceTitle: source.title,
      author: textContent(item, "itunes:author") ?? source.author
    }
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "PodcastNoteBot/0.1 (+https://example.invalid/podcast-note)"
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }
  return response.text();
}

function allBetween(input: string, start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const startIndex = input.indexOf(start, cursor);
    if (startIndex === -1) break;
    const tagEnd = input.indexOf(">", startIndex);
    if (tagEnd === -1) break;
    const endIndex = input.indexOf(end, tagEnd);
    if (endIndex === -1) break;
    result.push(input.slice(tagEnd + 1, endIndex));
    cursor = endIndex + end.length;
  }
  return result;
}

function between(input: string, start: string, end: string): string | undefined {
  return allBetween(input, start, end)[0];
}

function textContent(input: string, tagName: string): string | undefined {
  const escaped = tagName.replace(":", "\\:");
  const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
  const match = input.match(pattern);
  return match?.[1] ? decodeXml(cleanCdata(match[1])).trim() : undefined;
}

function attributeContent(input: string, tagName: string, attribute: string): string | undefined {
  const escaped = tagName.replace(":", "\\:");
  const pattern = new RegExp(`<${escaped}\\s+[^>]*${attribute}=["']([^"']+)["'][^>]*\\/?>`, "i");
  const match = input.match(pattern);
  return match?.[1] ? decodeXml(match[1]).trim() : undefined;
}

function cleanCdata(input: string): string {
  return input.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function cleanHtml(input: string): string {
  return decodeXml(input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeXml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeDate(input?: string): string | undefined {
  if (!input) return undefined;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseDuration(input?: string): number | undefined {
  if (!input) return undefined;
  if (/^\d+$/.test(input)) return Number(input);
  const parts = input.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return undefined;
}

