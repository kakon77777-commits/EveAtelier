#!/usr/bin/env python3
import json, sys, hashlib
from pathlib import Path
from PIL import Image
import numpy as np

def sha(arr):
    return hashlib.sha256(arr.tobytes()).hexdigest()

def normalize(v):
    n=np.linalg.norm(v,axis=-1,keepdims=True)
    n=np.where(n<1e-8,1.0,n)
    return v/n

def infer_normal(im,strength=2.0):
    rgba=np.asarray(im.convert('RGBA')).astype(np.float32)/255.0
    rgb=rgba[:,:,:3]
    lum=0.2126*rgb[:,:,0]+0.7152*rgb[:,:,1]+0.0722*rgb[:,:,2]
    gy,gx=np.gradient(lum)
    n=np.stack((-gx*strength,-gy*strength,np.ones_like(lum)),axis=-1)
    n=normalize(n)
    return n

def save_normal(n,path):
    enc=np.clip((n*0.5+0.5)*255.0,0,255).astype(np.uint8)
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(enc,'RGB').save(path)

def load_normal(path):
    arr=np.asarray(Image.open(path).convert('RGB')).astype(np.float32)/255.0
    return normalize(arr*2.0-1.0)

def main(req):
    op=req['operatorId']; inp=req['input']; out=req['output']; p=req.get('params') or {}
    im=Image.open(inp).convert('RGBA')
    if op=='visual.op.physical.infer_normal':
        n=infer_normal(im,float(p.get('strength',2.0)))
        save_normal(n,out)
        return {'size':{'width':im.width,'height':im.height},'channels':'RGB','meanNormalZ':float(n[:,:,2].mean())}
    if op=='visual.op.physical.relight':
        rgba=np.asarray(im).astype(np.uint8)
        rgb=rgba[:,:,:3].astype(np.float32)/255.0
        alpha=rgba[:,:,3].copy()
        n=load_normal(p['normal']) if p.get('normal') else infer_normal(im,float(p.get('strength',2.0)))
        key=np.array(p.get('keyDirection',[-0.4,-0.4,1.0]),dtype=np.float32); key=key/max(np.linalg.norm(key),1e-8)
        fill=np.array(p.get('fillDirection',[0.4,0.2,1.0]),dtype=np.float32); fill=fill/max(np.linalg.norm(fill),1e-8)
        kc=np.array(p.get('keyColor',[1,1,1]),dtype=np.float32)
        fc=np.array(p.get('fillColor',[1,0.6,0.4]),dtype=np.float32)
        ki=float(p.get('keyIntensity',0.8)); fi=float(p.get('fillIntensity',0.2)); ambient=float(p.get('ambient',0.25))
        kd=np.maximum((n*key.reshape(1,1,3)).sum(axis=2),0.0)[:,:,None]
        fd=np.maximum((n*fill.reshape(1,1,3)).sum(axis=2),0.0)[:,:,None]
        light=ambient + kd*kc.reshape(1,1,3)*ki + fd*fc.reshape(1,1,3)*fi
        out_rgb=np.clip(rgb*light,0,1)
        out_rgba=np.concatenate([(out_rgb*255).astype(np.uint8),alpha[:,:,None]],axis=2)
        Path(out).parent.mkdir(parents=True,exist_ok=True)
        Image.fromarray(out_rgba,'RGBA').save(out)
        lum=0.2126*out_rgb[:,:,0]+0.7152*out_rgb[:,:,1]+0.0722*out_rgb[:,:,2]
        return {
            'size':{'width':im.width,'height':im.height},
            'inputAlphaHash':sha(alpha),
            'outputAlphaHash':sha(out_rgba[:,:,3]),
            'inputRgbHash':sha(rgba[:,:,:3]),
            'outputRgbHash':sha(out_rgba[:,:,:3]),
            'meanLuminance':float(lum.mean()),
        }
    raise ValueError(f'unsupported_operator:{op}')
try:
    req=json.load(sys.stdin)
    print(json.dumps({'ok':True,'metadata':main(req)}))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)})); sys.exit(1)
