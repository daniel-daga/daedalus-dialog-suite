"""Framed JSON helpers shared by the Blender bridge client."""

import json
import struct


def encode_frame(value):
    payload = json.dumps(value, separators=(',', ':')).encode('utf-8')
    return struct.pack('<I', len(payload)) + payload


def decode_frame(frame):
    (length,) = struct.unpack('<I', frame[:4])
    if length != len(frame) - 4:
        raise ValueError('invalid frame length')
    return json.loads(frame[4:].decode('utf-8'))


class FrameReader:
    def __init__(self):
        self._pending = b''

    def push(self, chunk):
        data = self._pending + chunk
        values = []
        offset = 0
        while len(data) - offset >= 4:
            (length,) = struct.unpack('<I', data[offset:offset + 4])
            if len(data) - offset - 4 < length:
                break
            values.append(decode_frame(data[offset:offset + 4 + length]))
            offset += 4 + length
        self._pending = data[offset:]
        return values


class BridgeClient:
    """Request correlation; process I/O is supplied by the Blender adapter."""
    def __init__(self):
        self._next_id = 1
        self._pending = {}
        self._reader = FrameReader()

    def request_frame(self, method, params=None):
        request_id = self._next_id
        self._next_id += 1
        self._pending[request_id] = None
        return encode_frame({'id': request_id, 'version': 1, 'method': method, 'params': params or {}})

    def receive(self, data):
        frames = self._reader.push(data)
        if not frames:
            return None
        frame = frames[0]
        if frame['id'] not in self._pending:
            raise ValueError('unknown bridge response')
        del self._pending[frame['id']]
        if 'error' in frame:
            raise RuntimeError(frame['error']['message'])
        return frame['result']
