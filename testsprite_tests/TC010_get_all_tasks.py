import requests

def test_get_all_tasks():
    base_url = "http://localhost:3001"
    url = f"{base_url}/api/tasks"
    headers = {
        "Accept": "application/json"
    }
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), f"Expected response body to be a list but got {type(data)}"
    except requests.exceptions.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_all_tasks()