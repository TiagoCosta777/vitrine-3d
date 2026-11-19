"""Local object cutouts with the bundled U2NETP model (no remote photo service).

U2NETP input normalization follows the model's rembg session contract. The model
and its upstream licenses/provenance are stored under ``models/``.
"""
from __future__ import annotations

import hashlib
import threading
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

try:
    import numpy as np
    import onnxruntime as ort
except (ImportError, OSError):  # Keep the server importable without native wheels.
    np = None
    ort = None

MODEL_PATH = Path(__file__).resolve().parent / 'models' / 'u2netp.onnx'
MODEL_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'
_session = None
_session_lock = threading.Lock()
_inference_lock = threading.Lock()
_last_error = None


class BackgroundRemovalError(ValueError):
    """The image could not produce a useful object mask."""


class BackgroundModelUnavailable(BackgroundRemovalError):
    """Local segmentation dependencies or verified model are unavailable."""


def get_model_status():
    """Report local readiness without loading a missing model or downloading it.

    ``ready`` means the files/runtime are available for lazy initialization;
    ``loaded`` distinguishes an already initialized inference session.
    """
    error = None
    if np is None or ort is None:
        error = 'Instale numpy e onnxruntime para remover o fundo localmente.'
    elif not MODEL_PATH.is_file():
        error = 'O modelo local de remoção de fundo não foi encontrado.'
    elif _last_error:
        error = _last_error
    return {'ready': error is None, 'loaded': _session is not None,
            'model': 'u2netp', **({'error': error} if error else {})}


def warmup():
    """Load the verified CPU-only model once; never download during requests."""
    global _session, _last_error
    if _session is not None:
        return _session
    with _session_lock:
        if _session is not None:
            return _session
        if np is None or ort is None:
            raise BackgroundModelUnavailable('Instale numpy e onnxruntime para remover o fundo localmente.')
        if not MODEL_PATH.is_file():
            raise BackgroundModelUnavailable('O modelo local de remoção de fundo não foi encontrado.')
        try:
            if hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() != MODEL_SHA256:
                raise BackgroundModelUnavailable('O modelo de remoção de fundo está incompleto ou foi alterado.')
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            session = ort.InferenceSession(str(MODEL_PATH), sess_options=options,
                                           providers=['CPUExecutionProvider'])
        except BackgroundModelUnavailable:
            raise
        except Exception as exc:
            _last_error = 'Não foi possível iniciar o modelo local de remoção de fundo.'
            raise BackgroundModelUnavailable(_last_error) from exc
        _session = session
        _last_error = None
        return session


def _tensor(image):
    pixels = np.asarray(image.convert('RGB').resize((320, 320), Image.Resampling.LANCZOS), dtype=np.float32)
    pixels /= max(float(pixels.max()), 1e-6)
    pixels -= np.asarray((.485, .456, .406), dtype=np.float32)
    pixels /= np.asarray((.229, .224, .225), dtype=np.float32)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None], dtype=np.float32)


def _alpha(prediction, size):
    values = np.asarray(prediction, dtype=np.float32).squeeze()
    if values.ndim != 2 or min(values.shape) < 2 or not np.isfinite(values).all():
        raise BackgroundRemovalError('Não foi possível separar o objeto. Tente um fundo mais simples e boa iluminação.')
    low, high = float(values.min()), float(values.max())
    if high - low < .01:
        raise BackgroundRemovalError('Nenhum objeto foi identificado. Centralize um único produto com espaço ao redor.')
    values = (values - low) / (high - low)
    foreground = values > .5
    coverage = float(foreground.mean())
    border = np.concatenate((foreground[0], foreground[-1], foreground[:, 0], foreground[:, -1]))
    if coverage < .005 or coverage > .98 or float(border.mean()) > .7:
        raise BackgroundRemovalError('Deixe o produto inteiro no quadro, com uma margem e fundo simples, e tente novamente.')
    # Remove low-confidence haze while retaining soft antialiasing on the edges.
    values = np.clip((values - .04) / .92, 0, 1)
    return Image.fromarray(np.rint(values * 255).astype('uint8')).resize(size, Image.Resampling.LANCZOS)


def remove_background(image: Image.Image) -> Image.Image:
    """Return a tight, padded RGBA cutout, or fail instead of saving opaque photos.

    The original is never mutated. Segmentation selects the salient foreground,
    so touching hands/props can remain part of it; keep them outside the photo.
    Returned dimensions follow the object bounds rather than the camera frame.
    """
    if not isinstance(image, Image.Image) or image.width < 8 or image.height < 8:
        raise BackgroundRemovalError('Imagem inválida para recortar o objeto.')
    if image.width * image.height > 24000000:
        raise BackgroundRemovalError('A imagem é grande demais para remover o fundo.')
    source = ImageOps.exif_transpose(image).convert('RGBA')
    if max(high - low for low, high in source.convert('RGB').getextrema()) < 2:
        raise BackgroundRemovalError('Nenhum objeto foi identificado. Centralize um produto com luz e fundo contrastante.')
    session = warmup()
    tensor = _tensor(source)
    try:
        with _inference_lock:
            output = session.run([session.get_outputs()[0].name], {session.get_inputs()[0].name: tensor})[0]
    except Exception as exc:
        raise BackgroundRemovalError('Não foi possível recortar esta vista. Reenvie as fotos ou faça uma nova captura.') from exc
    alpha = _alpha(output, source.size)
    alpha = ImageChops.multiply(alpha, source.getchannel('A'))
    bounds = alpha.point(lambda value: 255 if value >= 32 else 0).getbbox()
    if bounds is None:
        raise BackgroundRemovalError('Nenhum objeto foi identificado nesta vista. Capture o produto com luz uniforme.')
    source.putalpha(alpha)
    cropped = source.crop(bounds)
    # Identical proportional margins in every view, without clipping edge detail.
    padding = max(4, round(max(cropped.size) * .045))
    result = Image.new('RGBA', (cropped.width + 2 * padding, cropped.height + 2 * padding), (0, 0, 0, 0))
    result.paste(cropped, (padding, padding))
    return result
