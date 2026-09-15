"""Record 3 demo walkthrough videos and mux the VO MP3s onto them."""
from __future__ import annotations

import asyncio
import subprocess
import time
from pathlib import Path

from imageio_ffmpeg import get_ffmpeg_exe
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
AUDIO = ROOT.parent / "demo-audio"
HTML = ROOT / "walkthrough.html"
OUT = ROOT

PARTS = [
    {
        "name": "part-1-intro",
        "audio": AUDIO / "part-1-intro.mp3",
        "seconds": 119,
        "start": "dash",
    },
    {
        "name": "part-2-configure",
        "audio": AUDIO / "part-2-configure.mp3",
        "seconds": 123,
        "start": "screens",
    },
    {
        "name": "part-3-execute",
        "audio": AUDIO / "part-3-execute.mp3",
        "seconds": 122,
        "start": "screens",
    },
]

SCRIPT = """
async (fn, ...args) => window.demo[fn](...args)
"""


async def js(page, fn, *args):
    await page.evaluate(f"window.demo.{fn}(...arguments[0])", list(args))


async def wait_until(t0: float, t: float):
    delay = t - (time.monotonic() - t0)
    if delay > 0:
        await asyncio.sleep(delay)


async def part1(page, t0):
    await wait_until(t0, 0)
    await js(page, "show", "dash")
    await wait_until(t0, 44)
    await js(page, "navHot", "dash")
    await wait_until(t0, 48)
    await js(page, "navHot", "screens")
    await wait_until(t0, 52)
    await js(page, "navHot", "tests")
    await wait_until(t0, 56)
    await js(page, "navHot", "runs")
    await wait_until(t0, 60)
    await js(page, "navHot", "sql")
    await wait_until(t0, 64)
    await js(page, "navHot", "settings")
    await wait_until(t0, 68)
    await js(page, "navHot", "")
    await js(page, "hl", "#box-total")
    await wait_until(t0, 74)
    await js(page, "hl", "#box-ran")
    await wait_until(t0, 80)
    await js(page, "hl", "#box-pass")
    await wait_until(t0, 86)
    await js(page, "hl", "#box-fail")
    await wait_until(t0, 94)
    await js(page, "hl", "#screen-rows")
    await wait_until(t0, 102)
    await js(page, "hl", None, False)
    await js(page, "show", "screens")
    await wait_until(t0, 110)
    await js(page, "show", "sql")
    await wait_until(t0, 114)
    await js(page, "show", "settings")
    await wait_until(t0, 117)
    await js(page, "show", "dash")


async def part2(page, t0):
    await js(page, "show", "screens")
    await wait_until(t0, 6)
    await js(page, "openDlg")
    await wait_until(t0, 12)
    await js(page, "typeInto", "f-name", "Overview")
    await wait_until(t0, 18)
    await js(page, "typeInto", "f-url", "https://athena.example/overview")
    await wait_until(t0, 28)
    await js(page, "typeInto", "f-ref", "https://athena-preprod.example/overview")
    await wait_until(t0, 42)
    await js(page, "closeDlg")
    await js(page, "show", "screen")
    await wait_until(t0, 52)
    await js(page, "show", "case")
    await wait_until(t0, 88)
    await page.locator("#btn-gen").evaluate("e => e.classList.add('hl')")
    await js(page, "setCode", "// Generating script… validation will run after generate")
    await wait_until(t0, 96)
    await js(
        page,
        "setCode",
        """export default async ({ page }) => {
  await page.goto('https://athena.example/overview');
  // login with saved credentials
  await waitForLoadingToFinish(page);
  await selectByLabel(page, 'Area', 'AB - Central');
  await selectByLabel(page, 'Region', 'St. Louis');
  return extractKPI(page, ['Sales', 'Call Activity', 'Claims']);
};""",
    )
    await wait_until(t0, 114)
    await js(page, "hl", None, False)


async def part3(page, t0):
    await js(page, "show", "screens")
    await wait_until(t0, 8)
    await js(page, "hl", "#btn-run-report")
    await wait_until(t0, 14)
    await js(page, "hl", "#btn-run-suite")
    await wait_until(t0, 20)
    await js(page, "show", "case")
    await js(page, "hl", "#btn-headless")
    await wait_until(t0, 28)
    await js(page, "hl", None, False)
    await js(page, "show", "screens")
    await js(page, "toast", True)
    await wait_until(t0, 36)
    await js(page, "toast", False)
    await js(page, "show", "run")
    await wait_until(t0, 52)
    await js(page, "openCase", True)
    await wait_until(t0, 72)
    await js(page, "show", "runs")
    await wait_until(t0, 88)
    await js(page, "show", "dash")
    await js(page, "hl", "#box-total")
    await wait_until(t0, 94)
    await js(page, "hl", "#box-ran")
    await wait_until(t0, 100)
    await js(page, "hl", "#box-pass")
    await wait_until(t0, 106)
    await js(page, "hl", "#box-fail")
    await wait_until(t0, 112)
    await js(page, "hl", None, False)
    await js(page, "setRunDone")
    await js(page, "show", "dash")


ACTIONS = {"part-1-intro": part1, "part-2-configure": part2, "part-3-execute": part3}


def mux(video: Path, audio: Path, dest: Path) -> None:
    ff = get_ffmpeg_exe()
    cmd = [
        ff,
        "-y",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-movflags",
        "+faststart",
        str(dest),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"wrote {dest} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")


async def record_part(p, part: dict) -> Path:
    raw_dir = OUT / "_raw"
    raw_dir.mkdir(exist_ok=True)
    context = await p.chromium.launch_persistent_context(
        str(raw_dir / f"profile-{part['name']}"),
        channel="chrome",
        headless=True,
        viewport={"width": 1440, "height": 900},
        record_video_dir=str(raw_dir / part["name"]),
        record_video_size={"width": 1440, "height": 900},
        args=["--disable-infobars", "--no-first-run"],
    )
    page = context.pages[0] if context.pages else await context.new_page()
    await page.goto(HTML.as_uri())
    await page.wait_for_selector(".app")
    await js(page, "show", part["start"])
    t0 = time.monotonic()
    await ACTIONS[part["name"]](page, t0)
    leftover = part["seconds"] + 0.6 - (time.monotonic() - t0)
    if leftover > 0:
        await asyncio.sleep(leftover)
    video = await page.video.path()
    await context.close()
    return Path(video)


async def main() -> None:
    if not HTML.exists():
        raise SystemExit(f"missing {HTML}")
    async with async_playwright() as p:
        mp4s = []
        for part in PARTS:
            print(f"recording {part['name']}…")
            webm = await record_part(p, part)
            dest = OUT / f"{part['name']}.mp4"
            mux(webm, part["audio"], dest)
            mp4s.append(dest)

    ff = get_ffmpeg_exe()
    lst = OUT / "_concat.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in mp4s), encoding="utf-8")
    combined = OUT / "AFV-demo-all-parts.mp4"
    subprocess.run(
        [ff, "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(combined)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"wrote {combined} ({combined.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    asyncio.run(main())
