import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageEnhance, ImageFilter
import zxingcpp

import barcode_decoder as decoder


class BarcodeDecoderTests(unittest.TestCase):
    CODE = '7898446731458'

    def barcode(self, code=CODE, scale=3, quiet=True):
        symbol = zxingcpp.create_barcode(code, zxingcpp.BarcodeFormat.EAN13)
        return Image.fromarray(zxingcpp.write_barcode_to_image(symbol, scale=scale, add_quiet_zones=quiet))

    def test_normal_rotated_low_contrast_and_tightly_cropped(self):
        normal = self.barcode()
        for image in [normal, normal.rotate(90, expand=True), ImageEnhance.Contrast(normal).enhance(.3), self.barcode(quiet=False)]:
            with self.subTest(size=image.size):
                self.assertEqual(decoder.decode_barcode(image)['code'], self.CODE)

    @unittest.skipIf(decoder._zbar_decode is None, 'ZBar native library is not installed')
    def test_independent_reader_recovers_mild_defocus(self):
        image = self.barcode()
        image = image.resize((int(image.width * .7), int(image.height * .7))).filter(ImageFilter.GaussianBlur(1))
        with patch.object(decoder, '_zbar_decode', None):
            self.assertIsNone(decoder.decode_barcode(image))
        self.assertEqual(decoder.decode_barcode(image)['code'], self.CODE)

    def test_ambiguous_frame_is_rejected_before_band_retries(self):
        first, second = self.barcode(), self.barcode('5901234123457')
        combined = Image.new('RGB', (max(first.width, second.width), first.height + second.height + 40), 'white')
        combined.paste(first, (0, 0)); combined.paste(second, (0, first.height + 40))
        with patch.object(decoder, '_bands', side_effect=AssertionError('Ambiguous originals must not be cropped')):
            self.assertIsNone(decoder.decode_barcode(combined, thorough=True))

    def test_blank_frame_does_not_create_a_code(self):
        image = Image.new('RGB', (320, 240), 'white')
        self.assertIsNone(decoder.decode_barcode(image, thorough=True))

    def test_source_image_is_not_resized_or_modified(self):
        image = self.barcode().resize((2800, 2000))
        before = image.tobytes()
        decoder.decode_barcode(image)
        self.assertEqual(image.size, (2800, 2000))
        self.assertEqual(image.tobytes(), before)

    def test_reading_still_works_when_optional_reader_is_missing(self):
        with patch.object(decoder, '_zbar_decode', None):
            self.assertEqual(decoder.decode_barcode(self.barcode())['code'], self.CODE)

    def test_curved_defocused_real_sample_never_invents_digits(self):
        path = Path(__file__).parent / 'tests' / 'fixtures' / 'curved_barcode.jpg'
        with Image.open(path) as image:
            for thorough in (False, True):
                result = decoder.decode_barcode(image, thorough=thorough)
                self.assertTrue(result is None or result['code'] == self.CODE, result)


if __name__ == '__main__':
    unittest.main()
