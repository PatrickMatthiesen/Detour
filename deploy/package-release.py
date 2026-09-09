"""Package explicitly tagged images and Aspire-generated Compose without copying its generated secret environment file."""
import argparse
import re
import shutil
import subprocess
from pathlib import Path


def package(source: Path, release: str, target: Path):
    if not re.fullmatch(r"[0-9a-f]{40}", release):
        raise ValueError("Release must be a full lowercase Git commit SHA")
    # Refuse to reuse a directory that could contain old files or secrets.
    target.mkdir(parents=True, exist_ok=False)
    images = [f"detour-api:{release}", f"detour-web:{release}"]
    for image in images:
        architecture = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image], text=True).strip()
        if architecture != "linux/amd64":
            raise ValueError("This pipeline currently requires Linux amd64 images and server")
    subprocess.run(["docker", "save", "--output", str(target / "images.tar"), *images], check=True)
    shutil.copyfile(source / "docker-compose.yaml", target / "docker-compose.yaml")
    deploy = Path(__file__).resolve().parent
    for name in ("compose.production.yaml", "apply-release.sh"):
        shutil.copyfile(deploy / name, target / name)
    (target / "images.env").write_text(f"API_IMAGE={images[0]}\nWEB_IMAGE={images[1]}\nAPI_PORT=8080\n", newline="\n")
    print(f"Packaged release {release}; production credentials were not included.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("release")
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    package(args.source, args.release, args.target)
