#!/usr/bin/env python3
"""
Simple HTTP server for the myAIgency.com static site.
Serves the site on http://localhost:8000

Usage:
    python3 serve.py
"""

import http.server
import socketserver
import os
import sys

PORT = 8000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add cache control headers
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

def main():
    # Change to the directory containing this script
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    Handler = MyHTTPRequestHandler

    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            print(f"\\n🚀 myAIgency.com static site server")
            print(f"   Serving at: http://localhost:{PORT}")
            print(f"\\n   Press Ctrl+C to stop\\n")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\\n\\nServer stopped.")
        sys.exit(0)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"\\n❌ Error: Port {PORT} is already in use.")
            print(f"   Try stopping other servers or use a different port.\\n")
        else:
            print(f"\\n❌ Error: {e}\\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
