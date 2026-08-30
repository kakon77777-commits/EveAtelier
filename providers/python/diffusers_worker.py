#!/usr/bin/env python3
import argparse, json, sys, random
from pathlib import Path

def emit(obj,code=0):
    print(json.dumps(obj)); sys.exit(code)

def fixture_generate(req):
    from PIL import Image, ImageDraw
    w=int(req.get('width',64)); h=int(req.get('height',64)); seed=int(req.get('seed',0))
    rng=random.Random(seed)
    bg=(rng.randrange(20,80),rng.randrange(20,80),rng.randrange(20,80),255)
    im=Image.new('RGBA',(w,h),bg); d=ImageDraw.Draw(im)
    margin=max(2,min(w,h)//5)
    d.ellipse((margin,margin,w-margin-1,h-margin-1),fill=(200,50+rng.randrange(30),50,255))
    out=Path(req['output']); out.parent.mkdir(parents=True,exist_ok=True); im.save(out)
    return {'status':'completed','output':str(out),'mode':'fixture','seed':seed}

def real_probe():
    try:
        import diffusers, torch
        return {'available':True,'mode':'real','diffusersVersion':diffusers.__version__,'torchVersion':torch.__version__}
    except ModuleNotFoundError:
        return {'available':False,'reason':'diffusers_not_installed'}
    except Exception as exc:
        return {'available':False,'reason':'diffusers_probe_failed','detail':str(exc)}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--fixture',action='store_true'); args=ap.parse_args()
    req=json.load(sys.stdin); action=req.get('action')
    if action=='probe':
        if args.fixture: return {'available':True,'mode':'fixture'}
        return real_probe()
    if action=='generate':
        if args.fixture: return fixture_generate(req)
        probe=real_probe()
        if not probe.get('available'): return {'status':'unavailable',**probe}
        raise RuntimeError('real_generation_not_configured_without_explicit_model')
    raise ValueError('unsupported_action')
try:
    print(json.dumps({'ok':True,'result':main()}))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)})); sys.exit(1)
