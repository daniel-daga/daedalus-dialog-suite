import bpy
import sys

sys.path.insert(0, 'blender-addon')
import daedalus_zen

daedalus_zen.register()
assert hasattr(bpy.ops.import_scene, 'daedalus_zen_world')
assert hasattr(bpy.ops.export_scene, 'daedalus_zen_world')
daedalus_zen.unregister()
print('Daedalus Zen Blender smoke test passed')
