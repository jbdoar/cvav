import unittest
from dataclasses import replace
from tempfile import TemporaryDirectory
from pathlib import Path

import cv2
import numpy as np

from cvav.feedback import Feedback, Parameters
from cvav.demo import ControlPanel, main


class ColorTests(unittest.TestCase):
    def test_camera_color_roundtrip(self):
        frame = np.random.default_rng(7).integers(0, 256, (12, 16, 3), dtype=np.uint8)
        model = Feedback(16, 12, color=True)
        result = model.step(frame, Parameters(persistence=0, diffusion=0, gain=0, injection=1))
        np.testing.assert_array_equal(result, frame)

    def test_neutral_coupling_matches_three_mono_models(self):
        frame = np.random.default_rng(8).integers(0, 256, (12, 16, 3), dtype=np.uint8)
        color = Feedback(16, 12, color=True)
        mono = [Feedback(16, 12) for _ in range(3)]
        for _ in range(4):
            result = color.step(frame, Parameters())
            expected = np.stack([m.step(frame[..., i], Parameters()) for i, m in enumerate(mono)], axis=2)
            np.testing.assert_allclose(result.astype(float), expected, atol=1)

    def test_cycle_direction_and_neutral_gray(self):
        model = Feedback(5, 5, color=True)
        frame = np.zeros((5, 5, 3), np.uint8)
        p = Parameters(persistence=0, diffusion=0, gain=1, injection=0, zoom=1, angle=0)
        for cycle, expected in [(1, [-1, 1, -1]), (-1, [1, -1, -1])]:
            model.state[:] = [-1, -1, 1]  # red in biased BGR
            model.step(frame, replace(p, color_cycle=cycle))
            np.testing.assert_allclose(model.state[2, 2], expected)
        model.state.fill(0.25)
        model.step(frame, replace(p, color_cycle=0.4, saturation=2))
        np.testing.assert_allclose(model.state, 0.25)

    def test_zero_saturation_and_bounds(self):
        model = Feedback(5, 5, color=True)
        model.state[:] = [-0.5, 0.2, 0.9]
        frame = np.zeros((5, 5, 3), np.uint8)
        p = Parameters(persistence=0, diffusion=0, gain=1, injection=0, zoom=1, angle=0, saturation=0)
        model.step(frame, p)
        np.testing.assert_allclose(model.state[..., 0], model.state[..., 2])
        for _ in range(30):
            model.step(frame, replace(p, gain=2, saturation=2, color_cycle=-0.5, injection=1))
        self.assertTrue(np.isfinite(model.state).all())
        self.assertLessEqual(abs(model.state).max(), 1)

    def test_color_controls_and_headless_output(self):
        controls = ControlPanel(color=True)
        self.assertEqual(controls.parameters().color_cycle, 0.12)
        controls.mouse(cv2.EVENT_LBUTTONDOWN, controls.right, 9*controls.row_height+59, 0, None)
        controls.mouse(cv2.EVENT_LBUTTONUP, controls.right, 9*controls.row_height+59, 0, None)
        self.assertEqual(controls.parameters().color_cycle, 1)
        controls.reset()
        self.assertEqual(controls.parameters().color_cycle, 0.12)
        with TemporaryDirectory() as folder:
            path = Path(folder)/'color.png'
            self.assertEqual(main(['--experiment', 'color', '--synthetic', '--headless',
                                   '--frames', '4', '--width', '64', '--height', '48',
                                   '--output', str(path)]), 0)
            image = cv2.imread(str(path))
            self.assertEqual(image.shape, (48, 128, 3))
            self.assertTrue(np.any(image[..., 0] != image[..., 2]))
