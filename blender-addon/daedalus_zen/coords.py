"""ZenGin centimetre coordinates to Blender metres under the mirrored X root."""


def zen_to_blender(position):
    x, y, z = position
    return (-x / 100.0, y / 100.0, z / 100.0)


def blender_to_zen(position):
    x, y, z = position
    return (-x * 100.0, y * 100.0, z * 100.0)

