import { createHash } from 'node:crypto';
import { type AttachmentRef } from './github.model.js';

// Inline image embeds using GitHub's CDN domains
const IMAGE_EMBED_RE =
  /!\[([^\]]*)\]\((https:\/\/(?:github\.com\/user-attachments\/assets|user-images\.githubusercontent\.com)\/[^)\s]+)\)/g;

// File-attachment hyperlinks (GitHub uploads via drag-and-drop)
const FILE_LINK_RE = /\[([^\]]*)\]\((https:\/\/github\.com\/user-attachments\/files\/[^)\s]+)\)/g;

// Bare (un-linked) GitHub CDN asset or file URLs
const BARE_ASSET_RE = /\bhttps:\/\/github\.com\/user-attachments\/(?:assets|files)\/[^\s)<>"]+/g;

function filenameFor(url: string, label: string): string {
  // File downloads: the URL path already carries the original filename.
  const fileSeg = url.match(/\/files\/\d+\/([^/?#]+)/);
  if (fileSeg) {
    return decodeURIComponent(fileSeg[1]).replace(/[^\w.-]/g, '_');
  }

  // Assets and legacy image URLs: use a URL hash for uniqueness, infer extension.
  const ext = (label.match(/\.(\w{2,5})$/) ?? url.match(/\.(\w{2,5})(?:[?#]|$)/))?.[1] ?? 'bin';
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${hash}.${ext}`;
}

/** Extracts all GitHub-hosted attachment URLs embedded in a markdown string. */
export function extractAttachmentUrls(markdown: string): AttachmentRef[] {
  const seen = new Set<string>();
  const out: AttachmentRef[] = [];

  function push(url: string, label: string) {
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    out.push({ url, filename: filenameFor(url, label) });
  }

  for (const m of markdown.matchAll(IMAGE_EMBED_RE)) {
    push(m[2], m[1]);
  }
  for (const m of markdown.matchAll(FILE_LINK_RE)) {
    push(m[2], m[1]);
  }
  for (const m of markdown.matchAll(BARE_ASSET_RE)) {
    push(m[0], '');
  }

  return out;
}
