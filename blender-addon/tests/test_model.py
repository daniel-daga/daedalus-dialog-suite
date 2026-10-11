import unittest

from daedalus_zen.model import SessionModel


class ModelTests(unittest.TestCase):
    def test_transform_change_uses_stable_vob_path_and_marks_session_dirty(self):
        model = SessionModel('session-1', [{'path': '0/2', 'position': (1, 2, 3), 'rotation': (1,) * 9}])
        request = model.transform_request('0/2', (4, 5, 6), (1,) * 9)
        self.assertEqual(request['method'], 'setVobTransform')
        self.assertEqual(request['params']['sessionId'], 'session-1')
        self.assertEqual(request['params']['path'], '0/2')
        self.assertTrue(model.dirty)

    def test_scale_and_arbitrary_deletion_are_not_supported(self):
        model = SessionModel('session-1', [])
        with self.assertRaisesRegex(ValueError, 'scale'):
            model.assert_scale((1, 1, 2))
        with self.assertRaisesRegex(ValueError, 'deletion'):
            model.delete_request('0/2')

