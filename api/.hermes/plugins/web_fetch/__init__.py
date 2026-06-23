"""web_fetch plugin — retrieve a web page and return it as markdown."""

import json
import logging
import re
import urllib.error
import urllib.request
from html.parser import HTMLParser

logger = logging.getLogger(__name__)

# Tags whose content (including children) is silently dropped.
_STRIP_TAGS = frozenset({"script", "style", "iframe", "header", "footer", "nav"})

_HEADING_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})

# Inline tags that wrap content with a markdown marker on both sides.
_INLINE_MARKERS: dict[str, str] = {
    "strong": "**",
    "b": "**",
    "em": "*",
    "i": "*",
}

# Maximum characters returned to the model.
_MAX_CHARS = 50_000


class _HtmlToMarkdown(HTMLParser):
    """Streaming HTML → Markdown converter.

    Converts a strict subset of HTML to readable markdown.  Content inside
    _STRIP_TAGS is silently discarded.  Link text is buffered so that the
    full [text](href) form can be assembled after </a>.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._buf: list[str] = []
        self._skip: int = 0        # depth inside a stripped tag
        self._in_pre: bool = False
        self._list_stack: list[str] = []   # "ul" or "ol" per nesting level
        self._list_counts: list[int] = []  # ordered-list counters
        self._link_href: str | None = None  # href of the current <a>
        self._link_buf: list[str] = []      # text collected inside <a>

    # ------------------------------------------------------------------
    def _emit(self, text: str) -> None:
        """Append text to the link buffer (if inside <a>) or main buffer."""
        if self._link_href is not None:
            self._link_buf.append(text)
        else:
            self._buf.append(text)

    # ------------------------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list) -> None:
        if self._skip:
            self._skip += 1
            return
        if tag in _STRIP_TAGS:
            self._skip += 1
            return

        a = dict(attrs)

        if tag in _HEADING_TAGS:
            self._emit(f"\n\n{'#' * int(tag[1])} ")
        elif tag == "p":
            self._emit("\n\n")
        elif tag == "br":
            self._emit("  \n")
        elif tag in _INLINE_MARKERS:
            self._emit(_INLINE_MARKERS[tag])
        elif tag == "code" and not self._in_pre:
            self._emit("`")
        elif tag == "pre":
            self._emit("\n\n```\n")
            self._in_pre = True
        elif tag == "a":
            self._link_href = a.get("href", "")
            self._link_buf = []
        elif tag in ("ul", "ol"):
            self._list_stack.append(tag)
            self._list_counts.append(0)
        elif tag == "li":
            indent = "  " * (len(self._list_stack) - 1)
            if self._list_stack and self._list_stack[-1] == "ol":
                self._list_counts[-1] += 1
                self._emit(f"\n{indent}{self._list_counts[-1]}. ")
            else:
                self._emit(f"\n{indent}- ")
        elif tag == "img":
            alt = a.get("alt", "")
            src = a.get("src", "")
            self._emit(f"![{alt}]({src})")
        elif tag == "hr":
            self._emit("\n\n---\n\n")
        elif tag == "blockquote":
            self._emit("\n\n> ")
        elif tag in ("div", "section", "article", "main", "aside"):
            self._emit("\n\n")
        elif tag == "table":
            self._emit("\n\n")
        elif tag in ("td", "th"):
            self._emit(" | ")

    def handle_endtag(self, tag: str) -> None:
        if self._skip:
            self._skip -= 1
            return

        if tag in _HEADING_TAGS:
            self._emit("\n\n")
        elif tag in _INLINE_MARKERS:
            self._emit(_INLINE_MARKERS[tag])
        elif tag == "code" and not self._in_pre:
            self._emit("`")
        elif tag == "pre":
            self._emit("\n```\n\n")
            self._in_pre = False
        elif tag == "a":
            text = "".join(self._link_buf).strip()
            href = self._link_href or ""
            if text and href:
                self._buf.append(f"[{text}]({href})")
            elif text:
                self._buf.append(text)
            self._link_href = None
            self._link_buf = []
        elif tag in ("ul", "ol"):
            if self._list_stack:
                self._list_stack.pop()
                self._list_counts.pop()
            self._emit("\n")
        elif tag == "p":
            self._emit("\n\n")
        elif tag in ("div", "section", "article", "main", "aside"):
            self._emit("\n\n")
        elif tag == "tr":
            self._emit("\n")

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        self._emit(data)

    def result(self) -> str:
        text = "".join(self._buf)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def _fetch_as_markdown(url: str, timeout: int) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; HermesAgent/1.0)",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "text/html")
            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].strip().split(";")[0]

            # For non-HTML responses return the raw body as-is.
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                body = resp.read(_MAX_CHARS).decode(charset, errors="replace")
                return json.dumps({"url": url, "content": body})

            html = resp.read(_MAX_CHARS * 4).decode(charset, errors="replace")

    except urllib.error.HTTPError as exc:
        return json.dumps({"error": f"HTTP {exc.code}: {exc.reason}", "url": url})
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Request failed: {exc.reason}", "url": url})

    parser = _HtmlToMarkdown()
    parser.feed(html)
    markdown = parser.result()

    if len(markdown) > _MAX_CHARS:
        markdown = markdown[:_MAX_CHARS] + "\n\n[... content truncated ...]"

    return json.dumps({"url": url, "content": markdown})


def register(ctx) -> None:
    schema = {
        "name": "web_fetch",
        "description": (
            "Fetch a web page and return its main content as markdown. "
            "Strips scripts, styles, iframes, navigation headers, and footers. "
            "Use this when you already have a URL and want to read its content. "
            "Prefer web_extract for complex pages that require JavaScript rendering."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL to fetch (must start with http:// or https://)",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Request timeout in seconds (default: 15, max: 60)",
                    "default": 15,
                },
            },
            "required": ["url"],
        },
    }

    def handler(args: dict, **kwargs) -> str:
        url = args.get("url", "").strip()
        if not url:
            return json.dumps({"error": "url is required"})
        if not url.startswith(("http://", "https://")):
            return json.dumps({"error": "url must start with http:// or https://"})
        timeout = max(1, min(int(args.get("timeout", 15)), 60))
        try:
            return _fetch_as_markdown(url, timeout=timeout)
        except Exception as exc:
            logger.exception("web_fetch: unexpected error for %s", url)
            return json.dumps({"error": str(exc), "url": url})

    ctx.register_tool(
        name="web_fetch",
        toolset="web_fetch",
        schema=schema,
        handler=handler,
    )
