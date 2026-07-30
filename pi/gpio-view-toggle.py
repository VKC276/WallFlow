#!/usr/bin/env python3
"""WallFlow hallskärm: knapp på GPIO byter vy i display.html.

Lyssnar på en IO-pin (standard BCM 17). Vid tryck skickas Space till
systemet, vilket Chromium i kiosk-läge plockar upp — display.html byter då vy.

Koppling (aktiv låg):
  GPIO-pin ── knapp ── GND
  (internt pull-up i skriptet)

Exempel:
  python3 gpio-view-toggle.py
  python3 gpio-view-toggle.py --pin 27
  WALLFLOW_GPIO_PIN=17 python3 gpio-view-toggle.py
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time


DEFAULT_PIN = 17
DEBOUNCE_S = 0.18


def send_space_uinput_() -> bool:
    try:
        from evdev import UInput, ecodes  # type: ignore
    except Exception:
        return False
    try:
        with UInput({ecodes.EV_KEY: [ecodes.KEY_SPACE]}) as ui:
            ui.write(ecodes.EV_KEY, ecodes.KEY_SPACE, 1)
            ui.syn()
            ui.write(ecodes.EV_KEY, ecodes.KEY_SPACE, 0)
            ui.syn()
        return True
    except Exception as err:
        print(f"uinput misslyckades: {err}", file=sys.stderr)
        return False


def send_space_tool_(cmd: list[str]) -> bool:
    try:
        subprocess.run(cmd, check=True, timeout=2)
        return True
    except Exception:
        return False


def send_view_toggle_() -> None:
    if send_space_uinput_():
        return
    # Fallback för X11 / Wayland-hjälpverktyg
    for cmd in (
        ["ydotool", "key", "57:1", "57:0"],  # KEY_SPACE
        ["wtype", "-k", "space"],
        ["xdotool", "key", "space"],
    ):
        if send_space_tool_(cmd):
            return
    print(
        "Kunde inte skicka tangent. Installera t.ex. python3-evdev "
        "(rekommenderas) eller xdotool/ydotool/wtype.",
        file=sys.stderr,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="GPIO-knapp byter WallFlow-displayvy")
    parser.add_argument(
        "--pin",
        type=int,
        default=int(os.environ.get("WALLFLOW_GPIO_PIN", DEFAULT_PIN)),
        help=f"BCM GPIO-pin (standard {DEFAULT_PIN})",
    )
    parser.add_argument(
        "--active-high",
        action="store_true",
        help="Knapp kopplad till 3V3 i stället för GND (pull-down)",
    )
    args = parser.parse_args()

    try:
        from gpiozero import Button  # type: ignore
    except Exception:
        print(
            "gpiozero saknas. Installera med: sudo apt install python3-gpiozero",
            file=sys.stderr,
        )
        return 1

    pull_up = not args.active_high
    btn = Button(args.pin, pull_up=pull_up, bounce_time=DEBOUNCE_S)
    print(
        f"WallFlow GPIO-vybyte: BCM {args.pin} "
        f"({'pull-up, knapp→GND' if pull_up else 'pull-down, knapp→3V3')}. "
        "Tryck knappen för att byta vy (Space)."
    )

    last = 0.0

    def on_press() -> None:
        nonlocal last
        now = time.monotonic()
        if now - last < DEBOUNCE_S:
            return
        last = now
        print("Byte vy…")
        send_view_toggle_()

    btn.when_pressed = on_press
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nAvslutar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
