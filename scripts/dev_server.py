#!/usr/bin/env python3
"""Local dev server — plain http.server, but with caching fully disabled.

python -m http.server sends only a Last-Modified header, no Cache-Control —
browsers still do heuristic caching against that, and in this project that
repeatedly served stale JS/CSS/HTML after edits (confirmed several times in
one session: the server always had the fresh file on disk, curl always saw
it, but the browser kept rendering an old cached copy that even a hard
refresh sometimes didn't clear). Cache-Control: no-store on every response
is the actual fix — during active development, "never serve a cached copy"
is exactly the tradeoff you want, and this project has no CDN/production
deploy path where that would matter.

Usage: python scripts/dev_server.py [port]  (default 5720, matches
.claude/launch.json)
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5720
    root = Path(__file__).resolve().parent.parent
    import os
    os.chdir(root)
    server = HTTPServer(("", port), NoCacheHandler)
    print(f"Serving {root} at http://localhost:{port} (caching disabled)")
    server.serve_forever()
