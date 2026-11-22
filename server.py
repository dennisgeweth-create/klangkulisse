#!/usr/bin/env python3
"""Die Klangkulisse örtlich ausliefern:  python server.py  → http://localhost:8790

Nicht `python -m http.server`: das sendet keine Cache-Vorgabe, und der
Browser liefert dann alte Stände von js/*.js aus. Außerdem braucht die
Seite einen Server, weil sie ES-Module und die Klangdateien per fetch lädt
(von file:// aus verweigert der Browser beides).
"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790


class Ohne(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.ogg': 'audio/ogg',
                      '.opus': 'audio/ogg', '.json': 'application/json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f'Klangkulisse: http://localhost:{PORT}')
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Ohne).serve_forever()
