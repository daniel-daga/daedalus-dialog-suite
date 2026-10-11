"""Daedalus Zen world editor for Blender."""

bl_info = {
    'name': 'Daedalus Zen World Editor',
    'blender': (4, 2, 0),
    'category': 'Import-Export',
}


try:
    import bpy
except ModuleNotFoundError:
    bpy = None


if bpy:
    class DAEDALUS_OT_open_world(bpy.types.Operator):
        bl_idname = 'import_scene.daedalus_zen_world'
        bl_label = 'Open Gothic World'
        def execute(self, _context):
            self.report({'INFO'}, 'Blender bridge import is not wired yet')
            return {'FINISHED'}

    class DAEDALUS_OT_save_world(bpy.types.Operator):
        bl_idname = 'export_scene.daedalus_zen_world'
        bl_label = 'Save Gothic World'
        def execute(self, _context):
            self.report({'INFO'}, 'Blender bridge save is not wired yet')
            return {'FINISHED'}

    _CLASSES = (DAEDALUS_OT_open_world, DAEDALUS_OT_save_world)
else:
    _CLASSES = ()


def register():
    if not bpy: raise RuntimeError('register() requires Blender')
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    if not bpy: return
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
