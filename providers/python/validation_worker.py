#!/usr/bin/env python3
import hashlib, json, sys
from PIL import Image
import numpy as np

def digest(arr):
    return hashlib.sha256(arr.tobytes()).hexdigest()

def inspect(path):
    rgba = np.asarray(Image.open(path).convert('RGBA')).astype(np.uint8)
    alpha = rgba[:, :, 3]
    return {
        'width': int(rgba.shape[1]),
        'height': int(rgba.shape[0]),
        'rgbHash': digest(rgba[:, :, :3]),
        'alphaHash': digest(alpha),
        'transparentPixels': int((alpha == 0).sum()),
        'opaquePixels': int((alpha == 255).sum()),
        'partialAlphaPixels': int(((alpha > 0) & (alpha < 255)).sum()),
    }

def main(req):
    action = req['action']
    if action == 'inspect':
        return inspect(req['path'])
    if action == 'compare_relight':
        source = inspect(req['source'])
        output = inspect(req['output'])
        return {
            'source': source,
            'output': output,
            'sameDimensions': source['width'] == output['width'] and source['height'] == output['height'],
            'sameAlpha': source['alphaHash'] == output['alphaHash'],
            'rgbChanged': source['rgbHash'] != output['rgbHash'],
        }
    raise ValueError(f'unsupported_action:{action}')

try:
    request = json.load(sys.stdin)
    print(json.dumps({'ok': True, 'result': main(request)}))
except Exception as exc:
    print(json.dumps({'ok': False, 'error': str(exc)}))
    sys.exit(1)
