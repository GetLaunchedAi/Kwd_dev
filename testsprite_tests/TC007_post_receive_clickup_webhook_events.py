import requests

def test_post_receive_clickup_webhook_events():
    base_url = "http://localhost:3001"
    endpoint = "/webhook/clickup"
    url = base_url + endpoint

    headers = {
        "Content-Type": "application/json"
    }

    payload = {
        "event": "taskCreated",
        "task_id": "123456789",
        "webhook_id": "abcdef123456"
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
        # Additional content validation can be done here if API returns content.
    except requests.exceptions.RequestException as e:
        assert False, f"Request failed: {e}"

test_post_receive_clickup_webhook_events()