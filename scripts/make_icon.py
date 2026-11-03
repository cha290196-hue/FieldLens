from pathlib import Path
from PIL import Image, ImageDraw

S = 4
base = Image.new("RGBA", (256*S, 256*S), (0,0,0,0))
d = ImageDraw.Draw(base)
def rect(b, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(tuple(int(x*S) for x in b), radius=int(r*S),
                        fill=fill, outline=outline, width=int(width*S))
rect((2,2,254,254),60,"#24313a")
rect((71,71,118,118),11,None,"#f7f2e9",8)
d.ellipse((int(144*S),int(71*S),int(199*S),int(126*S)), fill="#d9a576")
d.ellipse((int(71*S),int(144*S),int(126*S),int(199*S)), outline="#f7f2e9",width=8*S)
rect((144,144,191,191),11,None,"#f7f2e9",8)
icon=base.resize((256,256),Image.Resampling.LANCZOS)
Path("build").mkdir(exist_ok=True)
icon.save("build/icon.ico",format="ICO",sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
