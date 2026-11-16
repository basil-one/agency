import tempfile
import unittest
from pathlib import Path

from scripts.check_seo import audit_site


class CheckSeoTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.site = self.root / "_site"
        self.site.mkdir()
        self.config = self.root / "_config.yml"
        self.config.write_text('url: "https://agency.example"\nbaseurl: ""\n')

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_page(self, content, relative_path="index.html"):
        path = self.site / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_accepts_expected_title_canonical_and_indexable_page(self):
        self.write_page(
            '<html><head><title>Home | Agency</title>'
            '<link rel="canonical" href="https://agency.example/"></head></html>'
        )

        page_count, findings = audit_site(self.site, self.config)

        self.assertEqual(page_count, 1)
        self.assertEqual(findings, [])

    def test_reports_wrong_canonical_with_expected_url_and_remedy(self):
        self.write_page(
            '<title>Reflection</title>'
            '<link rel="canonical" href="https://wrong.example/reflections/example/">',
            "reflections/example/index.html",
        )

        _, findings = audit_site(self.site, self.config)

        self.assertEqual(len(findings), 1)
        self.assertIn("/reflections/example/", findings[0])
        self.assertIn("https://agency.example/reflections/example/", findings[0])
        self.assertIn("_layouts/default.html", findings[0])

    def test_reports_accidental_noindex_with_page_and_remedy(self):
        self.write_page(
            '<title>Home</title><link rel="canonical" href="https://agency.example/">'
            '<meta name="robots" content="index, noindex">'
        )

        _, findings = audit_site(self.site, self.config)

        self.assertEqual(len(findings), 1)
        self.assertIn("/ (index.html)", findings[0])
        self.assertIn("noindex", findings[0])
        self.assertIn("review the indexing intent", findings[0])

    def test_reports_missing_title_and_googlebot_noindex(self):
        self.write_page(
            '<link rel="canonical" href="https://agency.example/">'
            '<meta name="googlebot" content="none">'
        )

        _, findings = audit_site(self.site, self.config)

        self.assertEqual(len(findings), 2)
        self.assertIn("nonempty <title>", findings[0])
        self.assertIn("googlebot", findings[1])
        self.assertIn("none", findings[1])


if __name__ == "__main__":
    unittest.main()
