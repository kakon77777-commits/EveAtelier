#!/usr/bin/env python3
import json, sys
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np


def meta(im):
    rgba=im.convert('RGBA')
    a=np.asarray(rgba)[:,:,3]
    return {
        'width': rgba.width,
        'height': rgba.height,
        'hasAlpha': True,
        'nonTransparentPixels': int(np.count_nonzero(a)),
        'transparentPixels': int(a.size - np.count_nonzero(a)),
    }

def save(im, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    im.save(path)

def main(req):
    op=req['operatorId']; inp=req.get('input'); out=req['output']; p=req.get('params') or {}
    im=Image.open(inp).convert('RGBA') if inp else None
    if op=='visual.op.raster.crop':
        left=int(p['left']); top=int(p['top']); w=int(p['width']); h=int(p['height'])
        result=im.crop((left,top,left+w,top+h)); save(result,out)
        return {'metadata':{'width':result.width,'height':result.height}}
    if op=='visual.op.raster.resize':
        result=im.resize((int(p['width']),int(p['height'])), Image.Resampling.LANCZOS); save(result,out)
        return {'metadata':{'width':result.width,'height':result.height}}
    if op=='visual.op.raster.create_mask':
        bg=np.array(p.get('background',[255,255,255]),dtype=np.int16)
        tol=float(p.get('tolerance',8))
        arr=np.asarray(im).astype(np.int16)
        dist=np.sqrt(np.sum((arr[:,:,:3]-bg)**2,axis=2))
        mask=np.where(dist<=tol,0,255).astype(np.uint8)
        result=Image.fromarray(mask,'L'); save(result,out)
        return {'metadata':{'width':result.width,'height':result.height,'mask':True}}
    if op=='visual.op.raster.create_alpha':
        mask=Image.open(p['mask']).convert('L').resize(im.size, Image.Resampling.NEAREST)
        arr=np.array(im,dtype=np.uint8); arr[:,:,3]=np.array(mask,dtype=np.uint8)
        result=Image.fromarray(arr,'RGBA'); save(result,out)
        return {'metadata':meta(result)}
    if op=='visual.op.raster.edge_cleanup':
        radius=max(0,int(p.get('radius',1)))
        alpha=im.getchannel('A')
        if radius>0:
            size=radius*2+1
            alpha=alpha.filter(ImageFilter.MinFilter(size=size))
        result=im.copy(); result.putalpha(alpha); save(result,out)
        return {'metadata':meta(result)}
    if op=='visual.op.raster.recolor':
        tint=np.array(p.get('tint',[1,1,1]),dtype=np.float32).reshape((1,1,3))
        arr=np.array(im,dtype=np.uint8)
        rgb=np.clip(arr[:,:,:3].astype(np.float32)*tint,0,255).astype(np.uint8)
        arr[:,:,:3]=rgb
        result=Image.fromarray(arr,'RGBA'); save(result,out)
        return {'metadata':meta(result)}
    if op=='visual.op.composite.layer_composite':
        overlay=Image.open(p['overlay']).convert('RGBA')
        result=im.copy(); result.alpha_composite(overlay,(int(p.get('left',0)),int(p.get('top',0))))
        save(result,out)
        return {'metadata':{'width':result.width,'height':result.height,'hasAlpha':True}}
    raise ValueError(f'unsupported_operator:{op}')

try:
    request=json.load(sys.stdin)
    print(json.dumps({'ok':True, **main(request)}))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)}))
    sys.exit(1)
