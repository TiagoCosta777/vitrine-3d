import json
import sqlite3
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import app as scanner
import test_scanner as fixtures


class ScanDeletionTests(unittest.TestCase):
    setUp = fixtures.ScannerTests.setUp
    cutout = staticmethod(fixtures.ScannerTests.cutout)
    image_file = fixtures.ScannerTests.image_file
    capture_object = fixtures.ScannerTests.capture_object
    saved_image_bytes = fixtures.ScannerTests.saved_image_bytes

    def delete(self, scan_id, password='12345'):
        return self.client.delete('/api/scans/' + scan_id, json={'password': password})

    def test_wrong_password_or_invalid_body_preserves_record_and_all_images(self):
        captured = self.capture_object()
        images = self.saved_image_bytes()
        self.socket.get_received()
        for value in ('', 'wrong', '1234', '12345 ', 'x' * 257):
            self.assertEqual(self.delete(captured['id'], value).status_code, 403)
        for body in ({}, [], None, {'password': 12345}, {'password': False}):
            self.assertEqual(self.client.delete('/api/scans/' + captured['id'], json=body).status_code, 400)
        self.assertEqual(len(self.client.get('/api/scans').json['scans']), 1)
        self.assertEqual(self.saved_image_bytes(), images)
        self.assertEqual(self.socket.get_received(), [])

    def test_correct_password_deletes_only_selected_capture_and_broadcasts_id(self):
        captured = self.capture_object('Excluir')
        other = self.capture_object('Manter')
        before = self.saved_image_bytes()
        self.socket.get_received()
        response = self.delete(captured['id'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'ok': True, 'id': captured['id']})
        self.assertEqual([s['id'] for s in self.client.get('/api/scans').json['scans']], [other['id']])
        self.assertEqual(self.saved_image_bytes(), {name: data for name, data in before.items() if Path(name).parts[0] == other['id']})
        events = self.socket.get_received()
        self.assertEqual([e['name'] for e in events], ['object_scan_deleted'])
        self.assertEqual(events[0]['args'][0], {'id': captured['id']})
        self.assertEqual(list((self.folder / '.deleted-scans').iterdir()), [])

    def test_archived_capture_can_be_deleted_and_cannot_be_restored(self):
        captured = self.capture_object()
        self.client.post('/api/scans/' + captured['id'] + '/archive')
        self.assertEqual(self.delete(captured['id']).status_code, 200)
        self.assertEqual(self.client.get('/api/scans?archived=1').json['scans'], [])
        self.assertEqual(self.client.post('/api/scans/' + captured['id'] + '/restore').status_code, 404)

    def test_shared_photo_referenced_by_another_capture_is_not_removed(self):
        captured = self.capture_object()
        other = self.capture_object()
        views = dict(other['views'], front=captured['views']['front'])
        with scanner.db() as conn:
            conn.execute('UPDATE scans SET views=? WHERE id=?', (json.dumps(views), other['id']))
        shared = self.folder / captured['id'] / 'front.png'
        data = shared.read_bytes()
        self.assertEqual(self.delete(captured['id']).status_code, 200)
        self.assertEqual(shared.read_bytes(), data)
        self.assertEqual(self.client.get('/api/scans').json['scans'][0]['views'], views)

    def test_busy_processing_does_not_delete_or_change_files(self):
        captured = self.capture_object()
        before = self.saved_image_bytes()
        scanner.background_lock.acquire()
        try:
            self.assertEqual(self.delete(captured['id']).status_code, 409)
        finally:
            scanner.background_lock.release()
        self.assertEqual(self.saved_image_bytes(), before)
        self.assertEqual(len(self.client.get('/api/scans').json['scans']), 1)

    def test_file_move_failure_restores_files_and_database(self):
        captured = self.capture_object()
        before = self.saved_image_bytes()
        replace = Path.replace
        calls = 0

        def fail_second(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise PermissionError('simulated move failure')
            return replace(source, destination)

        with patch.object(Path, 'replace', autospec=True, side_effect=fail_second):
            self.assertEqual(self.delete(captured['id']).status_code, 409)
        self.assertEqual(self.saved_image_bytes(), before)
        self.assertEqual(len(self.client.get('/api/scans').json['scans']), 1)

    def test_database_failure_restores_images(self):
        captured = self.capture_object()
        before = self.saved_image_bytes()
        original_db = scanner.db

        class FailDelete:
            def __init__(self, conn):
                self.conn = conn

            def execute(self, sql, parameters=()):
                if sql.startswith('DELETE FROM scans'):
                    raise sqlite3.OperationalError('simulated write failure')
                return self.conn.execute(sql, parameters)

        @contextmanager
        def failing_db():
            with original_db() as conn:
                yield FailDelete(conn)

        with patch.object(scanner, 'db', failing_db):
            self.assertEqual(self.delete(captured['id']).status_code, 409)
        self.assertEqual(self.saved_image_bytes(), before)
        self.assertEqual(len(self.client.get('/api/scans').json['scans']), 1)

    def test_unsafe_path_is_rejected_without_removing_capture(self):
        captured = self.capture_object()
        images = self.saved_image_bytes()
        with scanner.db() as conn:
            conn.execute('UPDATE scans SET views=? WHERE id=?',
                         (json.dumps({'front':'/static/uploads/../outside.txt'}), captured['id']))
        self.assertEqual(self.delete(captured['id']).status_code, 409)
        self.assertEqual(self.saved_image_bytes(), images)
        self.assertEqual(len(self.client.get('/api/scans').json['scans']), 1)

    def test_missing_capture_and_missing_photos_are_handled(self):
        self.assertEqual(self.delete('missing').status_code, 404)
        self.assertEqual(self.delete('missing', 'wrong').status_code, 403)
        captured = self.capture_object()
        (self.folder / captured['id'] / 'front.png').unlink()
        self.assertEqual(self.delete(captured['id']).status_code, 200)


if __name__ == '__main__':
    unittest.main()
