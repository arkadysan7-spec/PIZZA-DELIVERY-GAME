# פיילוט יפו – מגדל השעון. להריץ ב-Blender 4.2 (Scripting > Open > Run Script)
# מייבא מ-OSM דרך Blosm, מעצב לואו-פולי בהיר, ומייצא ל-assets/jaffa.glb
import bpy, bmesh, math, os, random
from mathutils import Vector

# --- אזור: ממורכז על מגדל השעון (~800x700 מ') ---
TOWER = (32.05466, 34.75628)
HALF_LAT, HALF_LON = 0.0032, 0.0042
OUT = r"D:\CLAUDE\01_עיצוב\Pizza 4 The People\delivery-game\assets\jaffa.glb"

PALETTE = [(0.93,0.86,0.72),(0.96,0.92,0.82),(0.89,0.78,0.60),(0.98,0.95,0.88),(0.85,0.74,0.58)]
ROAD_W = {'primary':9,'secondary':8,'tertiary':7,'residential':6,'unclassified':6,'service':4,
          'living_street':5,'pedestrian':5,'footway':2.5,'path':2,'steps':2.5,'cycleway':2.5}

def mat(name, rgb, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    return m

# 1. סצנה נקייה
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()

# 2. הורדת OSM מה-API הראשי (Overpass לפעמים נופל) + ייבוא Blosm מקובץ
import urllib.request
OSM = r"D:\CLAUDE\blosm_data\jaffa_pilot.osm"
os.makedirs(os.path.dirname(OSM), exist_ok=True)
if not os.path.exists(OSM) or os.path.getsize(OSM) < 1000:
    url = ("https://api.openstreetmap.org/api/0.6/map?bbox=%.5f,%.5f,%.5f,%.5f" %
           (TOWER[1]-HALF_LON, TOWER[0]-HALF_LAT, TOWER[1]+HALF_LON, TOWER[0]+HALF_LAT))
    req = urllib.request.Request(url, headers={"User-Agent": "P4TP-delivery-game/1.0"})
    open(OSM, "wb").write(urllib.request.urlopen(req, timeout=120).read())
print("OSM file:", OSM, os.path.getsize(OSM)//1024, "KB")
s = bpy.context.scene.blosm
for k, v in dict(dataType='osm', osmSource='file', osmFilepath=OSM, mode='3Dsimple',
                 minLat=TOWER[0]-HALF_LAT, maxLat=TOWER[0]+HALF_LAT,
                 minLon=TOWER[1]-HALF_LON, maxLon=TOWER[1]+HALF_LON,
                 buildings=True, highways=True, water=True, forests=False, vegetation=False,
                 railways=False, singleObject=False, ignoreGeoreferencing=True).items():
    try: setattr(s, k, v)
    except Exception as e: print("blosm prop skip", k, e)
bpy.ops.blosm.import_data()
print("IMPORTED:", [(o.name, o.type) for o in bpy.context.scene.objects][:40])

# 3. כל בניין = אובייקט נפרד (המשחק בונה התנגשות מתיבה לכל mesh)
def separate_loose(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    if o.data.polygons and (o.dimensions.z > 2):
        separate_loose(o)

# 4. כבישים: קווי OSM -> רצועות שטוחות
road_m, walk_m = mat("road", (0.42,0.42,0.44)), mat("walk", (0.80,0.74,0.64))
def ribbons(o):
    hw = (o.get("highway") or o.name).lower()
    w = next((v for k, v in ROAD_W.items() if k in hw), 6)
    if o.type == 'CURVE':
        c = o.data; c.bevel_depth = 0; c.extrude = 0; c.bevel_object = None; c.offset = 0
    bm = bmesh.new()
    dg = bpy.context.evaluated_depsgraph_get(); ev = o.evaluated_get(dg); src = ev.to_mesh()
    mw = o.matrix_world
    pts = [mw @ v.co for v in src.vertices]
    z = 0.02 if w >= 4 else 0.03
    for e in src.edges:
        a, b = pts[e.vertices[0]], pts[e.vertices[1]]
        d = (b - a); d.z = 0
        if d.length < 1e-3: continue
        n = Vector((-d.y, d.x, 0)).normalized() * (w/2)
        vs = [bm.verts.new((p.x, p.y, z)) for p in (a+n, b+n, b-n, a-n)]
        bm.faces.new(vs)
    for p in pts:  # עיגולי חיבור בצמתים
        vs = [bm.verts.new((p.x + w/2*math.cos(t), p.y + w/2*math.sin(t), z)) for t in [i*math.pi/4 for i in range(8)]]
        bm.faces.new(vs)
    ev.to_mesh_clear()
    me = bpy.data.meshes.new(o.name + "_road"); bm.to_mesh(me); bm.free()
    r = bpy.data.objects.new(o.name + "_road", me); bpy.context.collection.objects.link(r)
    r.data.materials.append(road_m if w >= 4 else walk_m)
    bpy.data.objects.remove(o)

for o in list(bpy.context.scene.objects):
    if o.type == 'CURVE' or (o.type == 'MESH' and len(o.data.polygons) == 0 and len(o.data.edges) > 0):
        ribbons(o)

# 5. חומרים לבניינים; משטחים שטוחים אחרים = ריצוף
plaza_m = mat("plaza", (0.90,0.85,0.75))
bmats = [mat(f"stone{i}", c) for i, c in enumerate(PALETTE)]
random.seed(7)
for o in bpy.context.scene.objects:
    if o.type != 'MESH' or o.name.endswith("_road"): continue
    o.data.materials.clear()
    o.data.materials.append(random.choice(bmats) if o.dimensions.z > 1.5 else plaza_m)
    for p in o.data.polygons: p.use_smooth = False

# 5b. ים מקו החוף של OSM (natural=coastline; היבשה משמאל לכיוון הקו)
import xml.etree.ElementTree as ET
sc = bpy.context.scene
lat0, lon0 = sc.get("lat", TOWER[0]), sc.get("lon", TOWER[1])
R = 6378137.0
def xy(lat, lon):
    return ((lon-lon0)*math.cos(math.radians(lat0))*R*math.pi/180, (lat-lat0)*R*math.pi/180)
root = ET.parse(OSM).getroot()
nodes = {n.get("id"): (float(n.get("lat")), float(n.get("lon"))) for n in root.iter("node")}
ways = []
for w in root.iter("way"):
    if any(t.get("k") == "natural" and t.get("v") == "coastline" for t in w.iter("tag")):
        ways.append([nd.get("ref") for nd in w.iter("nd") if nd.get("ref") in nodes])
chain = ways.pop(0) if ways else []
changed = True
while ways and changed:
    changed = False
    for w in ways:
        if w[0] == chain[-1]: chain += w[1:]; ways.remove(w); changed = True; break
        if w[-1] == chain[0]: chain = w[:-1] + chain; ways.remove(w); changed = True; break
print("coastline nodes:", len(chain), "unjoined ways:", len(ways))
if len(chain) > 2:
    pts = [xy(*nodes[i]) for i in chain]
    # היבשה משמאל -> הים מימין. סוגרים את הפוליגון דרך המערב הרחוק
    W = -3000
    poly = pts + [(W, pts[-1][1]), (W, pts[0][1])]
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0.005)) for x, y in poly]
    f = bm.faces.new(vs); bmesh.ops.triangulate(bm, faces=[f])
    me = bpy.data.meshes.new("sea"); bm.to_mesh(me); bm.free()
    so = bpy.data.objects.new("sea", me); bpy.context.collection.objects.link(so)
    so.data.materials.append(mat("sea", (0.18,0.50,0.71), 0.3))

# 6. קרקע (חול-אבן)
bpy.ops.mesh.primitive_plane_add(size=1600, location=(0, 0, -0.01))
bpy.context.object.name = "ground"; bpy.context.object.data.materials.append(mat("ground", (0.86,0.80,0.68)))

# 7. ייצוא
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True,
                          export_yup=True, export_cameras=False, export_lights=False)
n_b = sum(1 for o in bpy.context.scene.objects if o.type=='MESH' and o.dimensions.z > 2)
print(f"DONE -> {OUT}  buildings={n_b}  size={os.path.getsize(OUT)//1024}KB")
