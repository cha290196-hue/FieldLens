"""Browser smoke test for the published ONNX models."""

import contextlib
import http.server
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "dist"
SCREENSHOTS = Path("browser-check")
SCREENSHOTS.mkdir(exist_ok=True)


class Server(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        if " 404 " in (format % args) or " 500 " in (format % args):
            print(format % args, flush=True)


def wait_results(page, label):
    try:
        page.wait_for_function(
            """() => {
                const results = document.getElementById('results');
                return results && !results.classList.contains('hidden')
                    && document.getElementById('run-button').disabled === false;
            }""",
            timeout=180_000,
        )
        assert page.locator("#result-backend").inner_text() in ("WASM", "WebGPU")
        result = page.locator("#result-list").inner_text()
        print(label, page.locator("#result-ms").inner_text(), result[:220], flush=True)
        page.screenshot(path=str(SCREENSHOTS / (label + ".png")), full_page=True)
    except Exception:
        print(label, "status:", page.locator("#status-text").inner_text(), flush=True)
        page.screenshot(path=str(SCREENSHOTS / (label + "-error.png")), full_page=True)
        raise


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Server)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = "http://127.0.0.1:" + str(server.server_address[1]) + "/"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page(viewport={"width": 1440, "height": 960})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            assert "FieldLens" in page.title()
            mascot = page.locator(".mascot-specimen img")
            assert mascot.count() == 1
            page.wait_for_function("""() => { const i = document.querySelector(".mascot-specimen img"); return i && i.complete && i.naturalWidth > 0; }""", timeout=15_000)
            assert "mascotDrift" in page.locator(".mascot-specimen").evaluate("(el) => getComputedStyle(el).animationName")
            page.locator("#file-input").set_input_files(str(ROOT / "example-corn.jpg"))
            page.locator("#run-button").wait_for(state="visible")
            page.wait_for_function("!document.getElementById('run-button').disabled", timeout=15000)

            page.locator("#run-button").click()
            wait_results(page, "disease")
            assert page.locator("#result-list .result-item").count() == 5

            page.locator('[data-model="pest"]').click()
            page.locator("#run-button").click()
            wait_results(page, "pest")

            mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
            mobile.goto(url, wait_until="domcontentloaded", timeout=60_000)
            mobile.screenshot(path=str(SCREENSHOTS / "mobile.png"), full_page=True)
            assert mobile.locator("#run-button").is_visible()
            if errors:
                print("Browser errors:", errors, flush=True)
                raise AssertionError("Browser console errors were recorded")
            print("Browser inference checks passed", flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
