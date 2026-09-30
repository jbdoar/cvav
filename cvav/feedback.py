"""A bounded, camera-driven discretization of Crutchfield's equation (3)."""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Parameters:
    persistence: float = 0.15
    gain: float = 0.85
    diffusion: float = 0.05
    sigma: float = 1.2
    zoom: float = 1.015
    angle: float = 2.0
    injection: float = 0.12
    brightness: float = 0.0
    invert: bool = False
    color_cycle: float = 0.0
    saturation: float = 1.0


class Feedback:
    def __init__(self, width: int, height: int, *, color: bool = False):
        shape = (height, width, 3) if color else (height, width)
        self.state = np.zeros(shape, dtype=np.float32)

    def reset(self):
        """Clear to neutral gray (zero in bias-intensity coordinates)."""
        self.state.fill(0)

    def step(self, frame: np.ndarray, p: Parameters) -> np.ndarray:
        if not np.isfinite(list(vars(p).values())).all() or p.zoom <= 0 or p.sigma < 0 or abs(p.color_cycle) > 1 or p.saturation < 0:
            raise ValueError("Parameters must be finite; zoom > 0, sigma/saturation >= 0, and color cycle in [-1, 1]")
        height, width = self.state.shape[:2]
        if frame.shape != self.state.shape:
            raise ValueError("Expected a frame matching the feedback state dimensions and channels")
        incoming = frame.astype(np.float32) / 127.5 - 1.0
        # Forward image transform: zoom > 1 visibly enlarges the image.
        matrix = cv2.getRotationMatrix2D(((width - 1) / 2, (height - 1) / 2), p.angle, p.zoom)
        warped = cv2.warpAffine(self.state, matrix, (width, height),
                                flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                borderValue=0)
        if self.state.ndim == 3:
            # BGR storage: positive cycling sends red -> green -> blue -> red.
            amount = abs(p.color_cycle)
            shifted = np.roll(warped, -1 if p.color_cycle >= 0 else 1, axis=2)
            warped = (1-amount)*warped + amount*shifted
            # Saturation operates on feedback only; the source remains untouched.
            luma = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)[..., None]
            warped = luma + p.saturation*(warped-luma)
        smooth = (cv2.GaussianBlur(self.state, (0, 0), p.sigma,
                                  borderType=cv2.BORDER_REFLECT_101)
                  if p.sigma > 0 else self.state)
        sign = -1 if p.invert else 1
        result = (p.persistence * self.state + p.diffusion * smooth
                  + sign * p.gain * warped + p.injection * incoming + p.brightness)
        self.state = np.clip(result, -1, 1).astype(np.float32)
        return np.rint((self.state + 1) * 127.5).astype(np.uint8)
