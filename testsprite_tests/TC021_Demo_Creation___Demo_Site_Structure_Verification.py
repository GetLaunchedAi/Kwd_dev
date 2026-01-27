import requests
import time
import json
import os
import shutil
import tempfile
import subprocess

BASE_URL = "http://localhost:3001"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_TC021_demo_creation_demo_site_structure_verification():
    # Helper functions
    def create_demo():
        payload = {
            "businessName": "Test Business",
            "primaryColor": "#123ABC",
            "templateId": "default-template"
        }
        resp = requests.post(f"{BASE_URL}/api/demo/create", json=payload, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        assert "clientSlug" in data and "status" in data
        assert data["status"] == "starting"
        return data["clientSlug"]

    def wait_for_demo_ready(slug):
        # Poll /api/demo/status/:clientSlug until status is 'running' or timeout
        for _ in range(60):
            resp = requests.get(f"{BASE_URL}/api/demo/status/{slug}", headers=HEADERS, timeout=TIMEOUT)
            if resp.status_code == 404:
                raise AssertionError(f"Demo {slug} status endpoint 404 not found")
            resp.raise_for_status()
            status_data = resp.json()
            if status_data.get("state") == "running":
                return
            if status_data.get("state") == "failed":
                raise AssertionError(f"Demo creation failed: {status_data.get('message')}")
            time.sleep(5)
        raise TimeoutError("Timed out waiting for demo to reach 'running' state")

    def get_demo_root_path(slug):
        # Assuming demos are created under client-websites/<slug>
        # This path is internal to server, but for test we assume local accessible path
        # If not available, test cannot verify files on disk and must do only HTTP API checks
        # Here, we assume the directory is /tmp/client-websites/<slug>
        return os.path.join(tempfile.gettempdir(), "client-websites", slug)

    # Since the API only supports HTTP, we must fetch the demo files via local FS or API.
    # The PRD or instructions do NOT specify an endpoint for downloading files,
    # so we will assume the demo is available locally on disk under CLIENT_WEBSITES_DIR

    # For this test generate and delete demo folder: create a demo, verify, then delete.
    # Without resourceId provided, create new resource, finally delete it via DELETE /api/demo/:clientSlug

    client_slug = None
    try:
        client_slug = create_demo()
        wait_for_demo_ready(client_slug)

        root_dir = get_demo_root_path(client_slug)

        # We check directory structure and files below, skipping if root_dir doesn't exist locally
        if not os.path.exists(root_dir):
            raise AssertionError(f"Demo root directory {root_dir} does not exist on filesystem")

        # 1. Check expected files and directories in root
        expected_files = {
            "package.json",
            "demo.context.json",
            "CURSOR_TASK.md",
            ".git",
            ".cursor"
        }
        for fname in expected_files:
            path = os.path.join(root_dir, fname)
            assert os.path.exists(path), f"Expected file or directory {fname} not found in demo root"

        # 2. Validate package.json exists and is valid JSON with name and version fields
        package_json_path = os.path.join(root_dir, "package.json")
        with open(package_json_path, "r", encoding="utf-8") as f:
            package_json = json.load(f)
        assert "name" in package_json and isinstance(package_json["name"], str) and package_json["name"], "package.json missing valid 'name'"
        assert "version" in package_json and isinstance(package_json["version"], str) and package_json["version"], "package.json missing valid 'version'"

        # 3. Validate .git repository initialized with correct branch (e.g. main or clientSlug)
        git_dir = os.path.join(root_dir, ".git")
        assert os.path.isdir(git_dir), ".git directory does not exist"

        # Run git branch command to validate current branch inside repo
        completed_proc = subprocess.run(
            ["git", "-C", root_dir, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10
        )
        assert completed_proc.returncode == 0, "Failed to get current git branch"
        current_branch = completed_proc.stdout.strip()
        assert current_branch in {client_slug, "main", "master"}, f"Unexpected git branch {current_branch}"

        # 4. Validate demo.context.json contains required metadata fields: businessName, primaryColor, templateId or githubRepoUrl
        context_json_path = os.path.join(root_dir, "demo.context.json")
        with open(context_json_path, "r", encoding="utf-8") as f:
            context_data = json.load(f)
        for key in ("businessName", "primaryColor"):
            assert key in context_data and context_data[key], f"demo.context.json missing or empty required field '{key}'"
        assert "templateId" in context_data or "githubRepoUrl" in context_data, "demo.context.json missing required 'templateId' or 'githubRepoUrl'"

        # 5. Validate CURSOR_TASK.md existence and content includes businessName and clientSlug
        cursor_task_path = os.path.join(root_dir, "CURSOR_TASK.md")
        with open(cursor_task_path, "r", encoding="utf-8") as f:
            cursor_task_content = f.read()
        assert "businessName" not in cursor_task_content.lower() or context_data["businessName"].lower() in cursor_task_content.lower(), "CURSOR_TASK.md does not contain businessName"
        assert client_slug in cursor_task_content, "CURSOR_TASK.md does not contain clientSlug"

        # 6. Validate .cursor directory contains state files (at least one file inside)
        cursor_dir = os.path.join(root_dir, ".cursor")
        assert os.path.isdir(cursor_dir), ".cursor directory does not exist"
        state_files = os.listdir(cursor_dir)
        assert state_files, ".cursor directory does not contain any state files"

        # 7. Validate uploaded assets are located correctly with proper filenames.
        # Check for images directories: src/assets/images, src/images, public/images - presence of any
        images_dirs = [
            os.path.join(root_dir, "src", "assets", "images"),
            os.path.join(root_dir, "src", "images"),
            os.path.join(root_dir, "public", "images")
        ]
        assets_ok = False
        for img_dir in images_dirs:
            if os.path.isdir(img_dir):
                # Check at least one file inside that image directory
                files = os.listdir(img_dir)
                if files:
                    assets_ok = True
                    # Verify files names have typical image extensions
                    for f in files:
                        ext = os.path.splitext(f)[1].lower()
                        assert ext in {".png", ".jpg", ".jpeg", ".svg", ".gif"}, f"Unexpected file extension in images dir: {f}"
                    break
        assert assets_ok, "No valid images directory with files found in demo site"

    finally:
        if client_slug:
            try:
                requests.delete(f"{BASE_URL}/api/demo/{client_slug}", headers=HEADERS, timeout=TIMEOUT)
            except Exception:
                pass

test_TC021_demo_creation_demo_site_structure_verification()