"""Run the published 387-class desktop classifier in Chromium with its actual ONNX weights."""

import hashlib
import http.server
import json
import threading
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT / "desktop-inference-check"
OUT.mkdir(exist_ok=True)
META="https://raw.githubusercontent.com/Vatsal2008/AgriSmart-AI/main/models/models.json"
WEIGHTS="https://raw.githubusercontent.com/Vatsal2008/AgriSmart-AI/main/models/india_v1.onnx"
EXPECTED_SHA="f6b0ad51ea7175a7426d40a08b2f56bade93f4de5c89da9ebe2540d3c81a27b4"

def get(url,path=None):
    request=urllib.request.Request(url,headers={"User-Agent":"FieldLens-Desktop-Verify/2.1"})
    with urllib.request.urlopen(request,timeout=160) as response:
        if path:
            with path.open("wb") as output:
                while chunk:=response.read(1024*1024):
                    output.write(chunk)
        else:
            return json.load(response)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,fmt,*args):
        message=fmt%args
        if " 404 " in message or " 500 " in message:
            print(message,flush=True)

def main():
    manifest=get(META)
    item=next(x for x in manifest["models"] if x["id"]=="india_v1")
    labels=[x["crop"]+"::"+x["label"] for x in item["labels"]]
    assert len(labels)==387
    weights=OUT/"disease.onnx"
    get(WEIGHTS,weights)
    sha=hashlib.sha256(weights.read_bytes()).hexdigest()
    assert sha==EXPECTED_SHA, (sha,EXPECTED_SHA)
    metadata={k:item[k] for k in ("img_size","mean","std","crop_pct")}
    metadata.update({"kind":"classification","labels":labels,"sha256":EXPECTED_SHA})
    server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin="http://127.0.0.1:"+str(server.server_address[1])
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
            page=browser.new_page(viewport={"width":1440,"height":900})
            page.add_init_script("""
              (() => {
                const meta = %s;
                const url = %s;
                window.fieldlensDesktop = Object.freeze({
                  modelMetadata: async key => { if(key!=='disease') throw Error('not used'); return meta; },
                  ensureModel: async key => { if(key!=='disease') throw Error('not used'); return {url}; },
                  modelStatus: async key => ({cached:key==='disease',size:57576210}),
                  getRuntimeInfo: async () => ({platform:'Windows model check',arch:'x64'}),
                  windowControl: () => true,
                  onProgress: () => {}
                });
              })();
            """ % (json.dumps(metadata,ensure_ascii=False),json.dumps(origin+"/desktop-inference-check/disease.onnx")))
            errors=[]
            page.on("pageerror",lambda e: errors.append(str(e)))
            page.goto(origin+"/desktop-ui/index.html",wait_until="domcontentloaded")
            page.wait_for_function("document.querySelectorAll('#task-list .task').length===4",timeout=30000)
            page.locator("#analyse-btn").click()
            try:
                page.wait_for_function("document.querySelector('#result-demo').style.display==='block'",timeout=200000)
                assert page.locator("#result-items .prediction").count()==5
                assert page.locator("#runtime-provider").inner_text() in ("WASM","WebGPU")
                print("Desktop classifier inference:",page.locator("#runtime-ms").inner_text(),page.locator("#diagnosis-name").inner_text(),flush=True)
                page.screenshot(path=str(OUT/"06-actual-classification.png"),full_page=True)
            except Exception:
                print("Desktop inference status:",page.locator("#status-file").inner_text(),flush=True)
                page.screenshot(path=str(OUT/"06-inference-failure.png"),full_page=True)
                raise
            if errors: raise AssertionError("JS errors: "+str(errors))
            print("387-class ONNX model passed real browser inference",flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

if __name__=="__main__":
    main()
