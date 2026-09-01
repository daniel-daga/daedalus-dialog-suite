import unittest

from daedalus_zen.bridge import decode_frame, encode_frame


class BridgeTests(unittest.TestCase):
    def test_frames_are_little_endian_json(self):
        frame = encode_frame({'id': 1, 'method': 'ping'})
        self.assertEqual(decode_frame(frame), {'id': 1, 'method': 'ping'})

