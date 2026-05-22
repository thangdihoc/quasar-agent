import urllib.request
import urllib.error
import json

import os

openrouter_api_key = os.environ.get("OPENROUTER_API_KEY", "")
url = "https://openrouter.ai/api/v1/chat/completions"

payload = {
    "model": "google/gemini-2.5-flash",
    "messages": [
        {
            "role": "user",
            "content": "Say hello in Vietnamese."
        }
    ]
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {openrouter_api_key}",
        "HTTP-Referer": "https://github.com/quasar-agent/quasar",
        "X-Title": "Quasar Agent"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as response:
        res_body = response.read()
        res_data = json.loads(res_body.decode("utf-8"))
        print("Success:")
        print(json.dumps(res_data, indent=2, ensure_ascii=False))
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code} - {e.reason}")
    print(e.read().decode("utf-8"))
except Exception as e:
    print(f"Error: {e}")
