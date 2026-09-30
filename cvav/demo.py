"""Experiments 001/002: monochrome and color webcam-driven video feedback with labeled interactive sliders."""
import argparse
import os
from pathlib import Path
import sys
import time

import cv2
import numpy as np

from .feedback import Feedback, Parameters

WINDOW = "cvav / 001 / source | feedback"
CONTROLS = "cvav / parameters"
# Internal scale, default position, maximum; conversions live in ControlPanel.
SLIDERS = [("Persistence %", 15, 100), ("Gain %", 85, 200),
           ("Diffusion %", 5, 100), ("Blur x0.1 px", 12, 100),
           ("Zoom (500=1.0)", 515, 1000), ("Angle (180=0)", 182, 360),
           ("Camera input %", 12, 100), ("Brightness (100=0)", 100, 200),
           ("Invert", 0, 1)]


class ControlPanel:
    """Draw labels ourselves so they stay visible across OpenCV GUI backends."""

    width = 600
    row_height = 76
    left, right = 24, 576
    labels = ["Persistence", "Feedback gain", "Spatial diffusion", "Blur",
              "Zoom", "Rotation", "Camera input", "Brightness", "Invert luminance"]
    hints = ["How much of the previous image remains", "Strength of the transformed feedback",
             "Contribution from neighboring pixels", "Width of spatial smoothing",
             "Magnification per iteration", "Rotation per iteration",
             "Amount of live video added", "Shift toward dark or light",
             "Swap light and dark in the feedback"]

    def __init__(self, color=False):
        self.color = color
        self.sliders = list(SLIDERS)
        self.labels = list(type(self).labels)
        self.hints = list(type(self).hints)
        if color:
            self.row_height = 64
            self.sliders += [("Color cycle", 112, 200), ("Saturation", 100, 200)]
            self.labels += ["Color cycle", "Feedback saturation"]
            self.hints += ["Positive: red to green to blue; negative: reverse",
                           "0: grayscale, 1: original color, 2: vivid"]
        self.values = [default for _, default, _ in self.sliders]
        self.dragging = None

    def parameters(self):
        v = self.values
        return Parameters(v[0]/100, v[1]/100, v[2]/100, v[3]/10,
                          0.5 + v[4]/1000, v[5]-180, v[6]/100,
                          (v[7]-100)/100, bool(v[8]),
                          (v[9]-100)/100 if self.color else 0.0,
                          v[10]/100 if self.color else 1.0)

    def reset(self):
        self.values = [default for _, default, _ in self.sliders]

    def mouse(self, event, x, y, flags, userdata):
        if event == cv2.EVENT_LBUTTONDOWN:
            row = y // self.row_height
            if 0 <= row < len(self.sliders):
                self.dragging = row
        if self.dragging is not None and event in (cv2.EVENT_LBUTTONDOWN, cv2.EVENT_MOUSEMOVE, cv2.EVENT_LBUTTONUP):
            maximum = self.sliders[self.dragging][2]
            fraction = np.clip((x-self.left)/(self.right-self.left), 0, 1)
            self.values[self.dragging] = int(round(float(fraction)*maximum))
        if event == cv2.EVENT_LBUTTONUP:
            self.dragging = None

    def draw(self):
        canvas = np.full((self.row_height*len(self.sliders), self.width, 3), (29, 25, 23), np.uint8)
        p = self.parameters()
        values = [f"{p.persistence:.0%}", f"{p.gain:.0%}", f"{p.diffusion:.0%}",
                  f"{p.sigma:.1f} px", f"{p.zoom:.3f}x", f"{p.angle:+.0f} deg",
                  f"{p.injection:.0%}", f"{p.brightness:+.2f}", "ON" if p.invert else "OFF"]
        if self.color:
            values += [f"{p.color_cycle:+.0%}", f"{p.saturation:.2f}x"]
        for i, (label, hint, value) in enumerate(zip(self.labels, self.hints, values)):
            top = i*self.row_height
            cv2.putText(canvas, label, (24, top+23), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1, cv2.LINE_AA)
            cv2.putText(canvas, value, (465, top+23), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (120, 220, 170), 1, cv2.LINE_AA)
            cv2.putText(canvas, hint, (24, top+43), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (170, 165, 160), 1, cv2.LINE_AA)
            y = top+59
            x = round(self.left + (self.right-self.left)*self.values[i]/self.sliders[i][2])
            cv2.line(canvas, (self.left, y), (self.right, y), (80, 75, 70), 3)
            cv2.line(canvas, (self.left, y), (x, y), (120, 220, 170), 3)
            cv2.circle(canvas, (x, y), 6, (220, 250, 235), -1, cv2.LINE_AA)
        return canvas


def synthetic(width, height, tick, color=False):
    frame = np.full((height, width), 100, dtype=np.uint8)
    center = (int(width * (0.5 + 0.25*np.cos(tick/37))),
              int(height * (0.5 + 0.25*np.sin(tick/53))))
    cv2.circle(frame, center, max(2, min(width, height)//12), 235, -1)
    cv2.rectangle(frame, (width//5, height//4), (width//3, height//2), 20, -1)
    if color:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        cv2.circle(frame, center, max(2, min(width, height)//12), (50, 110, 245), -1)
        cv2.rectangle(frame, (width//5, height//4), (width//3, height//2), (220, 170, 30), -1)
        cv2.circle(frame, (width*3//4, height*2//3), max(2, min(width, height)//10), (90, 220, 80), 3)
    return frame


def positive(value):
    n = int(value)
    if n <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return n


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", choices=("mono", "color"), default="mono",
                        help="001 monochrome (default) or 002 color feedback")
    parser.add_argument("--camera", default="0", help="camera index or device path, e.g. /dev/video2")
    parser.add_argument("--synthetic", action="store_true", help="use a moving test pattern")
    parser.add_argument("--width", type=positive, default=640)
    parser.add_argument("--height", type=positive, default=480)
    parser.add_argument("--fps", type=positive, default=30, help="target iterations per second")
    parser.add_argument("--headless", action="store_true", help="run without windows (requires --frames)")
    parser.add_argument("--frames", type=positive, help="stop after this many iterations")
    parser.add_argument("--output", type=Path, help="save the final source/feedback image")
    args = parser.parse_args(argv)
    if args.headless and args.frames is None:
        parser.error("--headless requires --frames")
    if not args.headless and sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        parser.error("No desktop display found. Run on your desktop or use --synthetic --headless --frames 120.")
    color = args.experiment == "color"
    window = "cvav / 002 color / source | feedback" if color else WINDOW
    cap = None
    try:
        if not args.synthetic:
            device = int(args.camera) if args.camera.isdecimal() else args.camera
            cap = cv2.VideoCapture(device)
            if not cap.isOpened():
                raise RuntimeError(f"Cannot open camera {args.camera}. Try --camera /dev/video2 or --synthetic.")
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
            cap.set(cv2.CAP_PROP_FPS, args.fps)
        model = Feedback(args.width, args.height, color=color)
        controls = ControlPanel(color=color)
        if not args.headless:
            cv2.namedWindow(window, cv2.WINDOW_NORMAL)
            cv2.namedWindow(CONTROLS, cv2.WINDOW_AUTOSIZE)
            cv2.resizeWindow(window, min(args.width*2, 1280), args.height)
            cv2.setMouseCallback(CONTROLS, controls.mouse)
            print("q/Esc: quit | r: clear | space: pause | s: snapshot | d: default parameters")
        tick, paused = 0, False
        panel = None
        while args.frames is None or tick < args.frames:
            start = time.monotonic()
            if not paused:
                if cap is None:
                    frame = synthetic(args.width, args.height, tick, color=color)
                else:
                    ok, raw = cap.read()
                    if not ok:
                        raise RuntimeError("Camera stopped delivering frames; check its connection.")
                    source = raw if color else cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
                    frame = cv2.resize(source, (args.width, args.height))
                p = controls.parameters()
                result = model.step(frame, p)
                panel = np.concatenate((frame, result), axis=1)
                tick += 1
            if args.headless:
                continue
            cv2.imshow(window, panel)
            cv2.imshow(CONTROLS, controls.draw())
            delay = max(1, round(1000 * (1/args.fps - (time.monotonic()-start))))
            key = cv2.waitKey(delay) & 0xff
            if key in (27, ord("q")):
                break
            if any(cv2.getWindowProperty(w, cv2.WND_PROP_VISIBLE) < 1 for w in (window, CONTROLS)):
                break
            if key == ord("r"):
                model.reset()
            elif key == ord(" "):
                paused = not paused
            elif key == ord("d"):
                controls.reset()
            elif key == ord("s"):
                save_image(Path("captures") / f"feedback-{time.time_ns()}.png", panel)
        if args.output and panel is not None:
            save_image(args.output, panel)
        return 0
    except (RuntimeError, cv2.error, OSError) as exc:
        print(f"cvav: {exc}", file=sys.stderr)
        return 1
    finally:
        if cap is not None:
            cap.release()
        if not args.headless:
            cv2.destroyAllWindows()


def save_image(path, panel):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), panel):
        raise RuntimeError(f"Could not save {path}")
    print(f"Saved {path}")
