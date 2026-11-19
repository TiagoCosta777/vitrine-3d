"""Barcode decoding with two independent readers and conservative image retries.

No OCR or guessed digits are used. An ambiguous frame is never a confirmation.
ZBar is optional so installations without its native library can still use ZXing.
"""
from __future__ import annotations

from PIL import Image, ImageFilter, ImageOps
import zxingcpp

try:
    from pyzbar.pyzbar import decode as _zbar_decode
except (ImportError, OSError):
    _zbar_decode = None


def _gtin_valid(text: str) -> bool:
    if not text or any(char not in '0123456789' for char in text):
        return False
    total = sum(int(char) * (3 if index % 2 == 0 else 1)
                for index, char in enumerate(reversed(text[:-1])))
    return (10 - total % 10) % 10 == int(text[-1])


def _key(result):
    code, fmt = result
    # Some readers identify UPC-A as EAN-13 with a leading zero.
    if fmt.replace('-', '').replace('_', '').upper() == 'EAN13' and len(code) == 13 and code[0] == '0':
        return code[1:]
    return code


def _read(image):
    results = []
    for result in zxingcpp.read_barcodes(image, try_rotate=True, try_downscale=True, try_invert=True):
        code = (result.text or '').strip()
        if result.valid and code:
            results.append((code, str(result.format).split('.')[-1]))
    if _zbar_decode is not None:
        # ZBar handles mildly defocused linear codes that ZXing can miss.
        for result in _zbar_decode(image.convert('L')):
            try:
                code = result.data.decode('utf-8').strip()
            except UnicodeDecodeError:
                continue
            fmt = result.type
            if not code:
                continue
            if fmt in {'EAN13', 'EAN8', 'UPCA'}:
                if not _gtin_valid(code) or getattr(result, 'quality', 2) < 2:
                    continue
            results.append((code, fmt))
    return results


def _resolve(results):
    if not results:
        return None
    if len({_key(result) for result in results}) > 1:
        return False
    code, fmt = results[0]
    return {'code': code, 'format': fmt}


def _attempts(gray):
    contrast = ImageOps.autocontrast(gray, cutoff=1)
    yield contrast
    yield contrast.filter(ImageFilter.UnsharpMask(radius=1.2, percent=160, threshold=2))
    bordered = ImageOps.expand(contrast, border=32, fill=255)
    yield bordered
    if max(bordered.size) < 1800:
        yield bordered.resize((bordered.width * 2, bordered.height * 2), Image.Resampling.BICUBIC)


def _bands(image):
    width, height = image.size
    # Overlapping wide bands remove unrelated packaging text and restore margins.
    # Check every band before accepting, so two different codes remain ambiguous.
    for start in (0, .2, .4):
        yield image.crop((0, round(height * start), width, round(height * (start + .6))))
    for start in (0, .35):
        yield image.crop((round(width * start), 0, round(width * (start + .65)), height))


def decode_barcode(image: Image.Image, thorough: bool = False):
    """Return one reader-validated code, or None for missing/ambiguous content.

    ``thorough`` is intended for an explicit still-photo retry, not every live
    frame. It spends more time on overlapping bands and mild deskewing.
    """
    image = ImageOps.exif_transpose(image).convert('RGB')
    image.thumbnail((2400, 2400))
    gray = ImageOps.grayscale(image)
    low, high = gray.getextrema()
    if low == high:
        return None
    initial = _resolve(_read(image))
    if initial is False:
        return None
    if initial:
        return initial

    for attempt in _attempts(gray):
        result = _resolve(_read(attempt))
        if result is False:
            return None
        if result:
            return result
    if not thorough:
        return None

    candidates = []
    for band in _bands(gray):
        candidates.extend(_read(ImageOps.expand(ImageOps.autocontrast(band, cutoff=1), border=24, fill=255)))
        if _resolve(candidates) is False:
            return None
    for angle in (-4, 4):
        candidates.extend(_read(gray.rotate(angle, expand=True, fillcolor=255)))
        if _resolve(candidates) is False:
            return None
    return _resolve(candidates) or None
