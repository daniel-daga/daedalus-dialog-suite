import unittest

from daedalus_zen.coords import blender_to_zen, zen_to_blender


class CoordinatesTests(unittest.TestCase):
    def test_position_round_trips_through_blender_metres(self):
        zen = (125.0, -250.0, 37.5)
        self.assertEqual(blender_to_zen(zen_to_blender(zen)), zen)

    def test_mirrors_x_and_converts_centimetres_to_metres(self):
        self.assertEqual(zen_to_blender((100.0, 200.0, 300.0)), (-1.0, 2.0, 3.0))

