"""End-to-end smoke test of the whole user journey in a real browser (Playwright + Chromium).

    make e2e                      # builds the single file + web app, then runs this
    python tests/e2e/smoke.py     # assumes CardioLens3D.html and frontend/dist exist

Checks, in order:
  1. Expert view: heart renders, all three arteries labelled, CAD estimate shown.
  2. Selecting LCX retargets the explanation; editing an input re-scores and "Undo edits" restores it.
  3. Clinical-note import fills the patient from the example letter.
  4. Expert PDF export: a real PDF whose CAD figure matches the screen.
  5. Guided view: all five steps render; what-if slider changes the estimate; the report PDF matches.
  6. No-WebGL browser: the app still works and shows the 2D artery diagram instead of crashing.
  7. Server vs browser: the FastAPI server and the in-browser engine give the same numbers, and the
     app falls back to the browser engine when the server disappears.
"""
from __future__ import annotations

import io
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
SINGLE = (ROOT / "CardioLens3D.html").as_uri()
GL = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def cad_text(pg):
    return pg.locator(".headline .big").first.inner_text().strip()


def pdf_text(download) -> str:
    data = Path(download.path()).read_bytes()
    assert data[:4] == b"%PDF", "not a PDF"
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)


def expert_and_guided(pw):
    b = pw.chromium.launch(args=GL)
    pg = b.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(SINGLE)
    pg.wait_for_selector(".lightbox canvas", timeout=30000)
    pg.wait_for_timeout(4000)

    # 1. expert view
    labels = pg.locator(".vlabel").all_inner_texts()
    check("expert: heart canvas + LAD/LCX/RCA labels", all(any(v in t for t in labels) for v in ("LAD", "LCX", "RCA")), str(labels))
    base = cad_text(pg)
    check("expert: CAD estimate shown", re.search(r"\d+%", base), base)

    # 2. vessel selection + edit + undo
    pg.locator(".why-head button, .seg button, button").filter(has_text=re.compile(r"^LCX$")).first.click()
    pg.wait_for_timeout(300)
    why = pg.locator(".rail").last.inner_text()
    check("expert: selecting LCX retargets the explanation", "circumflex" in why.lower() or "LCX" in why)
    bp = pg.locator('input[type="number"]').nth(0)
    before_inputs = bp.input_value()
    bp.fill("80"); bp.press("Tab"); pg.wait_for_timeout(600)
    edited = cad_text(pg)
    undo = pg.get_by_role("button", name="Undo edits")
    check("expert: editing an input enables Undo", undo.is_enabled(), f"age {before_inputs}→80, CAD {base}→{edited}")
    undo.click(); pg.wait_for_timeout(600)
    check("expert: Undo restores the estimate", cad_text(pg) == base, cad_text(pg))

    # 3. clinical-note import
    pg.get_by_role("button", name=re.compile("Import from clinical note")).click()
    pg.get_by_role("button", name="Try an example letter").click()
    n = int(pg.locator(".note-count b").inner_text())
    pg.locator(".note-foot .btn.primary").click(); pg.wait_for_timeout(1200)
    age = pg.locator('input[type="number"]').nth(0).input_value()
    check("note import: example letter fills the patient", n >= 25 and age == "58", f"{n} inputs, age {age}")
    noted = cad_text(pg)

    # 4. expert PDF
    with pg.expect_download() as d:
        pg.get_by_role("button", name="Download PDF").click()
    txt = pdf_text(d.value)
    num = re.sub(r"[^\d]", "", noted)
    check("expert PDF: valid and matches on-screen CAD", "CardioLens" in txt and num in re.sub(r"\s", "", txt), f"screen {noted}")

    # 5. guided view
    pg.get_by_role("button", name=re.compile("Guided view")).first.click()
    gs = pg.get_by_role("button", name="Get started")
    if gs.count():
        gs.click()
    seen = []
    for step in ["Patient", "Heart", "Why", "What if", "Report"]:
        pg.locator(".stepper").get_by_text(step, exact=True).click(); pg.wait_for_timeout(1500)
        cur = pg.locator('.stepper [aria-current="step"]').inner_text()
        body = pg.evaluate("document.body.innerText.length")
        seen.append(step if step in cur and body > 400 else "")
        if step == "Patient":   # a mid-risk example, so a what-if change is visible (a >99% patient saturates)
            pg.locator(".persona").filter(has_text="Right artery only").click(); pg.wait_for_timeout(800)
        if step == "Heart":
            check("guided: heart canvas renders", pg.locator(".stage canvas").count() > 0)
        if step == "What if":
            slider = pg.locator("#wi-bp")
            slider.fill("200"); pg.wait_for_timeout(800)
            deltas = pg.locator(".ba-d").all_inner_texts()   # CAD, LAD, LCX, RCA (CAD may already be saturated)
            check("guided: what-if slider changes the estimates", any(d != "no change" for d in deltas), " / ".join(deltas))
            pg.get_by_role("button", name="Undo all changes").click(); pg.wait_for_timeout(400)
    check("guided: all five steps render", len([s for s in seen if s]) == 5, " → ".join(s or "?" for s in seen))
    shown = pg.locator(".g-pill").inner_text()          # e.g. "CAD 29%"
    with pg.expect_download() as d:
        pg.get_by_role("button", name=re.compile("Download PDF report")).click()
    txt = pdf_text(d.value)
    gnum = re.sub(r"[^\d]", "", shown)
    check("guided PDF: valid and matches on-screen CAD", gnum and gnum + "%" in re.sub(r"\s", "", txt), shown)
    check("no page errors (WebGL browser)", not errors, "; ".join(errors[:3]))
    b.close()


def no_webgl(pw):
    b = pw.chromium.launch(args=["--disable-webgl", "--disable-3d-apis", "--disable-gpu"])
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(SINGLE); pg.wait_for_timeout(5000)
    ok = pg.locator(".fallback2d").count() > 0 and re.search(r"\d+%", cad_text(pg))
    check("no-WebGL: app works with the 2D artery diagram", ok, f"CAD {cad_text(pg) if pg.locator('.headline .big').count() else '—'}")
    pg.locator(".fallback2d g").nth(1).dispatch_event("click"); pg.wait_for_timeout(300)
    check("no-WebGL: arteries still clickable", pg.locator('.fallback2d path[stroke-width="9"]').count() == 1)
    check("no page errors (no-WebGL browser)", not errors, "; ".join(errors[:3]))
    b.close()


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def server_parity(pw):
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        check("server parity", False, "frontend/dist missing: run `make build`"); return
    port = free_port()
    srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app.main:app", "--port", str(port)], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), 0.5).close(); break
            except OSError:
                time.sleep(0.5)
        b = pw.chromium.launch(args=GL)
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(f"http://127.0.0.1:{port}/"); pg.wait_for_timeout(5000)
        eng = pg.locator(".engine b").inner_text()
        srv_cad = cad_text(pg)
        vessels_srv = pg.locator(".rail").last.inner_text()
        pg2 = b.new_page(viewport={"width": 1440, "height": 900})
        pg2.goto(SINGLE); pg2.wait_for_timeout(5000)
        check("server: header shows the server engine", eng == "server", eng)
        check("server vs browser: same CAD estimate", srv_cad == cad_text(pg2), f"server {srv_cad} / browser {cad_text(pg2)}")
        same = all(re.findall(rf"{v}\s*\n?.*?(\d+%)", vessels_srv, re.S)[:1] == re.findall(rf"{v}\s*\n?.*?(\d+%)", pg2.locator('.rail').last.inner_text(), re.S)[:1]
                   for v in ("LAD", "LCX", "RCA"))
        check("server vs browser: same vessel estimates", same)
        srv.terminate(); srv.wait(10)
        inp = pg.locator('input[type="number"]').nth(0)
        inp.fill("70"); inp.press("Tab"); pg.wait_for_timeout(2500)
        check("server stops → app falls back to the browser engine", pg.locator(".engine b").inner_text() == "in-browser",
              pg.locator(".engine b").inner_text())
        b.close()
    finally:
        if srv.poll() is None:
            srv.terminate()


if __name__ == "__main__":
    with sync_playwright() as pw:
        expert_and_guided(pw)
        no_webgl(pw)
        server_parity(pw)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)
