import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("package_release", Path(__file__).with_name("package-release.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageReleaseTests(unittest.TestCase):
    def test_bundle_contains_only_allowlisted_files_and_no_generated_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "compose"
            source.mkdir()
            (source / ".env.CI").write_text("API_IMAGE=api:test\nWEB_IMAGE=web:test\nAPI_PORT=8080\nPOSTGRES_PASSWORD=never-ship-this\n")
            (source / "docker-compose.yaml").write_text("name: detour\n")
            destination = root / "release"
            with patch.object(module.subprocess, "check_output", return_value="linux/amd64"), patch.object(module.subprocess, "run") as run:
                module.package(source, "a" * 40, destination)
            self.assertEqual(1, run.call_count)
            self.assertEqual({"docker-compose.yaml", "compose.production.yaml", "apply-release.sh", "images.env"}, {p.name for p in destination.iterdir()})
            self.assertNotIn("never-ship-this", (destination / "images.env").read_text())
            self.assertIn("detour-api:" + "a" * 40, (destination / "images.env").read_text())

    def test_invalid_release_never_reaches_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.CI").write_text("API_IMAGE=--help\nWEB_IMAGE=web:test\nAPI_PORT=8080\n")
            with patch.object(module.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    module.package(root, "not-a-commit", root / "release")
                run.assert_not_called()

    def test_existing_directory_is_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.CI").write_text("API_IMAGE=api:test\nWEB_IMAGE=web:test\nAPI_PORT=8080\n")
            with self.assertRaises(FileExistsError):
                module.package(root, "a" * 40, root)


if __name__ == "__main__":
    unittest.main()
