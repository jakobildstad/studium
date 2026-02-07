import os
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify
from openai import OpenAI

load_dotenv()

app = Flask(__name__)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Keep per-session conversation history (simple in-memory store)
conversations = {}

SYSTEM_PROMPT = (
    "You are Studium, a friendly and knowledgeable study assistant. "
    "Help the user learn topics clearly and concisely. "
    "Use examples, ask follow-up questions, and adapt to their level."
)

# ── Pages ──

@app.route("/")
def index():
    return render_template("index.html")

# ── API ──

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json()
    user_message = data.get("message", "")
    session_id = data.get("session_id", "default")

    if session_id not in conversations:
        conversations[session_id] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

    conversations[session_id].append({"role": "user", "content": user_message})

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=conversations[session_id],
        )
        reply = response.choices[0].message.content
        conversations[session_id].append({"role": "assistant", "content": reply})
    except Exception as e:
        reply = f"Error: {e}"

    return jsonify({"reply": reply})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
