"""Verify the Windows UI layout in Chromium without altering Web Demo."""

import http.server
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT / "desktop-ui-check"
OUTPUT.mkdir(exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,fmt,*args):
        message=fmt%args
        if " 404 " in message or " 500 " in message:
            print(message,flush=True)

def main():
    server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
            url=f"http://127.0.0.1:{server.server_address[1]}/desktop-ui/index.html"
            page=browser.new_page(viewport={"width":1600,"height":980})
            errors=[]
            page.on("pageerror",lambda err:errors.append(str(err)))
            page.on("console",lambda msg:errors.append(msg.text) if msg.type=="error" else None)
            page.goto(url,wait_until="domcontentloaded")
            page.wait_for_function("document.querySelectorAll('#task-list .task').length === 4",timeout=30000)
            page.wait_for_function("document.querySelector('#main-image').naturalWidth > 0",timeout=10000)
            assert page.locator("#analyse-btn").is_visible()
            assert page.locator("#main-image").get_attribute("src").endswith("sample-corn.jpg")
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path=str(OUTPUT/"01-workbench.png"),full_page=True)
            page.locator('[data-mode="pest"]').click()
            assert "YOLO11s" in page.locator("#current-model-name").inner_text()
            page.locator('[data-mode="disease"]').click()
            page.locator("#file-input").set_input_files(str(ROOT/"desktop-ui/assets/sample-4.jpg"))
            page.wait_for_function("document.querySelectorAll('#task-list .task').length === 5")
            page.locator('[data-view="models"]').click()
            assert page.locator("#page-models").is_visible()
            page.screenshot(path=str(OUTPUT/"02-model-manager.png"),full_page=True)
            page.locator('[data-view="history"]').click()
            assert page.locator("#history-empty").is_visible()
            page.screenshot(path=str(OUTPUT/"03-history.png"),full_page=True)
            page.locator('[data-view="work"]').click()
            page.locator('[data-view="settings"]').click()
            assert page.locator("#page-settings").is_visible()
            page.screenshot(path=str(OUTPUT/"04-settings.png"),full_page=True)
            small=browser.new_page(viewport={"width":1280,"height":800})
            small.goto(url,wait_until="domcontentloaded")
            small.wait_for_function("document.querySelectorAll('#task-list .task').length === 4")
            assert small.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            small.screenshot(path=str(OUTPUT/"05-compact-window.png"),full_page=True)
            if errors: raise AssertionError("Browser errors: "+str(errors))
            print("Desktop UI passed: workbench, import queue, model switch, manager, history, settings, compact window",flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

if __name__=="__main__":
    main()
