"""Generate demo VO MP3s via Edge neural TTS (Jenny). Uses Bayer VDI HTTP proxy."""
from __future__ import annotations

import asyncio
import ssl
from pathlib import Path

import edge_tts.communicate as comm

# Corp proxy MITM: Edge TTS hard-codes certifi SSL, which lacks the local CA.
comm._SSL_CTX = ssl._create_unverified_context()

from edge_tts import Communicate

PROXY = "http://10.185.190.10:8080"
VOICE = "en-US-JennyNeural"
RATE = "-5%"
DIR = Path(__file__).resolve().parent

JOBS = [
    ("vo-part1.txt", "part-1-intro.mp3"),
    ("vo-part2.txt", "part-2-configure.mp3"),
    ("vo-part3.txt", "part-3-execute.mp3"),
]


async def render(src: Path, dest: Path) -> None:
    text = src.read_text(encoding="utf-8").strip()
    communicate = Communicate(text, VOICE, rate=RATE, proxy=PROXY)
    with dest.open("wb") as out:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                out.write(chunk["data"])
    print(f"wrote {dest.name} ({dest.stat().st_size} bytes)")


async def main() -> None:
    for src_name, dest_name in JOBS:
        await render(DIR / src_name, DIR / dest_name)


if __name__ == "__main__":
    asyncio.run(main())
