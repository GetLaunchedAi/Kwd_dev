import requests
import json
import os
import tempfile
import mimetypes

BASE_URL = "http://localhost:3001"
TIMEOUT = 30
HEADERS = {
    "Content-Type": "application/json"
}

def test_demo_creation_file_organization_and_asset_processing():
    # Prepare demo creation payload with logo and heroImage files
    # Since we have no direct schema, assume POST /api/demo/create accepts multipart/form-data
    # with fields businessName, primaryColor, templateId and files logo, heroImage.
    # We will create temporary image files for upload, with supported and unsupported formats to test validations.

    # Setup temp files for upload
    supported_logo_path = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    supported_logo_path.write(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
    supported_logo_path.flush()
    supported_logo_path.close()

    supported_hero_path = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    supported_hero_path.write(b"\xff\xd8\xff\xe0\x00\x10JFIF")
    supported_hero_path.flush()
    supported_hero_path.close()

    unsupported_file_path = tempfile.NamedTemporaryFile(suffix=".exe", delete=False)
    unsupported_file_path.write(b"MZP")
    unsupported_file_path.flush()
    unsupported_file_path.close()

    demo_payload = {
        "businessName": "Test Demo Organization",
        "primaryColor": "#123abc",
        "templateId": "template-basic"
    }

    files = {
        "logo": (os.path.basename(supported_logo_path.name), open(supported_logo_path.name, "rb"), mimetypes.guess_type(supported_logo_path.name)[0]),
        "heroImage": (os.path.basename(supported_hero_path.name), open(supported_hero_path.name, "rb"), mimetypes.guess_type(supported_hero_path.name)[0]),
    }

    # Step 1: Create demo with supported file uploads
    create_response = None
    demo_slug = None
    try:
        create_response = requests.post(
            f"{BASE_URL}/api/demo/create",
            data=demo_payload,
            files=files,
            timeout=TIMEOUT
        )
        # Close opened files after request
        for f in files.values():
            f[1].close()

        assert create_response.status_code == 200, f"Expected 200 OK, got {create_response.status_code}"
        create_resp_json = create_response.json()
        assert "clientSlug" in create_resp_json, "Response missing clientSlug"
        assert "status" in create_resp_json and create_resp_json["status"] == "starting", "Status must be 'starting'"
        demo_slug = create_resp_json["clientSlug"]
        
        # Wait or poll for the demo creation to complete file organization and asset processing steps.
        # Poll the status endpoint until status is 'organizing' or beyond and no error.
        import time
        max_wait = 180
        interval = 5
        elapsed = 0
        status = None
        while elapsed < max_wait:
            status_resp = requests.get(f"{BASE_URL}/api/demo/status/{demo_slug}", timeout=TIMEOUT)
            assert status_resp.status_code == 200, "Status endpoint failed"
            status_json = status_resp.json()
            status = status_json.get("state")
            if status in ["organizing", "prompting", "triggering", "running", "completed"]:
                break
            if status == "failed":
                raise AssertionError(f"Demo creation failed: {status_json.get('message')}")
            time.sleep(interval)
            elapsed += interval
        else:
            raise TimeoutError("Demo creation file organization did not start in expected time")

        # Step 2: Verify demo directory structure and files
        # GET /api/demo/files/:clientSlug to list files (assuming such endpoint exists)
        files_list_resp = requests.get(f"{BASE_URL}/api/demo/files/{demo_slug}", timeout=TIMEOUT)
        assert files_list_resp.status_code == 200, "Files listing endpoint failed"
        files_list = files_list_resp.json()
        # Verify images directories presence
        image_dirs = [
            "src/assets/images",
            "src/images",
            "public/images"
        ]
        found_image_dir = any(d in files_list.get("directories", []) for d in image_dirs)
        assert found_image_dir, "No images directory created in expected locations"

        # Verify logo and heroImage files moved to correct location
        # We check for the uploaded file names inside the image dir
        uploaded_files_found = False
        for img_dir in image_dirs:
            imgs_in_dir = files_list.get("files_by_directory", {}).get(img_dir, [])
            logo_name = os.path.basename(supported_logo_path.name)
            hero_name = os.path.basename(supported_hero_path.name)
            if logo_name in imgs_in_dir and hero_name in imgs_in_dir:
                uploaded_files_found = True
                break
        assert uploaded_files_found, "Uploaded logo and heroImage files not found in images directory"

        # Verify demo.context.json exists and contains all metadata including logo and heroImage info
        demo_context_resp = requests.get(f"{BASE_URL}/api/demo/context/{demo_slug}", timeout=TIMEOUT)
        assert demo_context_resp.status_code == 200, "demo.context.json retrieval failed"
        demo_context = demo_context_resp.json()
        # Basic metadata checks
        assert demo_context.get("businessName") == demo_payload["businessName"], "businessName mismatch in demo.context.json"
        assert demo_context.get("primaryColor") == demo_payload["primaryColor"], "primaryColor mismatch in demo.context.json"
        assert "logo" in demo_context and demo_context["logo"].endswith(logo_name), "Logo info missing or incorrect in demo.context.json"
        assert "heroImage" in demo_context and demo_context["heroImage"].endswith(hero_name), "heroImage info missing or incorrect in demo.context.json"

        # Step 3: Test upload with unsupported file extension and verify validation error
        files_unsupported = {
            "logo": (os.path.basename(unsupported_file_path.name), open(unsupported_file_path.name, "rb"), mimetypes.guess_type(unsupported_file_path.name)[0] or "application/octet-stream"),
            "heroImage": (os.path.basename(supported_hero_path.name), open(supported_hero_path.name, "rb"), mimetypes.guess_type(supported_hero_path.name)[0])
        }
        unsupported_payload = demo_payload.copy()
        unsupported_payload["businessName"] = "Test Demo Invalid File"

        unsupported_resp = requests.post(
            f"{BASE_URL}/api/demo/create",
            data=unsupported_payload,
            files=files_unsupported,
            timeout=TIMEOUT
        )
        for f in files_unsupported.values():
            f[1].close()

        # Expecting error due to unsupported file extension
        assert unsupported_resp.status_code == 400 or unsupported_resp.status_code == 422, \
            f"Expected 400/422 for unsupported file format, got {unsupported_resp.status_code}"
        err_json = unsupported_resp.json()
        assert ("error" in err_json or "message" in err_json), "Error response should contain error details"

    finally:
        # Cleanup uploaded temp files
        for path in [supported_logo_path.name, supported_hero_path.name, unsupported_file_path.name]:
            try:
                os.remove(path)
            except Exception:
                pass

        # Try deleting created demo to cleanup after test if created
        if demo_slug:
            try:
                requests.delete(f"{BASE_URL}/api/demo/{demo_slug}", timeout=TIMEOUT)
            except Exception:
                pass

test_demo_creation_file_organization_and_asset_processing()