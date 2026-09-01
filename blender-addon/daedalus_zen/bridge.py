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

