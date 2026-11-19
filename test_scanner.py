import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageEnhance
import zxingcpp
import app as scanner


class ScannerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        for name, value in [('DB_PATH', self.folder / 'test.db'), ('UPLOAD_DIR', self.folder)]:
            replacement = patch.object(scanner, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        scanner.init_db()
        removal = patch.object(scanner, 'remove_background', side_effect=self.cutout)
        removal.start()
        self.addCleanup(removal.stop)
        self.client = scanner.app.test_client()
        self.socket = scanner.socketio.test_client(scanner.app)
        self.addCleanup(self.socket.disconnect)

    @staticmethod
    def cutout(image):
        result = image.convert('RGBA')
        alpha = Image.new('L', result.size, 0)
        ImageDraw.Draw(alpha).rectangle((10, 10, result.width - 11, result.height - 11), fill=255)
        result.putalpha(alpha)
        return result

    def barcode(self, code='7891234567895'):
        symbol = zxingcpp.create_barcode(code, zxingcpp.BarcodeFormat.EAN13)
        return Image.fromarray(zxingcpp.write_barcode_to_image(symbol, scale=3))

    def image_file(self, image=None):
        output = io.BytesIO()
        (image or Image.new('RGB', (120, 120), 'white')).save(output, 'JPEG', quality=94)
        output.seek(0)
        return output, 'frame.jpg'

    def capture_object(self, name='Garrafa de teste'):
        data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
        data['name'] = name
        response = self.client.post('/api/object-scan', data=data)
        self.assertEqual(response.status_code, 200)
        return response.json

    def saved_image_bytes(self):
        return {str(path.relative_to(self.folder)): path.read_bytes()
                for path in self.folder.rglob('*') if path.suffix in {'.png', '.jpg'}}

    def test_normal_rotated_and_low_contrast(self):
        image = self.barcode()
        for variant in (image, image.rotate(90, expand=True), ImageEnhance.Contrast(image).enhance(.3)):
            self.assertEqual(scanner.decode_barcode(variant)['code'], '7891234567895')

    def test_empty_and_invalid_frames(self):
        response = self.client.post('/api/scan-frame', data={'frame': self.image_file()})
        self.assertFalse(response.json['found'])
        self.assertEqual(self.client.post('/api/scan-frame').status_code, 400)
        self.assertEqual(self.client.post('/api/scan-frame', data={'frame': (io.BytesIO(b'invalid'), 'x.jpg')}).status_code, 400)

    def test_tightly_cropped_barcode_without_quiet_zone(self):
        symbol = zxingcpp.create_barcode('7891234567895', zxingcpp.BarcodeFormat.EAN13)
        image = Image.fromarray(zxingcpp.write_barcode_to_image(symbol, scale=2, add_quiet_zones=False))
        self.assertEqual(scanner.decode_barcode(image)['code'], '7891234567895')

    def test_guidance_assets_load_with_javascript_mime_type(self):
        response = self.client.get('/')
        self.assertIn('coachTitle', response.text)
        self.assertIn('objectCapture', response.text)
        self.assertIn('app.js?v=14', response.text)
        self.assertIn('id="quickCapture"', response.text)
        self.assertIn('id="nativeCapture"', response.text)
        self.assertIn('id="cameraSelect"', response.text)
        self.assertNotIn('Leia o código de barras', response.text)
        self.assertNotIn('id="barcodePhoto"', response.text)
        self.assertIn('viewerZoom', response.text)
        self.assertIn('scanLibrary', response.text)
        module = self.client.get('/static/js/scan-logic.mjs')
        self.addCleanup(module.close)
        self.assertEqual(module.status_code, 200)
        self.assertIn('javascript', module.content_type)
        wasm = self.client.get('/static/vendor/zxing-wasm/dist/reader/zxing_reader.wasm')
        self.addCleanup(wasm.close)
        self.assertEqual(wasm.status_code, 200)
        self.assertIn('application/wasm', wasm.content_type)

    def test_still_photo_uses_thorough_analysis(self):
        with patch.object(scanner, 'decode_barcode', return_value=None) as decode:
            response = self.client.post('/api/scan-frame', data={'frame': self.image_file(), 'mode': 'photo'})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(decode.call_args.kwargs['thorough'])

    def test_broadcast_only_after_confirmation(self):
        response = self.client.post('/api/scan-frame', data={'frame': self.image_file(self.barcode())})
        self.assertTrue(response.json['found'])
        self.assertEqual(self.socket.get_received(), [])
        response = self.client.post('/api/confirm-barcode', json={'barcode': response.json['barcode'], 'format': 'EAN13'})
        self.assertTrue(response.json['ok'])
        self.assertEqual(self.socket.get_received()[0]['name'], 'barcode_detected')

    def test_ambiguous_codes_are_rejected(self):
        first, second = self.barcode(), self.barcode('5901234123457')
        combined = Image.new('RGB', (max(first.width, second.width), first.height + second.height + 60), 'white')
        combined.paste(first, (0, 0))
        combined.paste(second, (0, first.height + 60))
        self.assertIsNone(scanner.decode_barcode(combined))

    def test_six_views_saved_and_broadcast(self):
        faces = ['front', 'right', 'back', 'left', 'top', 'bottom']
        data = {face: self.image_file() for face in faces}
        data['barcode'] = '7891234567895'
        response = self.client.post('/api/object-scan', data=data)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json['views']), set(faces))
        self.assertTrue(response.json['background_removed'])
        self.assertEqual(set(response.json['original_views']), set(faces))
        for face in faces:
            with Image.open(self.folder / response.json['id'] / (face + '.png')) as image:
                self.assertEqual(image.size, (120, 120))
                self.assertEqual(image.mode, 'RGBA')
                self.assertEqual(image.getpixel((0, 0))[3], 0)
                self.assertEqual(image.getpixel((60, 60))[3], 255)
            with Image.open(self.folder / response.json['id'] / ('original-' + face + '.jpg')) as original:
                self.assertEqual(original.mode, 'RGB')
                self.assertEqual(original.size, (120, 120))
        self.assertEqual(self.socket.get_received()[0]['name'], 'object_scanned')
        saved = self.client.get('/api/scans').json['scans']
        self.assertEqual(saved[0]['id'], response.json['id'])
        self.assertEqual(saved[0]['views'], response.json['views'])
        self.assertTrue(saved[0]['background_removed'])
        self.assertEqual(saved[0]['original_views'], response.json['original_views'])
        self.assertTrue(saved[0]['created_at'].endswith('Z'))

    def test_scan_library_persists_names_and_orders_newest_first(self):
        self.assertEqual(self.client.get('/api/scans').json['scans'], [])
        for name in ['Café especial', '<Produto & teste>']:
            data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
            data['name'] = name
            data['barcode'] = '123'
            response = self.client.post('/api/object-scan', data=data)
            self.assertEqual(response.json['name'], name)
        # A new client represents reopening the app; no in-memory session is used.
        library = scanner.app.test_client().get('/api/scans').json['scans']
        self.assertEqual([scan['name'] for scan in library], ['<Produto & teste>', 'Café especial'])

    def test_capture_uses_registered_name_when_no_name_is_entered(self):
        scanner.save_product({'barcode': '123', 'name': 'Produto cadastrado'})
        data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
        data['barcode'] = '123'
        response = self.client.post('/api/object-scan', data=data)
        self.assertEqual(response.json['name'], 'Produto cadastrado')

    def test_incomplete_or_invalid_views_are_rejected(self):
        self.assertEqual(self.client.post('/api/object-scan', data={'front': self.image_file()}).status_code, 400)
        data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
        data['barcode'] = '123'
        data['top'] = (io.BytesIO(b'invalid'), 'top.jpg')
        self.assertEqual(self.client.post('/api/object-scan', data=data).status_code, 400)
        self.assertEqual(list(self.folder.glob('*/')), [])

    def test_object_capture_does_not_require_a_barcode(self):
        for barcode in ['', '   ']:
            data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
            data['barcode'] = barcode
            response = self.client.post('/api/object-scan', data=data)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['barcode'], '')
            self.assertTrue(response.json['background_removed'])

    def test_background_failure_does_not_save_a_partial_capture(self):
        data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
        with patch.object(scanner, 'remove_background', side_effect=scanner.BackgroundRemovalError('Não consegui separar o objeto.')):
            response = self.client.post('/api/object-scan', data=data)
        self.assertEqual(response.status_code, 422)
        self.assertIn('objeto', response.json['error'])
        self.assertEqual(self.socket.get_received(), [])
        self.assertEqual(self.client.get('/api/scans').json['scans'], [])
        self.assertEqual(list(self.folder.glob('*/')), [])

    def test_unavailable_model_returns_a_retryable_error(self):
        data = {face: self.image_file() for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
        with patch.object(scanner, 'remove_background', side_effect=scanner.BackgroundModelUnavailable('Modelo indisponível.')):
            response = self.client.post('/api/object-scan', data=data)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.get('/api/scans').json['scans'], [])

    def test_old_capture_schema_migrates_without_losing_original_urls(self):
        from contextlib import closing
        import json
        import sqlite3
        legacy = self.folder / 'legacy.db'
        with closing(sqlite3.connect(legacy)) as connection, connection:
            connection.execute('CREATE TABLE scans (id TEXT PRIMARY KEY, barcode TEXT, name TEXT, views TEXT, created_at TEXT)')
            connection.execute('INSERT INTO scans VALUES (?, ?, ?, ?, ?)',
                               ('old', '', 'Antiga', json.dumps({'front': '/static/uploads/old/front.jpg'}), '2026-01-01T00:00:00Z'))
        with patch.object(scanner, 'DB_PATH', legacy):
            scanner.init_db()
            data = self.client.get('/api/scans').json['scans'][0]
        self.assertEqual(data['id'], 'old')
        self.assertFalse(data['background_removed'])
        self.assertEqual(data['original_views'], {})
        self.assertEqual(data['shape_options'], {})
        self.assertFalse(data['archived'])
        self.assertEqual(data['views']['front'], '/static/uploads/old/front.jpg')

    def test_saved_capture_background_is_removed_without_overwriting_originals(self):
        import json
        faces = ['front', 'right', 'back', 'left', 'top', 'bottom']
        folder = self.folder / 'previous'
        folder.mkdir()
        urls = {}
        for face in faces:
            Image.new('RGB', (120, 120), 'orange').save(folder / (face + '.jpg'))
            urls[face] = '/static/uploads/previous/' + face + '.jpg'
        with scanner.db() as connection:
            connection.execute('INSERT INTO scans (id, barcode, name, views) VALUES (?, ?, ?, ?)',
                               ('previous', '', 'Objeto antigo', json.dumps(urls)))
        response = self.client.post('/api/scans/previous/remove-background')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['background_removed'])
        self.assertEqual(response.json['original_views'], urls)
        self.assertEqual(response.json['id'], 'previous')
        for face in faces:
            self.assertTrue((folder / (face + '.jpg')).is_file())
            relative = response.json['views'][face].removeprefix('/static/uploads/')
            with Image.open(self.folder / relative) as image:
                self.assertEqual(image.mode, 'RGBA')
                self.assertEqual(image.getpixel((0, 0))[3], 0)
        self.assertEqual(len(self.client.get('/api/scans').json['scans']), 1)
        self.assertEqual(self.socket.get_received()[0]['name'], 'object_scanned')
        with patch.object(scanner, 'remove_background') as remove_again:
            repeat = self.client.post('/api/scans/previous/remove-background')
            self.assertEqual(repeat.status_code, 200)
            remove_again.assert_not_called()

    def test_saved_capture_rejects_paths_outside_the_upload_folder(self):
        import json
        urls = {face: '/static/uploads/../../outside.jpg' for face in ['front', 'right', 'back', 'left', 'top', 'bottom']}
        with scanner.db() as connection:
            connection.execute('INSERT INTO scans (id, barcode, name, views) VALUES (?, ?, ?, ?)',
                               ('invalid', '', 'Inválida', json.dumps(urls)))
        self.assertEqual(self.client.post('/api/scans/invalid/remove-background').status_code, 400)
        self.assertEqual(self.client.post('/api/scans/missing/remove-background').status_code, 404)
        self.assertEqual(list(self.folder.glob('*/')), [])

    def test_shape_adjustments_persist_without_changing_images(self):
        faces = ['front', 'right', 'back', 'left', 'top', 'bottom']
        captured = self.client.post('/api/object-scan', data={face: self.image_file() for face in faces}).json
        self.socket.get_received()
        options = {'form': 'round', 'widthScale': 1.2, 'depthScale': .75}
        response = self.client.post('/api/scans/' + captured['id'] + '/shape-options', json=options)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['shape_options'], options)
        self.assertEqual(response.json['views'], captured['views'])
        self.assertEqual(response.json['original_views'], captured['original_views'])
        restored = scanner.app.test_client().get('/api/scans').json['scans'][0]
        self.assertEqual(restored['shape_options'], options)
        self.assertEqual(self.socket.get_received()[0]['name'], 'object_shape_updated')

    def test_invalid_shape_adjustments_are_rejected(self):
        for options in [{'form': 'unknown'}, {'widthScale': 0}, {'depthScale': 10},
                        {'widthScale': 'NaN'}, {'depthScale': None}, {'widthScale': True},
                        {'depthScale': False}, []]:
            with self.subTest(options=options):
                self.assertEqual(self.client.post('/api/scans/unknown/shape-options', json=options).status_code, 400)
        self.assertEqual(self.client.post('/api/scans/unknown/shape-options', json={}).status_code, 404)

    def test_cylinder_and_ellipsoid_options_are_persisted_without_changing_images(self):
        captured = self.capture_object()
        images = self.saved_image_bytes()
        for form in ('cylinder', 'ellipsoid'):
            options = {'form': form, 'widthScale': .8, 'depthScale': 1.25}
            response = self.client.post('/api/scans/' + captured['id'] + '/shape-options', json=options)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['shape_options'], options)
            restored = scanner.app.test_client().get('/api/scans').json['scans'][0]
            self.assertEqual(restored['shape_options'], options)
            self.assertEqual(restored['views'], captured['views'])
            self.assertEqual(restored['original_views'], captured['original_views'])
        self.assertEqual(self.saved_image_bytes(), images)

    def test_renaming_a_capture_preserves_its_files_metadata_and_shape(self):
        captured = self.capture_object()
        captured = self.client.post('/api/scans/' + captured['id'] + '/shape-options',
                                    json={'form': 'cylinder', 'widthScale': 1.1, 'depthScale': .7}).json
        self.socket.get_received()
        images = self.saved_image_bytes()
        response = self.client.patch('/api/scans/' + captured['id'], json={'name': '  <Suco & garrafa>  '})
        self.assertEqual(response.status_code, 200)
        expected = {**captured, 'name': '<Suco & garrafa>'}
        self.assertEqual(response.json, expected)
        restored = scanner.app.test_client().get('/api/scans').json['scans'][0]
        self.assertEqual(restored, {key: value for key, value in expected.items() if key != 'ok'})
        self.assertEqual(self.saved_image_bytes(), images)
        messages = self.socket.get_received()
        self.assertEqual([event['name'] for event in messages], ['object_scan_updated'])
        self.assertEqual(messages[0]['args'][0], restored)

    def test_invalid_rename_requests_leave_the_capture_untouched(self):
        captured = self.capture_object()
        self.socket.get_received()
        for data in ({}, [], None, 'Nome', {'name': ''}, {'name': '  '}, {'name': 42},
                     {'name': None}, {'name': False}, {'name': 'a' * 121}):
            with self.subTest(data=data):
                response = self.client.patch('/api/scans/' + captured['id'], json=data)
                self.assertEqual(response.status_code, 400)
        response = self.client.patch('/api/scans/' + captured['id'], data='{', content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.patch('/api/scans/missing', json={'name': 'Novo nome'}).status_code, 404)
        saved = self.client.get('/api/scans').json['scans'][0]
        self.assertEqual(saved, {key: value for key, value in captured.items() if key != 'ok'})
        self.assertEqual(self.socket.get_received(), [])

    def test_archiving_and_restoring_preserve_files_and_all_capture_metadata(self):
        captured = self.capture_object('Primeiro objeto')
        captured = self.client.post('/api/scans/' + captured['id'] + '/shape-options',
                                    json={'form': 'ellipsoid', 'widthScale': .9, 'depthScale': 1.3}).json
        other = self.capture_object('Segundo objeto')
        images = self.saved_image_bytes()
        self.socket.get_received()
        route = '/api/scans/' + captured['id']

        archived = self.client.post(route + '/archive')
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.json, {**captured, 'archived': True})
        self.assertEqual([scan['id'] for scan in self.client.get('/api/scans').json['scans']], [other['id']])
        self.assertEqual([scan['id'] for scan in self.client.get('/api/scans?archived=0').json['scans']], [other['id']])
        saved_archive = scanner.app.test_client().get('/api/scans?archived=1').json['scans']
        self.assertEqual(saved_archive, [{key: value for key, value in archived.json.items() if key != 'ok'}])
        self.assertEqual(self.saved_image_bytes(), images)
        self.assertEqual(self.client.post(route + '/archive').json, archived.json)

        restored = self.client.post(route + '/restore')
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json, captured)
        self.assertEqual(self.client.post(route + '/restore').json, captured)
        self.assertEqual(self.client.get('/api/scans?archived=1').json['scans'], [])
        self.assertEqual({scan['id'] for scan in self.client.get('/api/scans').json['scans']},
                         {captured['id'], other['id']})
        self.assertEqual(self.saved_image_bytes(), images)
        messages = self.socket.get_received()
        self.assertEqual([event['name'] for event in messages], ['object_scan_updated'] * 4)
        self.assertTrue(messages[0]['args'][0]['archived'])
        self.assertFalse(messages[-1]['args'][0]['archived'])

    def test_archive_filters_and_unknown_captures_are_rejected(self):
        for value in ('', 'true', '2', '-1', 'NaN'):
            with self.subTest(value=value):
                response = self.client.get('/api/scans', query_string={'archived': value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/api/scans?archived=1&archived=0').status_code, 400)
        self.assertEqual(self.client.post('/api/scans/missing/archive').status_code, 404)
        self.assertEqual(self.client.post('/api/scans/missing/restore').status_code, 404)
        self.assertEqual(self.client.get('/api/scans').json['scans'], [])
        self.assertEqual(self.client.get('/api/scans?archived=1').json['scans'], [])
        self.assertEqual(self.socket.get_received(), [])

    def test_archive_migration_is_additive_and_repeatable_for_existing_complete_records(self):
        import json
        import sqlite3
        from contextlib import closing
        legacy = self.folder / 'before-archive.db'
        views = {'front': '/static/uploads/original/front.png'}
        originals = {'front': '/static/uploads/original/original-front.jpg'}
        options = {'form': 'round', 'widthScale': .8, 'depthScale': 1.1}
        with closing(sqlite3.connect(legacy)) as connection, connection:
            connection.execute('''CREATE TABLE scans (
                id TEXT PRIMARY KEY, barcode TEXT, name TEXT, views TEXT,
                original_views TEXT, background_removed INTEGER,
                shape_options TEXT, created_at TEXT)''')
            connection.execute('INSERT INTO scans VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                               ('existing', '123', 'Mantido', json.dumps(views), json.dumps(originals),
                                1, json.dumps(options), '2026-01-01T00:00:00Z'))
        with patch.object(scanner, 'DB_PATH', legacy):
            scanner.init_db()
            scanner.init_db()
            scan = self.client.get('/api/scans').json['scans'][0]
        self.assertEqual(scan, {'id': 'existing', 'barcode': '123', 'name': 'Mantido',
                                'views': views, 'original_views': originals, 'background_removed': True,
                                'shape_options': options, 'created_at': '2026-01-01T00:00:00Z',
                                'archived': False})


if __name__ == '__main__':
    unittest.main()
