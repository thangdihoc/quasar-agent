import urllib.request
import urllib.error
import json
import os

google_api_key = os.environ.get("GEMINI_API_KEY", "")
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={google_api_key}"

payload = {
    "contents": [
        {
            "parts": [
                {
                    "text": "Say hello in Vietnamese."
                }
            ]
        }
    ],
    "generationConfig": {
        "responseMimeType": "application/json"
    }
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
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
