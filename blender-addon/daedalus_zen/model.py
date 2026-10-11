"""Blender-independent session state for projected VOBs."""


class SessionModel:
    def __init__(self, session_id, vobs):
        self.session_id = session_id
        self.vobs = {vob['path']: dict(vob) for vob in vobs}
        self.dirty = False

    def transform_request(self, path, position, rotation):
        if path not in self.vobs:
            raise ValueError('unknown VOB path')
        self.dirty = True
        return {
            'method': 'setVobTransform',
            'params': {'sessionId': self.session_id, 'path': path, 'position': list(position), 'rotation': list(rotation)},
        }

    @staticmethod
    def assert_scale(scale):
        if tuple(scale) != (1, 1, 1):
            raise ValueError('VOB scale is not supported')

    @staticmethod
    def delete_request(_path):
        raise ValueError('arbitrary VOB deletion is not supported')

