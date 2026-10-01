"""Run from repo root: .venv/bin/python web/tests/generate_fixtures.py.

Regenerate small numerical reference cases when the shared model changes.
"""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from dataclasses import asdict
import numpy as np
from cvav.feedback import Feedback, Parameters

width, height = 9, 7
rng = np.random.default_rng(73)
frame = rng.integers(0, 256, (height, width, 3), dtype=np.uint8)
initial = rng.uniform(-0.7, 0.7, (height, width, 3)).astype(np.float32)
cases = []
for name, color, params in [
    ('identity', True, Parameters(persistence=0, gain=1, diffusion=0, zoom=1, angle=0, injection=0)),
    ('camera', True, Parameters(persistence=0, gain=0, diffusion=0, injection=1)),
    ('cycle', True, Parameters(persistence=0, gain=1, diffusion=0, zoom=1, angle=0, injection=0, color_cycle=1)),
    ('saturation', True, Parameters(persistence=0, gain=1, diffusion=0, zoom=1, angle=0, injection=0, saturation=0)),
    ('blur', True, Parameters(persistence=0, gain=0, diffusion=1, sigma=1.2, injection=0)),
    ('transform', True, Parameters(persistence=.1, gain=.8, diffusion=.1, zoom=1.12, angle=17, injection=.2, color_cycle=-.3, saturation=1.3)),
    ('mono', False, Parameters(persistence=0, gain=0, diffusion=0, injection=1)),
]:
    model = Feedback(width, height, color=color)
    if color:
        model.state = initial.copy()
        model.step(frame, params)
        # Convert OpenCV's top-down BGR to top-down RGB for the browser.
        state = initial[..., ::-1].tolist()
        expected = model.state[..., ::-1].tolist()
    else:
        import cv2
        state = np.zeros((height, width, 3)).tolist()
        model.step(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), params)
        expected = np.repeat(model.state[...,None], 3, axis=2).tolist()
    cases.append(dict(name=name, color=color, params=asdict(params), initial=state, expected=expected))
Path('web/tests/fixtures.json').write_text(json.dumps(dict(width=width,height=height,frame=frame[...,::-1].tolist(),cases=cases)))
