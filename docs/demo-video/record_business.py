"""Business demo: timed subtitles + clicks, no voice. Brand/KPI names are blurred."""
from __future__ import annotations

import asyncio
import re
import subprocess
import time
from pathlib import Path

from imageio_ffmpeg import get_ffmpeg_exe
from playwright.async_api import Locator, Page, async_playwright

APP = "http://127.0.0.1:8080"
EMAIL = "admin@admin.com"
PASSWORD = "admin"
P2 = 119.30
P3 = 242.57
LEAD = 1.50
CAP_LEAD = 0.55

ROOT = Path(__file__).resolve().parent
AUDIO_DIR = ROOT.parent / "demo-audio"
RAW = ROOT / "_raw" / "business"
OUT = ROOT / "AFV-business-demo.mp4"
FF = get_ffmpeg_exe()
VOICES = [
    AUDIO_DIR / "part-1-intro.mp3",
    AUDIO_DIR / "part-2-configure.mp3",
    AUDIO_DIR / "part-3-execute.mp3",
]

# Spoken lines at original VO times (part 2/3 already include P2/P3 offset).
LINES = [
    (1.76, "This is Agentic Frontend Validations. We use it to validate Athena reports."),
    (7.20, "It can do three kinds of checks."),
    (10.71, "First: front-end report versus front-end report. That is prod versus pre-prod."),
    (24.37, "Second: cross-screen front-end validation. Compare one Athena screen with another."),
    (34.85, "Third: front-end report versus the backend database."),
    (45.99, "The tool opens the Athena report, reads the numbers, compares them, and shows pass or fail."),
    (53.95, "The left menu is the whole tool."),
    (57.17, "Dashboard is the home page. Four boxes: total scenarios, cases ran, passed, and failed."),
    (75.70, "Below, results are grouped by Athena report. Open a report and you see each screen."),
    (83.26, "Screens is where we add the Athena report and each page."),
    (87.81, "Tests execution status shows the latest result of every case."),
    (91.50, "Runs is the history of every run."),
    (96.00, "SQL templates hold the database queries for report versus backend."),
    (101.53, "Settings holds Athena login and the database connection. We will not type passwords."),
    (112.87, "Next, we will add a report, add a case, and generate the script."),
    (P2 + 1.76, "Part two. We configure the case."),
    (P2 + 4.52, "On Screens, click Add screen. Pick or create the Athena report."),
    (P2 + 7.77, "Name the screen the way people say it, like Overview."),
    (P2 + 14.80, "Paste the Screen URL. That is the page the tool will open."),
    (P2 + 20.58, "If this is prod versus pre-prod, or one screen versus another, add a Reference URL."),
    (P2 + 27.75, "That is the second front-end report."),
    (P2 + 33.71, "Pick the saved Athena login. Do not type a password."),
    (P2 + 39.48, "If this case will check the database, attach the warehouse and SQL template."),
    (P2 + 45.10, "Then save."),
    (P2 + 49.70, "Open the screen and add a test case."),
    (P2 + 54.79, "Warehouse type means front-end versus the backend table."),
    (P2 + 61.39, "Reference type means front-end versus front-end: prod versus pre-prod, or screen versus screen."),
    (P2 + 69.31, "Write a short description of what you see on the Athena page: which page, tiles or grid, and filters."),
    (P2 + 82.27, "Add filter combinations. The script runs once for each filter set."),
    (P2 + 90.62, "Then open Test script and click Generate."),
    (P2 + 99.31, "The tool writes the browser steps, then tries the script. If something fails, it retries up to five times."),
    (P2 + 109.70, "When it passes, the script is saved."),
    (P2 + 119.33, "Next, we run it and look at the summary."),
    (P3 + 1.84, "Part three. We run the tests and read the summary."),
    (P3 + 5.30, "You can run the whole Athena report, one screen, or one case."),
    (P3 + 10.54, "Run report runs every page."),
    (P3 + 13.35, "Run suite runs every case on this screen."),
    (P3 + 16.79, "Run headless runs only this case."),
    (P3 + 20.26, "I will run this screen. Results appear as each case finishes."),
    (P3 + 28.66, "This is the live summary. Passed, failed, and still pending."),
    (P3 + 38.30, "Open a case. You see expected versus actual."),
    (P3 + 41.26, "That is prod versus pre-prod, one screen versus another, or report versus the database."),
    (P3 + 50.36, "If it failed, you see why, and often a screenshot."),
    (P3 + 57.50, "To run one case only, click Run headless. Latest result is the summary for that case."),
    (P3 + 74.77, "The Runs page is the list you share with the team."),
    (P3 + 84.86, "Back on Dashboard, the four boxes tell the story."),
    (P3 + 95.38, "Click Cases ran to see only cases that already have a result."),
    (P3 + 104.76, "Green means the numbers match. Red means they do not."),
    (P3 + 111.09, "This tool validates Athena reports: front-end versus front-end, screen versus screen, or report versus the backend."),
    (P3 + 118.76, "That's Agentic Frontend Validations."),
]

CAPTURE: dict = {
    "page": None,
    "folder": None,
    "i": 0,
    "t0": 0.0,
    "times": [],
    "scale": 1.0,
    "caption": "",
    "lock": None,
}


def probe_duration(path: Path) -> float:
    out = subprocess.run([FF, "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out.stderr)
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def wall(t: float) -> float:
    return t * float(CAPTURE.get("scale") or 1.0)


async def grab() -> None:
    page = CAPTURE.get("page")
    folder = CAPTURE.get("folder")
    lock = CAPTURE.get("lock")
    if not page or not folder:
        return

    async def _shot() -> None:
        i = CAPTURE["i"]
        dest = folder / f"{i:05d}.jpg"
        ts = time.monotonic() - CAPTURE["t0"]
        try:
            try:
                await page.evaluate("() => window.afvBlur && window.afvBlur()")
            except Exception:
                pass
            await page.screenshot(path=str(dest), type="jpeg", quality=48)
            if not dest.exists() or dest.stat().st_size < 20000:
                if dest.exists():
                    dest.unlink()
                return
            CAPTURE["times"].append(ts)
            CAPTURE["i"] = i + 1
        except Exception:
            pass

    if lock is None:
        await _shot()
        return
    async with lock:
        await _shot()


async def wait_until(t0: float, t: float) -> None:
    target = wall(t)
    while True:
        await grab()
        left = target - (time.monotonic() - t0)
        if left <= 0:
            break
        await asyncio.sleep(min(0.10, left))


async def wait_clock(t0: float, t: float) -> None:
    left = wall(t) - (time.monotonic() - t0)
    if left > 0:
        await asyncio.sleep(left)


async def inject(page: Page) -> None:
    try:
        await page.evaluate((ROOT / "overlay.js").read_text(encoding="utf-8"))
        text = CAPTURE.get("caption") or ""
        if text:
            await page.evaluate("(t) => window.afvCaption && window.afvCaption(t)", text)
        await page.evaluate("() => window.afvBlur && window.afvBlur()")
    except Exception:
        pass


async def caption(page: Page, text: str) -> None:
    CAPTURE["caption"] = text
    try:
        await page.evaluate("(t) => window.afvCaption && window.afvCaption(t)", text)
    except Exception:
        try:
            await inject(page)
        except Exception:
            pass
    await grab()


async def point(page: Page, loc: Locator, click: bool = False, fill: str | None = None) -> None:
    try:
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            try:
                if await loc.count() and await loc.first.is_visible():
                    break
            except Exception:
                pass
            await grab()
            await asyncio.sleep(0.08)
        else:
            return
        try:
            await loc.first.scroll_into_view_if_needed(timeout=1500)
        except Exception:
            pass
        box = await loc.first.bounding_box()
        if box:
            x = box["x"] + min(28.0, box["width"] * 0.35)
            y = box["y"] + min(22.0, box["height"] * 0.45)
            await page.mouse.move(x, y, steps=3)
            await page.evaluate("([x,y]) => window.afvCursor && window.afvCursor(x,y)", [x, y])
        await loc.first.evaluate("el => window.afvHighlight && window.afvHighlight(el)")
        await grab()
        if fill is not None:
            await loc.first.click()
            await loc.first.fill(fill)
            await grab()
        elif click:
            await loc.first.click()
            await inject(page)
            await grab()
    except Exception:
        pass


async def settle(page: Page) -> None:
    try:
        await page.locator("h1").first.wait_for(timeout=2500)
    except Exception:
        pass
    await inject(page)
    for _ in range(18):
        await grab()
        try:
            loaded = (
                await page.get_by_role("button", name="Run report").count()
                or await page.get_by_text("Example Report").count()
                or await page.get_by_text("By report").count()
                or await page.locator("a[href^='/runs/']").count()
            )
            if loaded:
                break
        except Exception:
            pass
        await asyncio.sleep(0.18)
    await inject(page)
    await grab()


async def nav(page: Page, name: str) -> None:
    await point(page, page.get_by_role("link", name=name), click=True)
    await settle(page)


async def login(page: Page) -> None:
    await page.goto(f"{APP}/auth", wait_until="domcontentloaded")
    await page.wait_for_timeout(500)
    if "/auth" in page.url:
        await page.locator("#email").fill(EMAIL)
        await page.locator("#password").fill(PASSWORD)
        await page.get_by_role("button", name="Sign in").click()
        await page.wait_for_url(lambda url: "/auth" not in url, timeout=30000)
    await page.get_by_role("heading", name="Dashboard").wait_for(timeout=20000)


async def speak_captions(page: Page, t0: float) -> None:
    """Subtitles follow the spoken line on the same clock as the MP3."""
    for t, text in LINES:
        await wait_clock(t0, max(0.0, t - CAP_LEAD))
        await caption(page, text)


async def walkthrough(page: Page, t0: float) -> None:
    await point(page, page.get_by_text("Total scenarios", exact=False))
    await wait_until(t0, 7.20 - LEAD)
    await point(page, page.get_by_role("heading", name="Dashboard"))
    await wait_until(t0, 46.00 - LEAD)
    await point(page, page.get_by_text("Passed", exact=True))
    await wait_until(t0, 50.50)
    await point(page, page.get_by_text("Failed", exact=True))
    await wait_until(t0, 54.00 - LEAD)
    await point(page, page.get_by_role("link", name="Dashboard"))
    await wait_until(t0, 57.17 - LEAD)
    await point(page, page.get_by_text("Total scenarios", exact=False))
    await wait_until(t0, 63.00 - LEAD)
    await point(page, page.get_by_text("Cases ran", exact=False))
    await wait_until(t0, 75.70 - LEAD)
    await point(page, page.get_by_text("By report", exact=False))
    await wait_until(t0, 77.00)
    await nav(page, "Screens")
    await wait_until(t0, 83.26 - LEAD)
    await point(page, page.get_by_role("button", name="Run report").first)
    await wait_until(t0, 87.81 - LEAD)
    await nav(page, "Tests execution status")
    await wait_until(t0, 91.50 - LEAD)
    await nav(page, "Runs")
    await wait_until(t0, 96.00 - LEAD)
    await nav(page, "SQL templates")
    await wait_until(t0, 101.53 - LEAD)
    await nav(page, "Settings")
    await wait_until(t0, 112.87 - LEAD)
    await nav(page, "Dashboard")

    await wait_until(t0, 115.50)
    await page.goto(f"{APP}/reports", wait_until="domcontentloaded")
    await settle(page)

    await wait_until(t0, P2 + 4.52 - LEAD)
    await point(page, page.get_by_role("button", name="Add screen"), click=True)
    await inject(page)
    await wait_until(t0, P2 + 7.77 - LEAD)
    await point(page, page.get_by_placeholder("Screen name"), fill="Example")
    await wait_until(t0, P2 + 13.00)
    await point(page, page.get_by_placeholder("Primary URL"), fill="https://example.com/abc")
    await wait_until(t0, P2 + 27.75 - LEAD)
    await point(page, page.get_by_placeholder("Reference report URL"), fill="https://example.com/xyz")
    await wait_until(t0, P2 + 33.71 - LEAD)
    await point(page, page.get_by_text("Screen Login Credentials", exact=False))
    await wait_until(t0, P2 + 39.48 - LEAD)
    await point(page, page.get_by_text("Warehouse SQL Configuration", exact=False))
    await wait_until(t0, P2 + 45.10 - LEAD)
    await point(page, page.get_by_role("button", name="Save"))
    await wait_until(t0, P2 + 47.00)
    await page.keyboard.press("Escape")
    await inject(page)
    await grab()

    await point(page, page.locator("a[href^='/reports/']").first, click=True)
    try:
        await page.locator("a[href^='/scenarios/']").first.wait_for(timeout=8000)
    except Exception:
        pass
    await inject(page)
    scen = page.locator("a[href^='/scenarios/']").first
    if await scen.count():
        await point(page, scen, click=True)
    try:
        await page.get_by_placeholder(re.compile(r"Description", re.I)).wait_for(state="visible", timeout=8000)
    except Exception:
        pass
    await inject(page)
    await page.evaluate("() => window.scrollTo(0, 0)")

    await wait_until(t0, P2 + 69.31 - LEAD)
    await page.evaluate("() => window.scrollTo(0, 0)")
    await point(page, page.get_by_placeholder(re.compile(r"Description", re.I)))
    await wait_until(t0, P2 + 82.27 - LEAD)
    filters = page.get_by_text("Filter combinations", exact=True)
    if not await filters.count():
        filters = page.get_by_text("Filter combinations", exact=False)
    await point(page, filters)
    await wait_until(t0, P2 + 88.50)
    tab = page.get_by_role("tab", name="Test script")
    if await tab.count():
        await point(page, tab, click=True)
    await wait_until(t0, P2 + 90.62 - LEAD)
    await point(page, page.get_by_role("button", name="Generate"))

    await wait_until(t0, P2 + 121.50)
    await page.goto(f"{APP}/reports", wait_until="domcontentloaded")
    await settle(page)

    await wait_until(t0, P3 + 5.30 - LEAD)
    await point(page, page.get_by_role("button", name="Run report").first)
    await point(page, page.locator("a[href^='/reports/']").first, click=True)
    try:
        await page.get_by_role("button", name="Run suite").first.wait_for(timeout=5000)
    except Exception:
        pass
    await inject(page)
    await wait_until(t0, P3 + 10.54 - LEAD)
    await point(page, page.get_by_role("button", name="Run report").first)
    await wait_until(t0, P3 + 13.35 - LEAD)
    await point(page, page.get_by_role("button", name="Run suite"))
    await wait_until(t0, P3 + 16.79 - LEAD)
    play = page.locator("a[href^='/scenarios/']").first
    await point(page, play if await play.count() else page.get_by_role("button", name="Run suite"))

    await wait_until(t0, P3 + 21.20)
    await nav(page, "Runs")
    try:
        await page.locator("a[href^='/runs/']").first.wait_for(timeout=5000)
    except Exception:
        pass
    failed = page.locator("a[href^='/runs/']").filter(has_text="failed").first
    await point(page, failed if await failed.count() else page.locator("a[href^='/runs/']").first, click=True)
    await wait_until(t0, P3 + 28.66 - LEAD)
    await point(page, page.locator("h1").first)
    await wait_until(t0, P3 + 38.30 - LEAD)
    await page.evaluate(
        """() => {
          const card = [...document.querySelectorAll('main .rounded-md.border')]
            .find((el) => /pass|fail/i.test(el.innerText || ''));
          const btn = card && card.querySelector('button');
          if (btn) btn.click();
        }"""
    )
    await grab()

    await wait_until(t0, P3 + 71.20)
    await nav(page, "Runs")
    await wait_until(t0, P3 + 78.50)
    await point(page, page.get_by_role("link", name="Dashboard"), click=True)
    deadline = t0 + wall(P3 + 94.00)
    while time.monotonic() < deadline:
        try:
            if await page.get_by_text("Example Report").count():
                break
        except Exception:
            pass
        await asyncio.sleep(0.15)
    if await page.get_by_text("Example Report").count():
        await inject(page)
        await grab()
    await wait_until(t0, P3 + 84.86 - LEAD)
    await point(page, page.get_by_text("Total scenarios", exact=False))
    await wait_until(t0, P3 + 95.38 - LEAD)
    await point(page, page.get_by_text("Cases ran", exact=False))
    await wait_until(t0, P3 + 104.76 - LEAD)
    await point(page, page.get_by_text("Passed", exact=True))
    await wait_until(t0, P3 + 108.30)
    await point(page, page.get_by_text("Failed", exact=True))
    await wait_until(t0, P3 + 111.09 - LEAD)
    await point(page, page.get_by_role("heading", name="Dashboard"))


def make_voice() -> tuple[Path, float]:
    ready = AUDIO_DIR / "AFV-business-voice.mp3"
    if ready.exists() and probe_duration(ready) > 60:
        return ready, probe_duration(ready)
    for src in VOICES:
        if not src.exists():
            raise FileNotFoundError(src)
    dest = AUDIO_DIR / "AFV-business-voice.mp3"
    args = [FF, "-y"]
    for src in VOICES:
        args += ["-i", str(src)]
    n = len(VOICES)
    filt = "".join(f"[{i}:a]aresample=22050,aformat=channel_layouts=mono[a{i}];" for i in range(n))
    filt += "".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    args += ["-filter_complex", filt, "-map", "[a]", "-ar", "22050", "-ac", "1", "-b:a", "128k", str(dest)]
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dest, probe_duration(dest)


def encode(folder: Path, dest: Path, times: list[float], duration: float) -> None:
    frames = sorted(folder.glob("*.jpg"))
    if not frames:
        raise RuntimeError("no frames")
    if len(times) > len(frames):
        times = times[: len(frames)]
    elif len(times) < len(frames):
        last = times[-1] if times else 0.0
        step = 0.10
        while len(times) < len(frames):
            last += step
            times.append(last)
    lst = folder / "concat.txt"
    lines = ["ffconcat version 1.0"]
    for i, frame in enumerate(frames):
        start = 0.0 if i == 0 else times[i]
        end = times[i + 1] if i + 1 < len(times) else max(duration, start + 0.12)
        path = frame.resolve().as_posix().replace("'", r"'\''")
        lines += [f"file '{path}'", f"duration {max(0.04, end - start):.4f}"]
    last = frames[-1].resolve().as_posix().replace("'", r"'\''")
    lines.append(f"file '{last}'")
    lst.write_text("\n".join(lines) + "\n", encoding="utf-8")
    subprocess.run(
        [
            FF, "-y",
            "-f", "concat", "-safe", "0", "-i", str(lst),
            "-vf", "fps=10,format=yuv420p",
            "-r", "10",
            "-video_track_timescale", "10000",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-an",
            "-t", f"{duration:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"frames={len(frames)} times={len(times)} last={times[-1]:.2f}s silent={duration:.2f}s")
    print(f"wrote {dest} ({dest.stat().st_size / 1024 / 1024:.1f} MB) {duration:.2f}s (no voice)")


async def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    frames = RAW / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    for old in frames.glob("*.jpg"):
        old.unlink()

    voice, voice_dur = make_voice()
    print(f"timing clock {voice_dur:.2f}s (subtitles on, voice off)")

    auth = RAW / "auth.json"
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()
        print("signing in...")
        await login(page)
        await context.storage_state(path=str(auth))
        await context.close()
        await browser.close()

        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(storage_state=str(auth), viewport={"width": 1440, "height": 900})
        page = await context.new_page()
        await page.goto(f"{APP}/", wait_until="domcontentloaded")
        await settle(page)
        await inject(page)

        t0 = time.monotonic()
        CAPTURE.update({
            "page": page,
            "folder": frames,
            "i": 0,
            "t0": t0,
            "times": [],
            "scale": 1.0,
            "caption": LINES[0][1],
            "lock": asyncio.Lock(),
        })
        await caption(page, LINES[0][1])
        print("recording (picture + subtitles, no voice)...")
        await asyncio.gather(speak_captions(page, t0), walkthrough(page, t0))
        leftover = voice_dur - (time.monotonic() - t0)
        if leftover > 0:
            end = time.monotonic() + leftover
            while time.monotonic() < end:
                await grab()
                await asyncio.sleep(0.09)
        times = list(CAPTURE["times"])
        CAPTURE["page"] = None
        await context.close()
        await browser.close()

    encode(frames, OUT, times, voice_dur)
    if auth.exists():
        auth.unlink()


if __name__ == "__main__":
    asyncio.run(main())
