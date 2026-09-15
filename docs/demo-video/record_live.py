"""Record the local app with a visible cursor, real clicks, and audio-aligned cuts."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import time
from pathlib import Path

from imageio_ffmpeg import get_ffmpeg_exe
from playwright.async_api import Locator, Page, async_playwright

APP = "http://127.0.0.1:8080"
EMAIL = "admin@admin.com"
PASSWORD = "admin"

ROOT = Path(__file__).resolve().parent
AUDIO = ROOT.parent / "demo-audio"
RAW = ROOT / "_raw"
OUT = ROOT
OVERLAY = (ROOT / "overlay.js").read_text(encoding="utf-8")  # refreshed on each run
FF = get_ffmpeg_exe()

# Record 1:1 to the combined VO, fire captions early, then speed the
# finished picture+voice together to TARGET_SECONDS so they stay locked.
AUDIO_TEMPO = 1.0
LEAD = 4.50
TARGET_SECONDS = 240.0

PARTS = [
    {"name": "part-1-intro", "audio": AUDIO / "part-1-intro.mp3", "seconds": 119.30},
    {"name": "part-2-configure", "audio": AUDIO / "part-2-configure.mp3", "seconds": 123.27},
    {"name": "part-3-execute", "audio": AUDIO / "part-3-execute.mp3", "seconds": 122.44},
]


def ensure_slow_mp3(src: Path) -> tuple[Path, float]:
    dest = src.with_name(src.stem + "-slow.mp3")
    if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(
            [
                FF, "-y", "-i", str(src),
                "-filter:a", f"atempo={AUDIO_TEMPO}",
                str(dest),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return dest, probe_duration(dest)


def probe_duration(path: Path) -> float:
    out = subprocess.run([FF, "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out.stderr)
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


CAPTURE: dict = {"page": None, "folder": None, "i": 0, "t0": 0.0, "times": []}


async def grab() -> None:
    page = CAPTURE.get("page")
    folder = CAPTURE.get("folder")
    if not page or not folder:
        return
    i = CAPTURE["i"]
    try:
        await page.screenshot(path=str(folder / f"{i:05d}.jpg"), type="jpeg", quality=48)
        CAPTURE["times"].append(time.monotonic() - CAPTURE["t0"])
        CAPTURE["i"] = i + 1
    except Exception:
        pass


def combine_audio(sources: list[Path], dest: Path) -> float:
    """Join VO files into one MP3 (re-encode so timestamps stay clean)."""
    args = [FF, "-y"]
    for src in sources:
        args += ["-i", str(src)]
    n = len(sources)
    filt = "".join(f"[{i}:a]aresample=22050,aformat=channel_layouts=mono[a{i}];" for i in range(n))
    filt += "".join(f"[a{i}]" for i in range(n))
    filt += f"concat=n={n}:v=0:a=1[a]"
    args += ["-filter_complex", filt, "-map", "[a]", "-ar", "22050", "-ac", "1", str(dest)]
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return probe_duration(dest)


async def wait_until(t0: float, t: float) -> None:
    """t is a time on the original combined VO (plus CAPTURE offset)."""
    target = (t + float(CAPTURE.get("offset") or 0.0)) / AUDIO_TEMPO
    while True:
        await grab()
        left = target - (time.monotonic() - t0)
        if left <= 0:
            break
        await asyncio.sleep(min(0.08, left))


async def hit(t0: float, t: float) -> None:
    """Reach the UI and caption before the voice line (video was lagging)."""
    await wait_until(t0, max(0.0, t - LEAD * AUDIO_TEMPO))


async def say(page: Page, t0: float, t: float, title: str, sub: str = "") -> None:
    await hit(t0, t)
    await caption(page, title, sub)


async def inject(page: Page) -> None:
    await page.evaluate((ROOT / "overlay.js").read_text(encoding="utf-8"))


async def caption(page: Page, title: str, sub: str = "") -> None:
    await page.evaluate("([t,s]) => window.afvCaption && window.afvCaption(t,s)", [title, sub])


async def point(page: Page, loc: Locator, click: bool = False, fill: str | None = None) -> None:
    try:
        await loc.first.wait_for(state="visible", timeout=4000)
        try:
            await loc.first.scroll_into_view_if_needed(timeout=2000)
        except Exception:
            pass
        box = await loc.first.bounding_box()
        if box:
            x = box["x"] + min(28.0, box["width"] * 0.35)
            y = box["y"] + min(22.0, box["height"] * 0.45)
            await page.mouse.move(x, y, steps=6)
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


async def nav_click(page: Page, name: str) -> None:
    await point(page, page.get_by_role("link", name=name), click=True)
    await settle(page)


async def settle(page: Page) -> None:
    try:
        await page.locator("h1").first.wait_for(timeout=2500)
    except Exception:
        pass
    await inject(page)
    for _ in range(22):
        await grab()
        try:
            empty = (
                await page.get_by_text("No scenarios configured", exact=True).count()
                or await page.get_by_text("0 screens", exact=True).count()
                or await page.get_by_text("0 scenarios", exact=True).count()
            )
            loaded = (
                await page.get_by_role("button", name="Run report").count()
                or await page.get_by_text("Kerendia").count()
                or await page.get_by_text("200 runs").count()
                or await page.locator("a[href^='/runs/']").count()
            )
            if loaded and not empty:
                break
        except Exception:
            pass
        await asyncio.sleep(0.2)
    await inject(page)
    await grab()


async def login(page: Page) -> None:
    await page.goto(f"{APP}/auth", wait_until="domcontentloaded")
    await page.wait_for_timeout(600)
    if "/auth" in page.url:
        await page.locator("#email").fill(EMAIL)
        await page.locator("#password").fill(PASSWORD)
        await page.get_by_role("button", name="Sign in").click()
        await page.wait_for_url(lambda url: "/auth" not in url, timeout=30000)
    await page.get_by_role("heading", name="Dashboard").wait_for(timeout=20000)


async def part1(page: Page, t0: float) -> None:
    # Times from silencedetect on part-1-intro.mp3
    await caption(page, "Agentic Frontend Validations", "We use this to validate Athena reports")
    await point(page, page.get_by_text("Total scenarios", exact=False))
    await say(page, t0, 7.2, "It can do three kinds of checks", "Watch the caption change for each one")
    await say(page, t0, 10.7, "1. Front-end vs front-end", "Same Athena report: prod vs pre-prod")
    await point(page, page.get_by_role("heading", name="Dashboard"))
    await say(page, t0, 24.4, "2. Cross-screen front-end", "Example: Overview vs Activity")
    await say(page, t0, 34.9, "3. Front-end vs backend database", "Tiles or grid vs the warehouse table")
    await say(page, t0, 46.0, "The tool reads the report", "Then it shows pass or fail")
    await point(page, page.get_by_text("Passed", exact=True))
    await wait_until(t0, 50.5)
    await point(page, page.get_by_text("Failed", exact=True))
    await say(page, t0, 54.0, "Left menu = the whole tool", "I will click each page as I name it")
    await point(page, page.get_by_role("link", name="Dashboard"))
    await say(page, t0, 57.2, "Dashboard — four boxes", "Total → Cases ran → Passed → Failed")
    await point(page, page.get_by_text("Total scenarios", exact=False))
    await say(page, t0, 63.0, "Cases ran", "How many cases already have a result")
    await point(page, page.get_by_text("Cases ran", exact=False))
    await say(page, t0, 66.5, "Passed", "Numbers matched")
    await point(page, page.get_by_text("Passed", exact=True))
    await say(page, t0, 69.5, "Failed", "Numbers did not match")
    await point(page, page.get_by_text("Failed", exact=True))
    await say(page, t0, 75.7, "By report", "Open a report to see each Athena screen")
    await point(page, page.get_by_text("By report", exact=False))
    await wait_until(t0, 77.0)
    await nav_click(page, "Screens")
    try:
        await page.get_by_role("button", name="Run report").first.wait_for(timeout=8000)
    except Exception:
        pass
    await say(page, t0, 83.3, "Screens", "Add the Athena report and each page here")
    await point(page, page.get_by_role("button", name="Run report").first)
    await say(page, t0, 87.8, "Tests execution status", "Latest result of every case")
    await nav_click(page, "Tests execution status")
    await point(page, page.get_by_role("heading", name="Tests execution status"))
    await say(page, t0, 91.5, "Runs", "History of every execution")
    await nav_click(page, "Runs")
    await point(page, page.get_by_role("heading", name="Runs"))
    await say(page, t0, 96.0, "SQL templates", "Queries for report vs database")
    await nav_click(page, "SQL templates")
    await point(page, page.get_by_role("heading", name="SQL templates"))
    await say(page, t0, 101.5, "Settings", "Athena login and database — no passwords on camera")
    await nav_click(page, "Settings")
    await point(page, page.get_by_role("heading", name="Settings"))
    await say(page, t0, 112.9, "Next: add a report, a case, and generate the script")
    await nav_click(page, "Dashboard")
    await point(page, page.get_by_role("heading", name="Dashboard"))


def description_box(page: Page) -> Locator:
    return page.get_by_placeholder(re.compile(r"Description", re.I))


async def open_first_case(page: Page) -> None:
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
        await description_box(page).wait_for(state="visible", timeout=8000)
    except Exception:
        pass
    await inject(page)
    await page.evaluate("() => window.scrollTo(0, 0)")
    await grab()


async def part2(page: Page, t0: float) -> None:
    await caption(page, "Part 2 — Configure the case", "We start on Screens")
    await point(page, page.get_by_role("heading", name="Screens"))

    await say(page, t0, 4.52, "Click Add screen", "Pick or create the Athena report")
    await point(page, page.get_by_role("button", name="Add screen"), click=True)
    await inject(page)

    await say(page, t0, 7.77, "Name the screen Overview", "Use the name people say for the Athena page")
    await point(page, page.get_by_placeholder("Screen name"), fill="Overview")

    await say(page, t0, 12.50, "Paste the Screen URL", "This is the page the tool will open")
    await point(page, page.get_by_placeholder("Primary URL"), fill="https://athena.example/overview")

    await say(page, t0, 20.58, "Prod vs pre-prod, or screen vs screen", "Add a Reference URL")
    await say(page, t0, 27.75, "Reference URL", "The second front-end report")
    await point(page, page.get_by_placeholder("Reference report URL"), fill="https://athena-preprod.example/overview")

    await say(page, t0, 33.71, "Pick the saved Athena login", "Do not type a password")
    await point(page, page.get_by_text("Screen Login Credentials", exact=False))

    await say(page, t0, 39.48, "Warehouse + SQL", "Only if this case compares the report to the database")
    await point(page, page.get_by_text("Warehouse SQL Configuration", exact=False))

    await say(page, t0, 45.10, "Then save", "We close the form so we do not change your catalog")
    await point(page, page.get_by_role("button", name="Save"))
    await wait_until(t0, 47.20)
    await page.keyboard.press("Escape")
    await inject(page)
    await grab()

    # Open the case now so Description / Filters / Generate are ready
    await open_first_case(page)

    await say(page, t0, 49.70, "Open the screen and add a test case")
    await point(page, page.locator("h1").first)

    await say(page, t0, 54.79, "Warehouse type", "Front-end versus the backend table")
    typ = page.get_by_text("Warehouse", exact=True)
    await point(page, typ if await typ.count() else page.locator("h1").first)

    await say(page, t0, 61.39, "Reference type", "Prod vs pre-prod, or screen vs screen")
    await point(page, page.get_by_text("Type", exact=True) if await page.get_by_text("Type", exact=True).count() else page.locator("h1").first)

    await say(page, t0, 69.31, "Description", "Which page, tiles or grid, and filters")
    await page.evaluate("() => window.scrollTo(0, 0)")
    await point(page, description_box(page))

    await say(page, t0, 82.27, "Filter combinations", "The script runs once per filter set")
    await point(page, page.get_by_text("Filter combinations", exact=False))

    await hit(t0, 88.57)
    tab = page.get_by_role("tab", name="Test script")
    if await tab.count():
        await point(page, tab, click=True)
    await say(page, t0, 90.62, "Test script → Generate", "The tool writes the steps, then tries them")
    await point(page, page.get_by_role("button", name="Generate"))

    await say(page, t0, 99.31, "It opens the report, logs in, applies filters, reads numbers", "If something fails it retries, up to five times")
    await point(page, page.get_by_role("button", name="Generate"))

    await say(page, t0, 109.70, "When it passes, the script is saved", "Bind SQL for database cases. Use a reference script for prod vs pre-prod.")

    await say(page, t0, 119.33, "Next: run it and look at the summary")


async def part3(page: Page, t0: float) -> None:
    # Beats = silence_end on part-3-execute.mp3
    await caption(page, "Part 3 — Run the tests and read the summary")
    await point(page, page.get_by_role("heading", name="Screens"))

    await say(page, t0, 5.30, "You can run a report, a screen, or one case")
    await point(page, page.get_by_role("button", name="Run report").first)
    await point(page, page.locator("a[href^='/reports/']").first, click=True)
    try:
        await page.get_by_role("button", name="Run suite").first.wait_for(timeout=5000)
    except Exception:
        pass
    await inject(page)

    await say(page, t0, 10.54, "Run report = every page in this Athena report")
    await point(page, page.get_by_role("button", name="Run report").first)

    await say(page, t0, 13.35, "Run suite = every case on this screen")
    await point(page, page.get_by_role("button", name="Run suite"))

    await say(page, t0, 16.79, "Run headless = only this one case")
    play = page.locator("a[href^='/scenarios/']").first
    await point(page, play if await play.count() else page.get_by_role("button", name="Run suite"))

    await wait_until(t0, 21.20)
    await nav_click(page, "Runs")
    try:
        await page.locator("a[href^='/runs/']").first.wait_for(timeout=5000)
    except Exception:
        pass
    failed_run = page.locator("a[href^='/runs/']").filter(has_text="failed").first
    if await failed_run.count():
        await point(page, failed_run, click=True)
    else:
        await point(page, page.locator("a[href^='/runs/']").first, click=True)

    await say(page, t0, 28.66, "This is the live summary", "Passed · failed · pending")
    await point(page, page.locator("h1").first)

    await say(page, t0, 38.30, "Open a case — expected vs actual")
    await page.evaluate(
        """() => {
          const card = [...document.querySelectorAll('main .rounded-md.border')]
            .find((el) => /pass|fail/i.test(el.innerText || ''));
          const btn = card && card.querySelector('button');
          if (btn) btn.click();
        }"""
    )
    await grab()
    for _ in range(12):
        await grab()
        if await page.get_by_text("Actual (UI", exact=False).count():
            break
        await asyncio.sleep(0.12)

    await say(page, t0, 41.26, "Expected vs actual", "Prod vs pre-prod, screen vs screen, or report vs database")

    await say(page, t0, 50.36, "If it failed, you see why", "Often with a screenshot")
    await page.mouse.wheel(0, 260)

    await say(page, t0, 57.50, "One case: Run headless → Latest result")

    await wait_until(t0, 71.20)
    await nav_click(page, "Runs")

    await say(page, t0, 74.77, "Runs list — share this with the team", "Report, passed, failed, and when")
    await point(page, page.get_by_role("heading", name="Runs"))

    await wait_until(t0, 76.00)
    await page.goto(f"{APP}/", wait_until="domcontentloaded")
    await inject(page)
    for _ in range(12):
        await grab()
        if await page.get_by_text("Kerendia").count():
            break
        await asyncio.sleep(0.12)

    await say(page, t0, 84.86, "Dashboard — four boxes", "Total → Cases ran → Passed → Failed")
    await point(page, page.get_by_text("Total scenarios", exact=False))

    await say(page, t0, 95.38, "Cases ran", "How many cases already have a result")
    await point(page, page.get_by_text("Cases ran", exact=False))

    await say(page, t0, 99.82, "Failed", "Numbers that did not match")
    await point(page, page.get_by_text("Failed", exact=True))

    await say(page, t0, 104.76, "Green = match. Red = mismatch")
    await point(page, page.get_by_text("Passed", exact=True))
    await hit(t0, 108.30)
    await point(page, page.get_by_text("Failed", exact=True))

    await say(page, t0, 111.09, "Recap: Athena report validation", "Front-end vs front-end · screen vs screen · report vs database")
    await point(page, page.get_by_role("heading", name="Dashboard"))

    await say(page, t0, 118.76, "That's Agentic Frontend Validations")


ACTIONS = {
    "part-1-intro": part1,
    "part-2-configure": part2,
    "part-3-execute": part3,
}


async def hold(seconds: float) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        await grab()
        await asyncio.sleep(0.09)


def encode_frames(folder: Path, audio: Path, dest: Path, times: list[float]) -> None:
    frames = sorted(folder.glob("*.jpg"))
    if not frames:
        raise RuntimeError(f"no frames in {folder}")
    ad = probe_duration(audio)
    if len(times) != len(frames):
        times = [i * (ad / max(len(frames), 1)) for i in range(len(frames))]
    lst = folder / "concat.txt"
    lines = ["ffconcat version 1.0"]
    for i, frame in enumerate(frames):
        start = times[i] if i == 0 else times[i]
        end = times[i + 1] if i + 1 < len(times) else max(ad, start + 0.12)
        if i == 0:
            start = 0.0
        dur = max(0.04, end - start)
        path = frame.resolve().as_posix().replace("'", r"'\''")
        lines.append(f"file '{path}'")
        lines.append(f"duration {dur:.4f}")
    last = frames[-1].resolve().as_posix().replace("'", r"'\''")
    lines.append(f"file '{last}'")
    lst.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (folder / "times.txt").write_text("\n".join(f"{t:.4f}" for t in times), encoding="utf-8")
    subprocess.run(
        [
            FF, "-y",
            "-f", "concat", "-safe", "0", "-i", str(lst),
            "-i", str(audio),
            "-vf", "fps=10,format=yuv420p",
            "-r", "10",
            "-video_track_timescale", "10000",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-c:a", "aac",
            "-ar", "22050",
            "-ac", "1",
            "-t", f"{ad:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"wrote {dest.name} ({dest.stat().st_size / 1024 / 1024:.1f} MB) frames={len(frames)} audio={ad:.2f}s last_t={times[-1]:.2f}s")


def mux_combined(mp4s: list[Path], dest: Path) -> None:
    """Join parts by re-encoding. Stream-copy of mixed 12fps/10fps files shortens video vs audio."""
    if len(mp4s) < 2:
        return
    args = [FF, "-y"]
    for p in mp4s:
        args += ["-i", str(p)]
    n = len(mp4s)
    filt = "".join(
        f"[{i}:v]fps=10,setpts=PTS-STARTPTS,format=yuv420p[v{i}];"
        f"[{i}:a]aresample=22050,asetpts=PTS-STARTPTS[a{i}];"
        for i in range(n)
    )
    filt += "".join(f"[v{i}][a{i}]" for i in range(n))
    filt += f"concat=n={n}:v=1:a=1[v][a]"
    args += [
        "-filter_complex", filt,
        "-map", "[v]",
        "-map", "[a]",
        "-r", "10",
        "-video_track_timescale", "10000",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-ar", "22050",
        "-ac", "1",
        "-movflags", "+faststart",
        str(dest),
    ]
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"wrote {dest.name} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")


def speed_to_duration(src: Path, dest: Path, target: float) -> None:
    """Speed picture and voice by the same factor so sync is unchanged."""
    ad = probe_duration(src)
    if ad <= 0:
        raise RuntimeError(f"no duration for {src}")
    factor = ad / target
    subprocess.run(
        [
            FF, "-y", "-i", str(src),
            "-filter_complex",
            f"[0:v]setpts=PTS/{factor:.6f},fps=10,format=yuv420p[v];"
            f"[0:a]atempo={factor:.6f}[a]",
            "-map", "[v]",
            "-map", "[a]",
            "-r", "10",
            "-video_track_timescale", "10000",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-c:a", "aac",
            "-ar", "22050",
            "-ac", "1",
            "-t", f"{target:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"wrote {dest.name} ({dest.stat().st_size / 1024 / 1024:.1f} MB) {ad:.2f}s -> {target:.2f}s x{factor:.3f}")


async def main() -> None:
    RAW.mkdir(exist_ok=True)
    auth = RAW / "auth.json"

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()
        print("signing in…")
        await login(page)
        await context.storage_state(path=str(auth))
        await context.close()
        await browser.close()
        print("signed in")

        only = (os.environ.get("DEMO_PART") or "").strip()
        parts = [x for x in PARTS if not only or x["name"] == only]
        for part in parts:
            slow, dur = ensure_slow_mp3(part["audio"])
            part["audio"] = slow
            part["seconds"] = dur
            print(f"audio {slow.name} {dur:.2f}s")
        for part in parts:
            print(f"recording {part['name']}…")
            fdir = RAW / part["name"] / "frames"
            fdir.mkdir(parents=True, exist_ok=True)
            browser = await p.chromium.launch(channel="chrome", headless=True)
            context = await browser.new_context(
                storage_state=str(auth),
                viewport={"width": 1440, "height": 900},
            )
            page = await context.new_page()
            start_path = "/" if part["name"] == "part-1-intro" else "/reports"
            await page.goto(f"{APP}{start_path}", wait_until="domcontentloaded")
            await settle(page)
            await inject(page)
            for old in fdir.glob("*.jpg"):
                old.unlink()
            t0 = time.monotonic()
            CAPTURE.update({"page": page, "folder": fdir, "i": 0, "t0": t0, "times": []})
            await grab()
            await ACTIONS[part["name"]](page, t0)
            leftover = part["seconds"] - (time.monotonic() - t0)
            if leftover > 0:
                await hold(leftover)
            times = list(CAPTURE["times"])
            CAPTURE["page"] = None
            await context.close()
            await browser.close()
            encode_frames(fdir, part["audio"], OUT / f"{part['name']}.mp4", times)

    all_mp4s = [OUT / f"{p['name']}.mp4" for p in PARTS if (OUT / f"{p['name']}.mp4").exists()]
    if len(all_mp4s) >= 2:
        mux_combined(all_mp4s, OUT / "AFV-demo-all-parts.mp4")
    if auth.exists():
        auth.unlink()


async def record_one_take() -> None:
    """One new video, timed to a single combined audio file. Does not read old MP4s."""
    RAW.mkdir(exist_ok=True)
    auth = RAW / "auth.json"
    sources = [p["audio"] for p in PARTS]
    for src in sources:
        if not src.exists():
            raise FileNotFoundError(src)
    orig_durs = [probe_duration(src) for src in sources]
    combined = AUDIO / "AFV-demo-all-parts.mp3"
    print("combining audio...", [round(d, 2) for d in orig_durs])
    combine_audio(sources, combined)
    audio_dur = probe_duration(combined)
    print(f"combined audio {combined.name} ({audio_dur:.2f}s)")

    full = RAW / "one-take" / "full.mp4"
    dest = OUT / "AFV-demo-4min.mp4"
    fdir = RAW / "one-take" / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    for old in fdir.glob("*.jpg"):
        old.unlink()

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()
        print("signing in…")
        await login(page)
        await context.storage_state(path=str(auth))
        await context.close()
        await browser.close()

        browser = await p.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(
            storage_state=str(auth),
            viewport={"width": 1440, "height": 900},
        )
        page = await context.new_page()
        await page.goto(f"{APP}/", wait_until="domcontentloaded")
        await settle(page)
        await inject(page)

        t0 = time.monotonic()
        CAPTURE.update({"page": page, "folder": fdir, "i": 0, "t0": t0, "times": [], "offset": 0.0})
        await grab()
        print("recording part 1…")
        await part1(page, t0)

        await wait_until(t0, 115.5)
        await page.goto(f"{APP}/reports", wait_until="domcontentloaded")
        await settle(page)

        CAPTURE["offset"] = orig_durs[0]
        print(f"recording part 2 (offset {orig_durs[0]:.2f}s)…")
        await part2(page, t0)

        await page.goto(f"{APP}/reports", wait_until="domcontentloaded")
        await settle(page)
        CAPTURE["offset"] = orig_durs[0] + orig_durs[1]
        print(f"recording part 3 (offset {CAPTURE['offset']:.2f}s)…")
        await part3(page, t0)

        leftover = audio_dur - (time.monotonic() - t0)
        if leftover > 0:
            await hold(leftover)
        times = list(CAPTURE["times"])
        CAPTURE["page"] = None
        await context.close()
        await browser.close()

    from_audio = OUT / "AFV-demo-from-audio.mp4"
    encode_frames(fdir, combined, full, times)
    encode_frames(fdir, combined, from_audio, times)
    speed_to_duration(full, dest, TARGET_SECONDS)
    if auth.exists():
        auth.unlink()
    print(f"new file: {from_audio}")
    print(f"new file: {dest}")


if __name__ == "__main__":
    if (os.environ.get("DEMO_ONE_TAKE") or "").strip():
        asyncio.run(record_one_take())
    elif (os.environ.get("DEMO_REMUX") or "").strip():
        parts = [OUT / f"{p['name']}.mp4" for p in PARTS if (OUT / f"{p['name']}.mp4").exists()]
        mux_combined(parts, OUT / "AFV-demo-all-parts.mp4")
    else:
        asyncio.run(main())
