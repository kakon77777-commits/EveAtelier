from PIL import Image, ImageDraw
import sys
path=sys.argv[1]
kind=sys.argv[2]
if kind=='subject':
    im=Image.new('RGBA',(16,16),(255,255,255,255))
    d=ImageDraw.Draw(im)
    d.rectangle((4,3,11,12), fill=(200,40,40,255))
    d.rectangle((6,1,9,4), fill=(180,30,30,255))
elif kind=='overlay':
    im=Image.new('RGBA',(8,8),(0,0,255,128))
else:
    im=Image.new('RGBA',(8,8),(20,40,60,255))
im.save(path)
