#!/usr/bin/env python3
import json, sys, zipfile, shutil, tempfile
from pathlib import Path
from xml.etree import ElementTree as ET
from PIL import Image

MIMETYPE='image/openraster'
VERSION='0.0.6'

def write_ora(req):
    output=Path(req['output']); output.parent.mkdir(parents=True,exist_ok=True)
    width=int(req['width']); height=int(req['height']); layers=req['layers']
    image=ET.Element('image', {'version':VERSION,'w':str(width),'h':str(height),'name':req.get('name','EveAtelier Document')})
    stack=ET.SubElement(image,'stack',{'name':'root'})
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        merged=Image.new('RGBA',(width,height),(0,0,0,0))
        layer_entries=[]
        for i,layer in enumerate(layers):
            src=Path(layer['src']); arc=f'data/layer{i:03d}.png'
            attrs={'name':str(layer.get('name',f'Layer {i+1}')),'src':arc}
            attrs['visibility']='visible' if layer.get('visible',True) else 'hidden'
            attrs['opacity']=str(float(layer.get('opacity',1.0)))
            x=int(layer.get('x',0)); y=int(layer.get('y',0))
            if x: attrs['x']=str(x)
            if y: attrs['y']=str(y)
            ET.SubElement(stack,'layer',attrs)
            layer_entries.append((src,arc))
            if layer.get('visible',True):
                li=Image.open(src).convert('RGBA')
                if float(layer.get('opacity',1.0))<1:
                    a=li.getchannel('A').point(lambda v: int(v*float(layer.get('opacity',1.0))))
                    li.putalpha(a)
                merged.alpha_composite(li,(x,y))
        stack_xml=ET.tostring(image,encoding='utf-8',xml_declaration=True)
        merged_path=td/'mergedimage.png'; merged.save(merged_path)
        thumb=merged.copy(); thumb.thumbnail((256,256),Image.Resampling.LANCZOS)
        thumb_path=td/'thumbnail.png'; thumb.save(thumb_path)
        with zipfile.ZipFile(output,'w') as z:
            zi=zipfile.ZipInfo('mimetype'); zi.compress_type=zipfile.ZIP_STORED
            z.writestr(zi,MIMETYPE.encode('ascii'))
            z.writestr('stack.xml',stack_xml,compress_type=zipfile.ZIP_DEFLATED)
            z.write(merged_path,'mergedimage.png',compress_type=zipfile.ZIP_DEFLATED)
            z.write(thumb_path,'Thumbnails/thumbnail.png',compress_type=zipfile.ZIP_DEFLATED)
            for src,arc in layer_entries:
                z.write(src,arc,compress_type=zipfile.ZIP_DEFLATED)
    return {'layerCount':len(layers)}

def inspect_ora(path):
    with zipfile.ZipFile(path,'r') as z:
        names=z.namelist(); mime=z.read('mimetype').decode('ascii')
        first=names[0]=='mimetype'
        stored=z.getinfo('mimetype').compress_type==zipfile.ZIP_STORED
        root=ET.fromstring(z.read('stack.xml'))
        layers=[]
        stack=root.find('stack')
        for elem in stack.findall('layer') if stack is not None else []:
            layers.append({
                'name':elem.attrib.get('name',''),
                'src':elem.attrib.get('src',''),
                'visibility':elem.attrib.get('visibility','visible'),
                'opacity':float(elem.attrib.get('opacity','1')),
                'x':int(elem.attrib.get('x','0')),
                'y':int(elem.attrib.get('y','0')),
            })
        return {
            'mimetype':mime,
            'version':root.attrib.get('version'),
            'size':{'width':int(root.attrib['w']),'height':int(root.attrib['h'])},
            'layers':layers,
            'mimetypeFirst':first,
            'mimetypeStored':stored,
        }

def main(req):
    action=req['action']
    if action=='write': return write_ora(req)
    if action=='inspect': return inspect_ora(req['path'])
    raise ValueError('unsupported_action')

try:
    req=json.load(sys.stdin)
    print(json.dumps({'ok':True,'result':main(req)}))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)})); sys.exit(1)
