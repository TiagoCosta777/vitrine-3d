"""Read-only checks before a local Vitrine 3D presentation."""
import sqlite3
from pathlib import Path

from object_background import get_model_status

ROOT = Path(__file__).resolve().parent


def main():
    errors = []
    status = get_model_status()
    if status.get('ready'):
        print('[OK] Modelo local de remocao de fundo disponivel.')
    else:
        errors.append('Modelo de remocao indisponivel: ' + str(status.get('error') or status))
    assets = [
        'static/vendor/three/build/three.module.js',
        'static/vendor/three/build/three.core.js',
        'static/vendor/three/examples/jsm/controls/OrbitControls.js',
        'static/vendor/socket.io/socket.io.min.js',
    ]
    for asset in assets:
        if not (ROOT / asset).is_file():
            errors.append('Arquivo ausente: ' + asset)
    if not errors:
        print('[OK] Bibliotecas de visualizacao disponiveis no computador.')
    db_path = ROOT / 'scanner3d.db'
    if db_path.is_file():
        try:
            with sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True) as conn:
                integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
                if integrity != 'ok':
                    errors.append('Integridade do banco: ' + str(integrity))
                else:
                    print('[OK] Banco SQLite integro.')
                rows = conn.execute('SELECT views FROM scans').fetchall()
                import json
                missing = 0
                for row in rows:
                    views = json.loads(row[0])
                    missing += sum(not (ROOT / str(url).lstrip('/')).is_file() for url in views.values())
                if missing:
                    errors.append(str(missing) + ' imagem(ns) referenciada(s) nao encontrada(s).')
                else:
                    print('[OK] ' + str(len(rows)) + ' capturas com imagens acessiveis.')
        except (sqlite3.Error, ValueError, TypeError) as exc:
            errors.append('Nao foi possivel conferir o banco: ' + str(exc))
    else:
        print('[INFO] O banco sera criado na primeira execucao do aplicativo.')
    for error in errors:
        print('[ERRO] ' + error)
    print('Camera e qualidade das fotos ainda devem ser conferidas no aparelho da demonstracao.')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
