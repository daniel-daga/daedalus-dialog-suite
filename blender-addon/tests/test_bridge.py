import unittest

from daedalus_zen.bridge import BridgeClient, FrameReader, decode_frame, encode_frame


class BridgeTests(unittest.TestCase):
    def test_frames_are_little_endian_json(self):
        frame = encode_frame({'id': 1, 'method': 'ping'})
        self.assertEqual(decode_frame(frame), {'id': 1, 'method': 'ping'})

    def test_reader_retains_partial_frames(self):
        frame = encode_frame({'id': 2})
        reader = FrameReader()
        self.assertEqual(reader.push(frame[:5]), [])
        self.assertEqual(reader.push(frame[5:]), [{'id': 2}])

    def test_client_assigns_request_ids_and_resolves_a_response(self):
        client = BridgeClient()
        request = client.request_frame('ping')
        self.assertEqual(decode_frame(request)['id'], 1)
        self.assertEqual(client.receive(encode_frame({'id': 1, 'result': {'ok': True}})), {'ok': True})
