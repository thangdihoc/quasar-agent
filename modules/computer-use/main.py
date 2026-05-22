"""
Quasar — Computer Use Module
FastAPI server that receives tasks from the TS core,
uses Claude Vision + pyautogui to control the computer.
"""

import base64
import io
import json
import logging
from contextlib import asynccontextmanager

import anthropic
import mss
import pyautogui
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("computer-use")

# Safety settings for pyautogui
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.3


# --- Models ---
class TaskRequest(BaseModel):
    task: str
    max_steps: int = 20
    api_key: str | None = None
    google_api_key: str | None = None
    openrouter_api_key: str | None = None


class TaskResponse(BaseModel):
    success: bool
    steps: int
    message: str
    screenshots: list[str] = []


class ActionRequest(BaseModel):
    action: str  # click, type, scroll, screenshot, press
    x: int | None = None
    y: int | None = None
    text: str | None = None
    key: str | None = None
    direction: str | None = None  # up, down


# --- Screenshot ---
def take_screenshot() -> str:
    """Capture screen and return base64 encoded JPEG."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # Primary monitor
        raw = sct.grab(monitor)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        # Resize if too large (save tokens)
        max_dim = 1280
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80)
        return base64.b64encode(buffer.getvalue()).decode()


def execute_action(action: dict) -> str:
    """Execute a pyautogui action."""
    action_type = action.get("type", "")

    if action_type == "click":
        x, y = action.get("x", 0), action.get("y", 0)
        pyautogui.click(x, y)
        return f"Clicked ({x}, {y})"
    elif action_type == "double_click":
        x, y = action.get("x", 0), action.get("y", 0)
        pyautogui.doubleClick(x, y)
        return f"Double-clicked ({x}, {y})"
    elif action_type == "right_click":
        x, y = action.get("x", 0), action.get("y", 0)
        pyautogui.rightClick(x, y)
        return f"Right-clicked ({x}, {y})"
    elif action_type == "type":
        text = action.get("text", "")
        pyautogui.typewrite(text, interval=0.02) if text.isascii() else pyautogui.write(text)
        return f"Typed: {text[:50]}"
    elif action_type == "press":
        key = action.get("key", "")
        pyautogui.press(key)
        return f"Pressed: {key}"
    elif action_type == "hotkey":
        keys = action.get("keys", [])
        pyautogui.hotkey(*keys)
        return f"Hotkey: {'+'.join(keys)}"
    elif action_type == "scroll":
        amount = action.get("amount", -3)
        pyautogui.scroll(amount)
        return f"Scrolled: {amount}"
    elif action_type == "move":
        x, y = action.get("x", 0), action.get("y", 0)
        pyautogui.moveTo(x, y)
        return f"Moved to ({x}, {y})"
    elif action_type == "done":
        return "DONE"
    else:
        return f"Unknown action: {action_type}"


# --- App ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Computer Use module started")
    yield
    log.info("Computer Use module stopped")

app = FastAPI(title="Quasar Computer Use", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "module": "computer-use"}


@app.post("/screenshot")
async def screenshot():
    """Take a screenshot and return base64."""
    b64 = take_screenshot()
    return {"screenshot": b64}


@app.post("/action")
async def action(req: ActionRequest):
    """Execute a single action."""
    result = execute_action(req.model_dump())
    return {"result": result}


def call_gemini_api(system_prompt: str, task: str, step: int, b64_image: str, api_key: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"Task: {task}\nStep {step}. What action should I take?"
                    },
                    {
                        "inlineData": {
                            "mimeType": "image/jpeg",
                            "data": b64_image
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
    import urllib.request
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as response:
        res_body = response.read()
        res_data = json.loads(res_body.decode("utf-8"))
        try:
            return res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError) as e:
            log.error(f"Failed to parse Gemini response: {res_data}")
            raise Exception("Invalid response structure from Gemini API")


def call_openrouter_api(system_prompt: str, task: str, step: int, b64_image: str, api_key: str) -> str:
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = {
        "model": "google/gemini-2.5-flash",
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"Task: {task}\nStep {step}. What action should I take?"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64_image}"
                        }
                    }
                ]
            }
        ],
        "response_format": {
            "type": "json_object"
        }
    }
    import urllib.request
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://github.com/quasar-agent/quasar",
            "X-Title": "Quasar Agent"
        },
        method="POST"
    )
    with urllib.request.urlopen(req) as response:
        res_body = response.read()
        res_data = json.loads(res_body.decode("utf-8"))
        try:
            return res_data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError) as e:
            log.error(f"Failed to parse OpenRouter response: {res_data}")
            raise Exception("Invalid response structure from OpenRouter API")


@app.post("/execute")
async def execute_task(req: TaskRequest):
    """
    Execute a complex task using Claude Vision loop.
    1. Take screenshot
    2. Send to Claude with task description
    3. Claude returns action(s) to perform
    4. Execute actions via pyautogui
    5. Repeat until done or max_steps
    """
    import os
    anthropic_key = req.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    google_key = req.google_api_key or os.environ.get("GOOGLE_API_KEY", "")
    openrouter_key = req.openrouter_api_key or os.environ.get("OPENROUTER_API_KEY", "")

    client = None
    provider = None

    if anthropic_key:
        client = anthropic.Anthropic(api_key=anthropic_key)
        provider = "anthropic"
        log.info("Using Anthropic (Claude) for computer use task")
    elif google_key:
        provider = "google"
        log.info("Using Google Gemini for computer use task")
    elif openrouter_key:
        provider = "openrouter"
        log.info("Using OpenRouter for computer use task")
    else:
        raise HTTPException(
            status_code=400,
            detail="No API key available. Please configure ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENROUTER_API_KEY"
        )

    screenshots: list[str] = []
    steps = 0

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

    try:
        for step in range(req.max_steps):
            steps = step + 1
            b64 = take_screenshot()
            screenshots.append(b64)

            if provider == "anthropic":
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=500,
                    system=system_prompt,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"Task: {req.task}\nStep {steps}. What action should I take?"},
                            {"type": "image", "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": b64
                            }}
                        ]
                    }]
                )
                action_text = response.content[0].text.strip()
            elif provider == "google":
                action_text = call_gemini_api(system_prompt, req.task, steps, b64, google_key)
            elif provider == "openrouter":
                action_text = call_openrouter_api(system_prompt, req.task, steps, b64, openrouter_key)
            else:
                raise Exception("Unknown provider config")

            log.info(f"Step {steps}: {action_text}")

            try:
                action = json.loads(action_text)
            except json.JSONDecodeError:
                # Try to extract JSON from response
                import re
                match = re.search(r'\{.*\}', action_text, re.DOTALL)
                if match:
                    action = json.loads(match.group())
                else:
                    log.warning(f"Could not parse action: {action_text}")
                    continue

            result = execute_action(action)
            if result == "DONE":
                return TaskResponse(success=True, steps=steps, message="Task completed", screenshots=screenshots[:3])

            import asyncio
            await asyncio.sleep(0.5)  # Wait for UI to update

        return TaskResponse(
            success=False, steps=steps,
            message="Max steps reached", screenshots=screenshots[:3]
        )

    except Exception as e:
        log.error(f"Task failed: {e}")
        return TaskResponse(success=False, steps=steps, message=str(e), screenshots=[])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=18790)
