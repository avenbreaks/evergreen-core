const MAX_LINKS = 50;
const MAX_MENTIONS = 50;

const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const bareUrlRegex = /(^|\s)(https?:\/\/[^\s<>{}"`|\\^\[\]]+)/gi;
const userMentionRegex = /(^|[^\w])@([a-zA-Z0-9_.-]{2,64})\b/g;
const ensMentionRegex = /(^|[^\w])@([a-zA-Z0-9-]{2,64}\.[a-zA-Z0-9.-]{2,120})\b/g;
const walletMentionRegex = /(^|[^\w])@(0x[a-fA-F0-9]{40})\b/g;
const codeFenceRegex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;

type LinkReference = {
  url: string;
  domain: string | null;
  normalizedUrl: string;
};

type MentionReference = {
  targetType: "user" | "ens" | "wallet";
  mentionText: string;
};

export type MarkdownAnalysis = {
  markdown: string;
  plaintext: string;
  htmlPreview: string;
  codeBlockCount: number;
  inlineCodeCount: number;
  links: LinkReference[];
  mentions: MentionReference[];
  wordCount: number;
};

const normalizeWhitespace = (input: string): string => input.replace(/\r\n/g, "\n").trim();

const extractDomain = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const normalizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
};

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildPlaintext = (markdown: string): string =>
  markdown
    .replace(codeFenceRegex, " $2 ")
    .replace(/`([^`]+)`/g, " $1 ")
    .replace(/\[(.*?)\]\((.*?)\)/g, " $1 ")
    .replace(/[>*#_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const countWords = (plaintext: string): number => {
  if (!plaintext) {
    return 0;
  }

  return plaintext.split(/\s+/).filter(Boolean).length;
};

const renderMarkdownPreview = (markdown: string): string => {
  const normalized = normalizeWhitespace(markdown);
  const codeBlocks: string[] = [];

  const withCodePlaceholders = normalized.replace(codeFenceRegex, (_match, language, code) => {
    const lang = typeof language === "string" && language ? language : "text";
    const escapedCode = escapeHtml(String(code));
    const html = `<pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>`;
    const token = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(html);
    return token;
  });

  let escaped = escapeHtml(withCodePlaceholders);
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

  escaped = escaped.replace(markdownLinkRegex, (_match, label, url) => {
    const safeUrl = escapeHtml(url);
    const safeLabel = escapeHtml(label);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer nofollow">${safeLabel}</a>`;
  });

  escaped = escaped.replace(bareUrlRegex, (_match, prefix, url) => {
    const safeUrl = escapeHtml(url);
    return `${prefix}<a href="${safeUrl}" target="_blank" rel="noopener noreferrer nofollow">${safeUrl}</a>`;
  });

  escaped = escaped.replace(/\n/g, "<br />");

  for (let i = 0; i < codeBlocks.length; i += 1) {
    escaped = escaped.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i] ?? "");
  }

  return escaped;
};

const extractLinks = (markdown: string): LinkReference[] => {
  const links: LinkReference[] = [];
  const seen = new Set<string>();

  const consume = (url: string): void => {
    const normalizedUrl = normalizeUrl(url);
    if (seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    links.push({
      url,
      normalizedUrl,
      domain: extractDomain(url),
    });
  };

  for (const match of markdown.matchAll(markdownLinkRegex)) {
    const url = match[2];
    if (url) {
      consume(url);
    }
    if (links.length >= MAX_LINKS) {
      return links;
    }
  }

  for (const match of markdown.matchAll(bareUrlRegex)) {
    const url = match[2];
    if (url) {
      consume(url);
    }
    if (links.length >= MAX_LINKS) {
      return links;
    }
  }

  return links;
};

const extractMentions = (markdown: string): MentionReference[] => {
  const mentions: MentionReference[] = [];
  const seen = new Set<string>();

  const pushMention = (mention: MentionReference): void => {
    const key = `${mention.targetType}:${mention.mentionText.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    mentions.push(mention);
  };

  for (const match of markdown.matchAll(walletMentionRegex)) {
    const mentionText = match[2];
    if (mentionText) {
      pushMention({
        targetType: "wallet",
        mentionText,
      });
    }
    if (mentions.length >= MAX_MENTIONS) {
      return mentions;
    }
  }

  for (const match of markdown.matchAll(ensMentionRegex)) {
    const mentionText = match[2];
    if (mentionText) {
      pushMention({
        targetType: "ens",
        mentionText,
      });
    }
    if (mentions.length >= MAX_MENTIONS) {
      return mentions;
    }
  }

  for (const match of markdown.matchAll(userMentionRegex)) {
    const mentionText = match[2];
    if (mentionText) {
      pushMention({
        targetType: "user",
        mentionText,
      });
    }
    if (mentions.length >= MAX_MENTIONS) {
      return mentions;
    }
  }

  return mentions;
};

export const analyzeMarkdown = (input: { markdown: string }): MarkdownAnalysis => {
  const markdown = normalizeWhitespace(input.markdown);
  const plaintext = buildPlaintext(markdown);
  const links = extractLinks(markdown);
  const mentions = extractMentions(markdown);
  const codeBlockCount = [...markdown.matchAll(codeFenceRegex)].length;
  const inlineCodeCount = [...markdown.matchAll(/`[^`]+`/g)].length;

  return {
    markdown,
    plaintext,
    htmlPreview: renderMarkdownPreview(markdown),
    links,
    mentions,
    codeBlockCount,
    inlineCodeCount,
    wordCount: countWords(plaintext),
  };
};
