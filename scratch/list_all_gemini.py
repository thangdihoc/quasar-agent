import urllib.request
import json

import os

google_api_key = os.environ.get("GEMINI_API_KEY", "")
url = f"https://generativelanguage.googleapis.com/v1beta/models?key={google_api_key}"

try:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        res_body = response.read()
        res_data = json.loads(res_body.decode("utf-8"))
        models = res_data.get("models", [])
        for m in models:
            name = m.get("name")
            if "gemini" in name:
                print(name)
except Exception as e:
    print(f"Error: {e}")
