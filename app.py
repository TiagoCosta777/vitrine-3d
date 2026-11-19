from __future__ import annotations

import io
import json
import math
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO
from PIL import Image, ImageOps
from werkzeug.security import check_password_hash
from barcode_decoder import decode_barcode
from object_background import (BackgroundModelUnavailable, BackgroundRemovalError,
                               get_model_status, remove_background)

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / 'scanner3d.db'
UPLOAD_DIR = BASE_DIR / 'static' / 'uploads'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'scanner3d-dev')
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024
app.config['TEMPLATES_AUTO_RELOAD'] = os.environ.get('SCANNER_RELOAD') == '1'
app.config['SCAN_DELETE_PASSWORD_HASH'] = os.environ.get(
    'SCAN_DELETE_PASSWORD_HASH',
    'scrypt:32768:8:1$AimMZs3AIeCxKkfa$7c86aceeb0c909761476aa75631e492346726ec4a2f3ce2eeca2c5f68157a1be51fb1423cfd9642cffcda5556b2b8470f031f16aac05f0af476c34c8d6fbc4a8')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')
background_lock = threading.Lock()


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS products (
                barcode TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                price TEXT DEFAULT '',
                weight TEXT DEFAULT '',
                image_url TEXT DEFAULT ''
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS scans (
                id TEXT PRIMARY KEY,
                barcode TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                views TEXT NOT NULL,
                original_views TEXT NOT NULL DEFAULT '{}',
                background_removed INTEGER NOT NULL DEFAULT 0,
                shape_options TEXT NOT NULL DEFAULT '{}',
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
        ''')
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(scans)')}
        if 'original_views' not in columns:
            conn.execute("ALTER TABLE scans ADD COLUMN original_views TEXT NOT NULL DEFAULT '{}'")
        if 'background_removed' not in columns:
            conn.execute('ALTER TABLE scans ADD COLUMN background_removed INTEGER NOT NULL DEFAULT 0')
        if 'shape_options' not in columns:
            conn.execute("ALTER TABLE scans ADD COLUMN shape_options TEXT NOT NULL DEFAULT '{}'")
        if 'archived' not in columns:
            conn.execute('ALTER TABLE scans ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
        conn.commit()


def get_product(barcode: str):
    with db() as conn:
        row = conn.execute(
            'SELECT barcode, name, price, weight, image_url FROM products WHERE barcode=?',
            (barcode,),
        ).fetchone()
    return dict(row) if row else None


def save_product(data):
    with db() as conn:
        conn.execute('''
            INSERT INTO products (barcode, name, price, weight, image_url)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(barcode) DO UPDATE SET
                name=excluded.name,
                price=excluded.price,
                weight=excluded.weight,
                image_url=CASE
                    WHEN excluded.image_url <> '' THEN excluded.image_url
                    ELSE products.image_url
                END
        ''', (
            data['barcode'], data['name'], data.get('price', ''),
            data.get('weight', ''), data.get('image_url', '')
        ))
        conn.commit()


@app.route('/')
def index():
    return render_template('index.html')


@app.post('/api/scan-frame')
def scan_frame():
    started = time.perf_counter()
    file = request.files.get('frame')
    if not file:
        return jsonify(ok=False, error='frame ausente'), 400

    try:
        raw = file.read()
        with Image.open(io.BytesIO(raw)) as img:
            if img.width * img.height > 24000000:
                raise ValueError('Imagem muito grande')
            result = decode_barcode(img, thorough=request.form.get('mode') == 'photo')
    except Exception as exc:
        return jsonify(ok=False, error=f'falha ao ler quadro: {exc}'), 400

    elapsed_ms = round((time.perf_counter() - started) * 1000)
    if not result:
        return jsonify(ok=True, found=False, ms=elapsed_ms)

    code = result['code']
    product = get_product(code)
    payload = {'barcode': code, 'format': result['format'], 'product': product}
    return jsonify(ok=True, found=True, barcode=code, format=result['format'], product=product, ms=elapsed_ms)


@app.post('/api/confirm-barcode')
def confirm_barcode():
    data = request.get_json(silent=True) or {}
    code = str(data.get('barcode', '')).strip()
    if not code or len(code) > 256:
        return jsonify(ok=False, error='Código inválido.'), 400
    payload = {'barcode': code, 'format': data.get('format', ''), 'product': get_product(code)}
    socketio.emit('barcode_detected', payload)
    return jsonify(ok=True, **payload)


@app.post('/api/object-scan')
def object_scan():
    barcode = (request.form.get('barcode') or '').strip()
    if len(barcode) > 256:
        return jsonify(ok=False, error='Identificador inválido.'), 400
    faces = ['front', 'right', 'back', 'left', 'top', 'bottom']
    images = {}
    try:
        for face in faces:
            file = request.files.get(face)
            if file is None:
                return jsonify(ok=False, error='Envie as seis vistas do objeto.'), 400
            with Image.open(file.stream) as source:
                if source.width * source.height > 24000000:
                    raise ValueError('Imagem muito grande')
                img = ImageOps.exif_transpose(source).convert('RGB')
                img.thumbnail((1600, 1600))
                images[face] = img.copy()
    except (OSError, ValueError, Image.DecompressionBombError):
        return jsonify(ok=False, error='Uma das imagens é inválida.'), 400
    if not background_lock.acquire(blocking=False):
        return jsonify(ok=False, error='Outra captura está sendo processada. Aguarde um instante e toque em Reenviar capturas.'), 409
    try:
        # Finish all masks before creating files or registering a partial scan.
        processed = {face: remove_background(image) for face, image in images.items()}
        scan_id = uuid.uuid4().hex
        folder = UPLOAD_DIR / scan_id
        folder.mkdir()
        urls, originals = {}, {}
        for face, image in processed.items():
            image.save(folder / f'{face}.png', format='PNG')
            images[face].save(folder / f'original-{face}.jpg', quality=95)
            urls[face] = f'/static/uploads/{scan_id}/{face}.png'
            originals[face] = f'/static/uploads/{scan_id}/original-{face}.jpg'
        name = (request.form.get('name') or '').strip()[:120]
        product = get_product(barcode) if barcode else None
        name = name or (product['name'] if product else 'Objeto sem nome')
        with db() as conn:
            conn.execute('INSERT INTO scans (id, barcode, name, views, original_views, background_removed) VALUES (?, ?, ?, ?, ?, 1)',
                         (scan_id, barcode, name, json.dumps(urls), json.dumps(originals)))
            row = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
        payload = scan_payload(row)
    except BackgroundModelUnavailable as error:
        return jsonify(ok=False, error=str(error)), 503
    except BackgroundRemovalError as error:
        return jsonify(ok=False, error=str(error)), 422
    finally:
        background_lock.release()
    socketio.emit('object_scanned', payload)
    return jsonify(ok=True, **payload)


def scan_payload(row):
    return {**dict(row), 'views': json.loads(row['views']),
            'original_views': json.loads(row['original_views'] or '{}'),
            'background_removed': bool(row['background_removed']),
            'archived': bool(row['archived']),
            'shape_options': json.loads(row['shape_options'] or '{}')}


@app.get('/api/scans')
def list_scans():
    archived = request.args.getlist('archived')
    if len(archived) > 1 or archived and archived[0] not in ('0', '1'):
        return jsonify(ok=False, error='Filtro de arquivamento inválido.'), 400
    archived = int(archived[0]) if archived else 0
    with db() as conn:
        rows = conn.execute('SELECT * FROM scans WHERE archived=? ORDER BY created_at DESC, rowid DESC',
                            (archived,)).fetchall()
    scans = [scan_payload(row) for row in rows]
    return jsonify(ok=True, scans=scans)


@app.patch('/api/scans/<scan_id>')
def rename_scan(scan_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get('name'), str):
        return jsonify(ok=False, error='Informe um nome para o objeto.'), 400
    name = data['name'].strip()
    if not name or len(name) > 120:
        return jsonify(ok=False, error='Use um nome com 1 a 120 caracteres.'), 400
    with db() as conn:
        row = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
        if row is None:
            return jsonify(ok=False, error='Captura não encontrada.'), 404
        conn.execute('UPDATE scans SET name=? WHERE id=?', (name, scan_id))
        updated = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
    payload = scan_payload(updated)
    socketio.emit('object_scan_updated', payload)
    return jsonify(ok=True, **payload)


def set_scan_archived(scan_id, archived):
    # Archiving only changes visibility in the library; all images and metadata
    # remain available so the same capture can be restored without rebuilding it.
    with db() as conn:
        row = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
        if row is None:
            return jsonify(ok=False, error='Captura não encontrada.'), 404
        conn.execute('UPDATE scans SET archived=? WHERE id=?', (int(archived), scan_id))
        updated = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
    payload = scan_payload(updated)
    socketio.emit('object_scan_updated', payload)
    return jsonify(ok=True, **payload)


@app.post('/api/scans/<scan_id>/archive')
def archive_scan(scan_id):
    return set_scan_archived(scan_id, True)


@app.post('/api/scans/<scan_id>/restore')
def restore_scan(scan_id):
    return set_scan_archived(scan_id, False)


def scan_image_paths(row):
    paths = set()
    root = UPLOAD_DIR.resolve()
    for field in ('views', 'original_views'):
        views = json.loads(row[field] or '{}')
        if not isinstance(views, dict):
            raise ValueError('Invalid image metadata')
        for url in views.values():
            if not isinstance(url, str) or not url.startswith('/static/uploads/'):
                raise ValueError('Invalid image URL')
            path = (root / url[len('/static/uploads/'):]).resolve()
            if path == root or not path.is_relative_to(root) or path.exists() and not path.is_file():
                raise ValueError('Invalid image path')
            paths.add(path)
    return paths


@app.delete('/api/scans/<scan_id>')
def delete_scan(scan_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get('password'), str):
        return jsonify(ok=False, error='Informe a senha para excluir o objeto.'), 400
    password = data['password']
    if len(password) > 256 or not check_password_hash(app.config['SCAN_DELETE_PASSWORD_HASH'], password):
        return jsonify(ok=False, error='Senha incorreta. O objeto não foi excluído.'), 403
    if not background_lock.acquire(blocking=False):
        return jsonify(ok=False, error='Há imagens sendo processadas. Aguarde e tente novamente.'), 409
    moved = []
    staging = None
    cleanup = False
    try:
        with db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
            if row is None:
                return jsonify(ok=False, error='Captura não encontrada.'), 404
            files = scan_image_paths(row)
            for other in conn.execute('SELECT views, original_views FROM scans WHERE id<>?', (scan_id,)):
                files.difference_update(scan_image_paths(other))
            # Move only this capture's unshared images outside the public directory.
            # If the database operation fails, every moved image is restored.
            private_root = DB_PATH.resolve().parent / '.deleted-scans'
            private_root.mkdir(exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix='scan-', dir=private_root))
            for index, source in enumerate(sorted(files)):
                if source.is_file():
                    target = staging / str(index)
                    source.replace(target)
                    moved.append((source, target))
            conn.execute('DELETE FROM scans WHERE id=?', (scan_id,))
        cleanup = True
    except (OSError, ValueError, TypeError, sqlite3.Error):
        for original, target in reversed(moved):
            try:
                target.replace(original)
            except OSError:
                app.logger.exception('Could not restore a staged image; private recovery copy retained.')
        cleanup = all(not target.exists() for _, target in moved)
        return jsonify(ok=False, error='Não foi possível excluir o objeto. Tente novamente.'), 409
    finally:
        if staging is not None and cleanup:
            try:
                shutil.rmtree(staging)
            except OSError:
                app.logger.warning('Temporary deleted-image cleanup is pending.')
        background_lock.release()
    payload = {'id': scan_id}
    socketio.emit('object_scan_deleted', payload)
    return jsonify(ok=True, **payload)


@app.get('/api/background/status')
def background_status():
    return jsonify(ok=True, **get_model_status())


@app.post('/api/scans/<scan_id>/shape-options')
def save_shape_options(scan_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(ok=False, error='Informe as proporções do modelo.'), 400
    form = data.get('form', 'auto')
    if form not in ('auto', 'round', 'box', 'cylinder', 'ellipsoid'):
        return jsonify(ok=False, error='Formato inválido.'), 400
    if isinstance(data.get('widthScale'), bool) or isinstance(data.get('depthScale'), bool):
        return jsonify(ok=False, error='Proporções inválidas.'), 400
    try:
        width = float(data.get('widthScale', 1))
        depth = float(data.get('depthScale', 1))
    except (TypeError, ValueError):
        return jsonify(ok=False, error='Proporções inválidas.'), 400
    if not math.isfinite(width) or not math.isfinite(depth) or not .5 <= width <= 1.75 or not .25 <= depth <= 2.5:
        return jsonify(ok=False, error='Proporções fora do intervalo permitido.'), 400
    options = {'form': form, 'widthScale': width, 'depthScale': depth}
    with db() as conn:
        row = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
        if row is None:
            return jsonify(ok=False, error='Captura não encontrada.'), 404
        conn.execute('UPDATE scans SET shape_options=? WHERE id=?', (json.dumps(options), scan_id))
        updated = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
    payload = scan_payload(updated)
    socketio.emit('object_shape_updated', payload)
    return jsonify(ok=True, **payload)


@app.post('/api/scans/<scan_id>/remove-background')
def remove_saved_background(scan_id):
    with db() as conn:
        row = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error='Captura não encontrada.'), 404
    payload = scan_payload(row)
    if payload['background_removed']:
        return jsonify(ok=True, **payload)
    if not background_lock.acquire(blocking=False):
        return jsonify(ok=False, error='Outra captura está sendo processada. Aguarde e tente novamente.'), 409
    try:
        originals = payload['original_views'] or payload['views']
        images = {}
        for face in ['front', 'right', 'back', 'left', 'top', 'bottom']:
            url = originals.get(face, '')
            if not url.startswith('/static/uploads/'):
                raise ValueError('As fotos originais desta captura não estão disponíveis.')
            source_path = (UPLOAD_DIR / url[len('/static/uploads/'):]).resolve()
            if not source_path.is_relative_to(UPLOAD_DIR.resolve()):
                raise ValueError('Caminho de imagem inválido.')
            with Image.open(source_path) as source:
                if source.width * source.height > 24000000:
                    raise ValueError('Imagem muito grande.')
                image = ImageOps.exif_transpose(source).convert('RGB')
                image.thumbnail((1600, 1600))
                images[face] = image.copy()
        processed = {face: remove_background(image) for face, image in images.items()}
        # Use a fresh folder, preserving every original file and previous URL.
        output_id = uuid.uuid4().hex
        folder = UPLOAD_DIR / output_id
        folder.mkdir()
        urls = {}
        for face, image in processed.items():
            image.save(folder / f'{face}.png', format='PNG')
            urls[face] = f'/static/uploads/{output_id}/{face}.png'
        with db() as conn:
            conn.execute('UPDATE scans SET views=?, original_views=?, background_removed=1 WHERE id=?',
                         (json.dumps(urls), json.dumps(originals), scan_id))
            updated = conn.execute('SELECT * FROM scans WHERE id=?', (scan_id,)).fetchone()
        payload = scan_payload(updated)
    except BackgroundModelUnavailable as error:
        return jsonify(ok=False, error=str(error)), 503
    except BackgroundRemovalError as error:
        return jsonify(ok=False, error=str(error)), 422
    except (OSError, ValueError, Image.DecompressionBombError):
        return jsonify(ok=False, error='Não foi possível abrir as fotos originais desta captura.'), 400
    finally:
        background_lock.release()
    socketio.emit('object_scanned', payload)
    return jsonify(ok=True, **payload)


@app.get('/api/product/<barcode>')
def product(barcode):
    item = get_product(barcode)
    return jsonify(found=bool(item), product=item)


@app.post('/api/product')
def register_product():
    barcode = (request.form.get('barcode') or '').strip()
    name = (request.form.get('name') or '').strip()
    price = (request.form.get('price') or '').strip()
    weight = (request.form.get('weight') or '').strip()
    if not barcode or not name:
        return jsonify(ok=False, error='Código e nome são obrigatórios.'), 400

    image_url = ''
    image = request.files.get('image')
    if image and image.filename:
        ext = Path(image.filename).suffix.lower()
        if ext not in {'.jpg', '.jpeg', '.png', '.webp'}:
            ext = '.jpg'
        filename = f'{uuid.uuid4().hex}{ext}'
        image.save(UPLOAD_DIR / filename)
        image_url = f'/static/uploads/{filename}'

    data = {'barcode': barcode, 'name': name, 'price': price, 'weight': weight, 'image_url': image_url}
    save_product(data)
    item = get_product(barcode)
    socketio.emit('product_updated', {'product': item})
    return jsonify(ok=True, product=item)


@app.post('/api/select/<barcode>')
def select_product(barcode):
    item = get_product(barcode)
    socketio.emit('barcode_detected', {'barcode': barcode, 'format': 'manual', 'product': item})
    return jsonify(ok=True, product=item)


if __name__ == '__main__':
    port = int(os.environ.get('SCANNER_PORT', '5000'))
    init_db()
    print('=' * 70)
    print('VITRINE 3D V14 - CAPTURA E VISUALIZAÇÃO DE PRODUTOS')
    print(f'PC:      http://127.0.0.1:{port}')
    print('CELULAR: use o link HTTPS do cloudflared')
    print('=' * 70)
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True,
                 use_reloader=os.environ.get('SCANNER_RELOAD') == '1')
