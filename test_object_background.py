import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

import object_background as cutouts


class _Session:
    def __init__(self, mask):
        self.mask = mask
        self.input = None

    def get_inputs(self):
        return [SimpleNamespace(name='image')]

    def get_outputs(self):
        return [SimpleNamespace(name='mask')]

    def run(self, outputs, inputs):
        self.input = inputs['image']
        return [self.mask[None, None]]


class ObjectBackgroundTests(unittest.TestCase):
    def test_returns_transparent_trimmed_object_and_preserves_color_and_original(self):
        image = Image.new('RGB', (320, 320), '#e4e8ed')
        ImageDraw.Draw(image).rectangle((100, 70, 219, 259), fill='#c02e30')
        original = image.tobytes()
        mask = np.zeros((320, 320), dtype=np.float32)
        mask[70:260, 100:220] = 1
        session = _Session(mask)
        with patch.object(cutouts, 'warmup', return_value=session):
            result = cutouts.remove_background(image)
        self.assertEqual(result.mode, 'RGBA')
        self.assertLess(result.width, image.width)
        self.assertLess(result.height, image.height)
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((result.width // 2, result.height // 2)), (192, 46, 48, 255))
        self.assertEqual(image.tobytes(), original)
        self.assertEqual(session.input.shape, (1, 3, 320, 320))
        self.assertEqual(session.input.dtype, np.float32)
        self.assertTrue(np.isfinite(session.input).all())

    def test_existing_transparency_is_preserved(self):
        image = Image.new('RGBA', (320, 320), (240, 240, 240, 255))
        ImageDraw.Draw(image).rectangle((80, 80, 239, 239), fill=(150, 80, 20, 128))
        mask = np.zeros((320, 320), dtype=np.float32)
        mask[80:240, 80:240] = 1
        with patch.object(cutouts, 'warmup', return_value=_Session(mask)):
            result = cutouts.remove_background(image)
        self.assertEqual(result.getpixel((result.width // 2, result.height // 2))[3], 128)

    def test_empty_uniform_nonfinite_or_whole_frame_masks_fail_clearly(self):
        masks = [np.zeros((320, 320)), np.ones((320, 320)), np.full((320, 320), np.nan)]
        full = np.ones((320, 320)); full[0, 0] = 0
        masks.append(full)
        image = Image.new('RGB', (320, 320), 'white')
        ImageDraw.Draw(image).rectangle((80, 80, 239, 239), fill='red')
        for mask in masks:
            with self.subTest(), patch.object(cutouts, 'warmup', return_value=_Session(mask)):
                with self.assertRaises(cutouts.BackgroundRemovalError):
                    cutouts.remove_background(image)

    def test_uniform_frames_are_rejected_before_inference(self):
        for color in ['white', 'black', '#888888']:
            with self.subTest(color=color), patch.object(cutouts, 'warmup') as load:
                with self.assertRaises(cutouts.BackgroundRemovalError):
                    cutouts.remove_background(Image.new('RGB', (320, 320), color))
                load.assert_not_called()

    def test_invalid_source_is_rejected(self):
        for image in [None, Image.new('RGB', (4, 4))]:
            with self.assertRaises(cutouts.BackgroundRemovalError):
                cutouts.remove_background(image)

    def test_missing_model_is_reported_without_initialization_or_download(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(cutouts, 'MODEL_PATH', Path(temp) / 'missing.onnx'), patch.object(cutouts, '_session', None):
            self.assertFalse(cutouts.get_model_status()['ready'])
            with self.assertRaises(cutouts.BackgroundModelUnavailable):
                cutouts.warmup()

    def test_modified_model_is_rejected_before_native_initialization(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.onnx'; path.write_bytes(b'not a model')
            with patch.object(cutouts, 'MODEL_PATH', path), patch.object(cutouts, '_session', None):
                with self.assertRaises(cutouts.BackgroundModelUnavailable):
                    cutouts.warmup()

    def test_real_bundled_model_segments_a_simple_product(self):
        image = Image.new('RGB', (400, 400), '#eeeeea')
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((142, 115, 258, 335), radius=24, fill='#277755')
        draw.rounded_rectangle((165, 63, 235, 133), radius=8, fill='#194f39')
        draw.rectangle((148, 190, 252, 260), fill='#e3daba')
        result = cutouts.remove_background(image)
        self.assertEqual(result.mode, 'RGBA')
        self.assertLess(result.width, image.width)
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertGreater(result.getpixel((result.width // 2, result.height // 2))[3], 200)
        self.assertTrue(cutouts.get_model_status()['ready'])


if __name__ == '__main__':
    unittest.main()
