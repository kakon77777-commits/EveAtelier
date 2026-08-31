#!/usr/bin/env python3
import argparse, hashlib, json, sys, random
from pathlib import Path

def emit(obj,code=0):
    print(json.dumps(obj)); sys.exit(code)

def fixture_generate(req):
    from PIL import Image, ImageDraw, ImageEnhance
    width=req.get('width'); height=req.get('height')
    w=int(width) if width is not None else 64
    h=int(height) if height is not None else 64
    seed=int(req.get('seed',0))
    if req.get('sourcePath'):
        source=Image.open(req['sourcePath']).convert('RGBA')
        if req.get('width') and req.get('height'):
            source=source.resize((w,h),Image.Resampling.LANCZOS)
        factor=0.85+(seed%7)*0.04
        result=ImageEnhance.Color(source).enhance(factor)
        out=Path(req['outputPath']); out.parent.mkdir(parents=True,exist_ok=True); result.save(out)
        return {
            'status':'completed','outputPath':str(out),'mode':'fixture','seed':seed,
            'executionId':f'fixture:{seed}',
            'modelIdentity':{'id':'fixture:deterministic-raster','revision':'0.1'},
        }
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

def real_generate_variation(req):
    probe=real_probe()
    if not probe.get('available'):
        return {'status':'unavailable',**probe}
    model=req.get('model') or {}
    model_id=model.get('modelId')
    if not model_id:
        return {'status':'unavailable','reason':'explicit_model_required'}
    try:
        import torch
        from diffusers import AutoPipelineForImage2Image
        from PIL import Image
        allow_download=bool(model.get('allowDownload',False))
        device=model.get('device','auto')
        if device=='auto': device='cuda' if torch.cuda.is_available() else 'cpu'
        if device=='cuda' and not torch.cuda.is_available():
            return {'status':'unavailable','reason':'cuda_not_available'}
        dtype=torch.float16 if device=='cuda' else torch.float32
        kwargs={
            'revision':model.get('revision'),
            'local_files_only':not allow_download,
            'torch_dtype':dtype,
        }
        kwargs={key:value for key,value in kwargs.items() if value is not None}
        pipeline=AutoPipelineForImage2Image.from_pretrained(model_id,**kwargs).to(device)
        source=Image.open(req['sourcePath']).convert('RGB')
        if req.get('width') and req.get('height'):
            source=source.resize((int(req['width']),int(req['height'])),Image.Resampling.LANCZOS)
        generator=torch.Generator(device=device).manual_seed(int(req.get('seed',0)))
        result=pipeline(
            prompt=req.get('prompt',''),
            negative_prompt=req.get('negativePrompt',''),
            image=source,
            strength=float(req.get('strength',0.45)),
            guidance_scale=float(req.get('guidanceScale',7.0)),
            num_inference_steps=int(req.get('inferenceSteps',30)),
            generator=generator,
        ).images[0]
        output=Path(req['outputPath']); output.parent.mkdir(parents=True,exist_ok=True); result.save(output)
        return {
            'status':'completed','outputPath':str(output),'mode':'real','seed':int(req.get('seed',0)),
            'executionId':f"diffusers:{hashlib.sha256((model_id+str(req.get('seed',0))).encode()).hexdigest()[:16]}",
            'modelIdentity':{
                'id':model_id,'revision':model.get('revision') or 'unspecified',
                'license':model.get('license'),'source':model.get('source'),
            },
            'evidence':{
                'device':device,'dtype':str(dtype),'torchVersion':torch.__version__,
                'diffusersVersion':probe.get('diffusersVersion'),
            },
        }
    except OSError as exc:
        reason='model_load_failed' if model.get('allowDownload') else 'model_not_available_locally'
        return {'status':'unavailable','reason':reason,'detail':str(exc)}
    except Exception as exc:
        return {'status':'unavailable','reason':'diffusers_generation_failed','detail':str(exc)}

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
    if action=='generate_variation':
        if args.fixture: return fixture_generate(req)
        return real_generate_variation(req)
    raise ValueError('unsupported_action')
try:
    print(json.dumps({'ok':True,'result':main()}))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)})); sys.exit(1)
