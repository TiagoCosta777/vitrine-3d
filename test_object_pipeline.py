import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

import app as scanner


class ObjectPipelineTests(unittest.TestCase):
    def test_real_model_saves_six_transparent_views_without_a_barcode(self):
        image = Image.new('RGB', (400, 400), '#eeeeea')
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((142, 115, 258, 335), radius=24, fill='#277755')
        draw.rounded_rectangle((165, 63, 235, 133), radius=8, fill='#194f39')
        draw.rectangle((148, 190, 252, 260), fill='#e3daba')
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            with patch.object(scanner, 'DB_PATH', folder / 'pipeline.db'), patch.object(scanner, 'UPLOAD_DIR', folder):
                scanner.init_db()
                data = {'name': 'Frasco de teste'}
                for face in ['front', 'right', 'back', 'left', 'top', 'bottom']:
                    file = io.BytesIO()
                    image.save(file, format='JPEG', quality=95)
                    file.seek(0)
                    data[face] = (file, face + '.jpg')
                response = scanner.app.test_client().post('/api/object-scan', data=data)
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.json['barcode'], '')
                self.assertTrue(response.json['background_removed'])
                for face, url in response.json['views'].items():
                    relative = url.removeprefix('/static/uploads/')
                    with Image.open(folder / relative) as cutout:
                        self.assertEqual(cutout.mode, 'RGBA')
                        self.assertLess(cutout.width, image.width)
                        self.assertEqual(cutout.getpixel((0, 0))[3], 0)
                        self.assertGreater(cutout.getpixel((cutout.width // 2, cutout.height // 2))[3], 200)
                    original = response.json['original_views'][face].removeprefix('/static/uploads/')
                    with Image.open(folder / original) as source:
                        self.assertEqual(source.mode, 'RGB')
                        self.assertEqual(source.size, image.size)
                library = scanner.app.test_client().get('/api/scans').json['scans']
                self.assertEqual(len(library), 1)
                self.assertTrue(library[0]['background_removed'])


if __name__ == '__main__':
    unittest.main()
