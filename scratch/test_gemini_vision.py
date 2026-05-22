import urllib.request
import urllib.error
import json
import base64
import io
import mss
from PIL import Image

import os

google_api_key = os.environ.get("GEMINI_API_KEY", "")
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={google_api_key}"

def take_screenshot() -> str:
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        raw = sct.grab(monitor)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        max_dim = 1280
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80)
        return base64.b64encode(buffer.getvalue()).decode()

system_prompt = """You are a computer use agent. You can see the user's screen and control it.
Analyze the screenshot and decide what action to take to complete the task.
Respond with a JSON object containing the action to perform.

Available actions:
- {"type": "click", "x": 100, "y": 200} — Click at coordinates
- {"type": "double_click", "x": 100, "y": 200}
- {"type": "right_click", "x": 100, "y": 200}
- {"type": "type", "text": "hello"} — Type text
- {"type": "press", "key": "enter"} — Press a key
- {"type": "hotkey", "keys": ["ctrl", "c"]} — Key combo
- {"type": "scroll", "amount": -3} — Scroll (negative=down)
- {"type": "move", "x": 100, "y": 200}
- {"type": "done"} — Task is complete

Respond ONLY with the JSON action object, no explanation."""

b64 = take_screenshot()

payload = {
    "contents": [
        {
            "parts": [
                {
                    "text": "Task: Bật Chrome và xem giá vàng hôm nay\nStep 1. What action should I take?"
                },
                {
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": b64
                    }
                }
            ]
        }
    ],
    "systemInstruction": {
        "parts": [
            {
                "text": system_prompt
            }
        ]
    },
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
        print(res_data["candidates"][0]["content"]["parts"][0]["text"].strip())
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code} - {e.reason}")
    print(e.read().decode("utf-8"))
except Exception as e:
    print(f"Error: {e}")
