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
