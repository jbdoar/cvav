import unittest

import numpy as np

from cvav.feedback import Feedback, Parameters
from cvav.demo import main


class FeedbackTests(unittest.TestCase):
    def test_camera_only_roundtrip(self):
        image = np.arange(256, dtype=np.uint8).reshape(16, 16)
        model = Feedback(16, 16)
        result = model.step(image, Parameters(persistence=0, diffusion=0, gain=0, injection=1))
        np.testing.assert_array_equal(result, image)

    def test_identity_feedback_and_inversion(self):
        model = Feedback(9, 9)
        original = np.linspace(-1, 1, 81, dtype=np.float32).reshape(9, 9)
        for invert in (False, True):
            model.state = original.copy()
            model.step(np.zeros((9, 9), np.uint8), Parameters(
                persistence=0, diffusion=0, gain=1, injection=0, zoom=1, angle=0, invert=invert))
            np.testing.assert_allclose(model.state, -original if invert else original, atol=1e-6)

    def test_zoom_expands_impulse_from_center(self):
        model = Feedback(21, 21)
        model.state[10, 12] = 1
        model.step(np.zeros((21, 21), np.uint8), Parameters(
            persistence=0, diffusion=0, gain=1, injection=0, zoom=2, angle=0))
        self.assertEqual(np.unravel_index(model.state.argmax(), model.state.shape), (10, 14))

    def test_diffusion_spreads_and_preserves_interior_mass(self):
        model = Feedback(21, 21)
        model.state[10, 10] = 1
        model.step(np.zeros((21, 21), np.uint8), Parameters(
            persistence=0, diffusion=1, sigma=1, gain=0, injection=0))
        self.assertGreater(model.state[10, 11], 0)
        self.assertLess(model.state[10, 10], 1)
        self.assertAlmostEqual(float(model.state.sum()), 1, places=5)

    def test_saturation_and_reset(self):
        model = Feedback(12, 12)
        frame = np.full((12, 12), 255, np.uint8)
        for _ in range(50):
            model.step(frame, Parameters(gain=2, persistence=1, injection=1))
        self.assertTrue(np.isfinite(model.state).all())
        self.assertLessEqual(model.state.max(), 1)
        self.assertGreaterEqual(model.state.min(), -1)
        model.reset()
        self.assertFalse(model.state.any())

    def test_headless_demo(self):
        self.assertEqual(main(["--synthetic", "--headless", "--frames", "4", "--width", "64", "--height", "48"]), 0)


if __name__ == "__main__":
    unittest.main()
