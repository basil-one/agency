import unittest
from pathlib import Path
from xml.etree import ElementTree


class SvgAssetTests(unittest.TestCase):
    def test_svg_assets_are_well_formed_xml(self):
        assets = Path(__file__).resolve().parents[1] / "assets"
        for path in sorted(assets.rglob("*.svg")):
            with self.subTest(path=path):
                ElementTree.parse(path)
