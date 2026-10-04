import os
import re
import json
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify
from flask_login import LoginManager, login_required, current_user
from openai import OpenAI

from models import db, User, Course, Topic, Conversation, Message
from auth import auth_bp, init_oauth

load_dotenv()

# ── App setup ──

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", os.urandom(32).hex())
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///studium.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["GOOGLE_CLIENT_ID"] = os.getenv("GOOGLE_CLIENT_ID", "")
app.config["GOOGLE_CLIENT_SECRET"] = os.getenv("GOOGLE_CLIENT_SECRET", "")

db.init_app(app)

login_manager = LoginManager()
login_manager.init_app(app)

init_oauth(app)
app.register_blueprint(auth_bp)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"error": "unauthorized"}), 401


# ── Create tables ──

with app.app_context():
    db.create_all()


# ── Pages ──

@app.route("/")
def index():
    return render_template("index.html")


# ── API: User ──

@app.route("/api/me")
@login_required
def api_me():
    return jsonify({
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "avatar_url": current_user.avatar_url,
    })


# ── API: Courses ──

@app.route("/api/courses", methods=["GET"])
@login_required
def api_list_courses():
    courses = Course.query.filter_by(user_id=current_user.id).order_by(Course.created_at.desc()).all()
    return jsonify([
        {"id": c.id, "name": c.name, "created_at": c.created_at.isoformat()}
        for c in courses
    ])


@app.route("/api/courses", methods=["POST"])
@login_required
def api_create_course():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    course = Course(user_id=current_user.id, name=name)
    db.session.add(course)
    db.session.commit()

    # Create root topic with course name - all other topics branch from this
    root_topic = Topic(course_id=course.id, title=name, parent_id=None, status="in_progress")
    db.session.add(root_topic)
    db.session.commit()

    # Create a default first conversation
    conv = Conversation(user_id=current_user.id, course_id=course.id, title=name)
    db.session.add(conv)
    db.session.commit()

    return jsonify({"id": course.id, "name": course.name, "conversation_id": conv.id, "root_topic_id": root_topic.id}), 201


@app.route("/api/courses/<int:course_id>", methods=["DELETE"])
@login_required
def api_delete_course(course_id):
    course = Course.query.filter_by(id=course_id, user_id=current_user.id).first_or_404()
    db.session.delete(course)
    db.session.commit()
    return jsonify({"ok": True})


# ── API: Conversations ──

@app.route("/api/conversations", methods=["GET"])
@login_required
def api_list_conversations():
    course_id = request.args.get("course_id", type=int)
    if not course_id:
        return jsonify({"error": "course_id required"}), 400

    convs = (Conversation.query
             .filter_by(user_id=current_user.id, course_id=course_id)
             .order_by(Conversation.updated_at.desc())
             .all())
    return jsonify([
        {
            "id": c.id,
            "title": c.title,
            "status": c.status,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in convs
    ])


@app.route("/api/conversations", methods=["POST"])
@login_required
def api_create_conversation():
    data = request.get_json()
    course_id = data.get("course_id")
    title = data.get("title", "New conversation").strip()

    Course.query.filter_by(id=course_id, user_id=current_user.id).first_or_404()

    conv = Conversation(user_id=current_user.id, course_id=course_id, title=title)
    db.session.add(conv)
    db.session.commit()
    return jsonify({"id": conv.id, "title": conv.title}), 201


@app.route("/api/conversations/<int:conv_id>", methods=["GET"])
@login_required
def api_get_conversation(conv_id):
    conv = Conversation.query.filter_by(id=conv_id, user_id=current_user.id).first_or_404()
    messages = [
        {
            "role": m.role,
            "content": m.content,
            "topic_id": m.topic_id,
            "created_at": m.created_at.isoformat(),
        }
        for m in conv.messages
        if m.role != "system"
    ]
    return jsonify({
        "id": conv.id,
        "title": conv.title,
        "course_id": conv.course_id,
        "messages": messages,
    })


@app.route("/api/conversations/<int:conv_id>", methods=["DELETE"])
@login_required
def api_delete_conversation(conv_id):
    conv = Conversation.query.filter_by(id=conv_id, user_id=current_user.id).first_or_404()
    db.session.delete(conv)
    db.session.commit()
    return jsonify({"ok": True})


# ── API: Topics (subtopic tree) ──

@app.route("/api/courses/<int:course_id>/topics", methods=["GET"])
@login_required
def api_list_topics(course_id):
    Course.query.filter_by(id=course_id, user_id=current_user.id).first_or_404()
    topics = Topic.query.filter_by(course_id=course_id).order_by(Topic.position, Topic.created_at).all()

    def build_tree(parent_id=None):
        nodes = []
        for t in topics:
            if t.parent_id == parent_id:
                nodes.append({
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "children": build_tree(t.id),
                })
        return nodes

    return jsonify(build_tree())


@app.route("/api/courses/<int:course_id>/topics", methods=["POST"])
@login_required
def api_create_topic(course_id):
    Course.query.filter_by(id=course_id, user_id=current_user.id).first_or_404()
    data = request.get_json()
    title = data.get("title", "").strip()
    parent_id = data.get("parent_id")
    if not title:
        return jsonify({"error": "Title required"}), 400

    existing = Topic.query.filter_by(course_id=course_id, title=title, parent_id=parent_id).first()
    if existing:
        return jsonify({"id": existing.id, "title": existing.title, "status": existing.status})

    topic = Topic(course_id=course_id, title=title, parent_id=parent_id)
    db.session.add(topic)
    db.session.commit()
    return jsonify({"id": topic.id, "title": topic.title, "status": topic.status}), 201


# ── API: Chat ──

SYSTEM_PROMPT_TEMPLATE = """You are Studium, a warm and knowledgeable study companion.
The user is studying: {course_name}.
{topic_context}

TEACHING METHOD -- TEXTBOOK + EXPLAIN BACK:
You are a knowledgeable teacher who TEACHES first, then checks understanding. Your job is to deliver real content -- like a good textbook paragraph -- and then ask the user to explain something back.

Structure of every response (DO NOT include labels like "TEACH:" or "THEN ASK:" -- just write naturally):
1. First, give a solid chunk of new information. Cover the concept with depth: definitions, why it matters, how it connects to other ideas, key distinctions, concrete examples. Think of it as a focused textbook paragraph. Don't hold back useful information -- the user came here to LEARN.
2. Then, end with a question that asks the user to EXPLAIN or APPLY what you just taught. Not "does that make sense?" -- instead: "In your own words, why does X work that way?", "How would you explain the difference between X and Y to someone?", "Given what I just described, what do you think would happen if Z?"

Core principles:
- LEAD WITH SUBSTANCE: Don't ask what the user knows first. Teach them something real, then ask them to demonstrate understanding.
- INCLUDE SPECIFICS: Use concrete examples, numbers, names, distinctions. "There are 3 main types of X: A, B, and C. A works by..." is better than "There are different types of X."
- BUILD ON THEIR ANSWERS: When the user responds to your question, acknowledge what they got right, correct misconceptions with new information, then continue teaching the next piece.
- ONE TOPIC PER MESSAGE: Cover one concept well rather than skimming many. Go deep, not wide.

If the user says "I don't know" or struggles:
- Give a hint by restating the key idea more simply, then ask again in a different way
- If they struggle twice, explain the answer directly and move on to teaching the next concept

IMPORTANT -- THEORY ONLY:
Focus on teaching concepts, theory, intuition, and understanding. Do NOT ask the user to write code, solve programming exercises, or do hands-on coding tasks unless the user explicitly asks for coding practice. Your questions should be conceptual -- not "Write a function that...".

RESPONSE LENGTH: Aim for a solid paragraph of teaching (5-8 sentences) followed by one clear question. Use LaTeX notation with \\( \\) for inline math and \\[ \\] for display math. NEVER use $ or $$ as math delimiters -- they conflict with currency symbols. Don't be afraid to give real information -- but stay focused on one idea per message.

TOPIC STRUCTURE:
Topics are organized in a hierarchy that can go arbitrarily deep. Each topic can have subtopics, which can themselves have further subtopics.
{depth_context}

CRITICAL -- METADATA OUTPUT (you MUST always include this):
Analyze the USER's message. Determine if they are introducing a NEW area/concept to explore.

Existing topics already tracked: {existing_topics}

{suggestion_instruction}

You MUST end EVERY response with this tag on its own line:
<!--STUDIUM_META:{{"user_topic": "new topic name or null", "suggestions": [{suggestion_format}]}}-->

Rules for user_topic:
- Set to a SHORT name (2-4 words) when the user mentions, asks about, or wants to explore a NEW concept/area not yet tracked above
- This includes: their first question about a subject, switching to a new area, asking "what about X?"
- Set to null ONLY for direct follow-ups, clarifications, or deeper questions about the SAME topic already being discussed
- When in doubt, CREATE a topic. It's better to have too many topics than to miss one.
- Never repeat a topic already in the tracked list

Rules for suggestions:
- Only provide suggestions (3-5 items) when this is the FIRST message in a new topic area or when the user explicitly asks what to study
- Each suggestion should be a specific, actionable subtopic name (2-4 words)
- Set to empty array [] for normal conversation turns

REMEMBER: The metadata tag is REQUIRED on every response. Never skip it."""


def extract_meta(text):
    """Extract and remove the STUDIUM_META tag from AI response."""
    pattern = r'\n?<!--STUDIUM_META:(.*?)-->'
    match = re.search(pattern, text)
    meta = {}
    if match:
        try:
            meta = json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
        text = re.sub(pattern, '', text).rstrip()
    return text, meta


HIGHLIGHT_PROMPT = """You are a concept highlighter for an educational app. Given a teaching response about "{course_name}", identify non-trivial concepts, technical terms, and ideas a student might want to explore further.

Rules:
- Return ONLY a JSON array of strings, e.g. ["term one", "term two"]
- Each string must be an EXACT substring copied from the text (preserve original casing)
- Focus on: technical terms, named concepts, theories, methods, formulas, key vocabulary
- Skip: trivial/common words, generic phrases like "for example", words the student obviously knows
- Prefer multi-word terms when they form a concept (e.g. "gradient descent" not just "gradient")
- Include 8-15 terms
- Do NOT include any text outside the JSON array

Text:
{text}"""


def highlight_concepts(text, course_name):
    """Call a fast model to identify concepts, then inject ==markers== into text."""
    prompt_content = HIGHLIGHT_PROMPT.format(course_name=course_name, text=text)

    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt_content}],
                temperature=0,
            )
            raw = (response.choices[0].message.content or "").strip()
            if not raw:
                print(f"[highlight] empty response (attempt {attempt + 1})")
                continue
            terms = json.loads(raw)
            if not isinstance(terms, list):
                print(f"[highlight] unexpected type: {type(terms)}, raw: {raw[:200]}")
                continue
            print(f"[highlight] found {len(terms)} terms: {terms}")
            result = inject_highlights(text, terms)
            print(f"[highlight] injected, sample: {result[:200]}")
            return result
        except Exception as e:
            print(f"[highlight] error (attempt {attempt + 1}): {e}")

    print("[highlight] all attempts failed, returning unhighlighted text")
    return text


def inject_highlights(text, terms):
    """Wrap identified terms with ==markers== in the text."""
    # Sort longest first so "gradient descent" is matched before "gradient"
    terms = sorted(set(terms), key=len, reverse=True)
    for term in terms:
        # Match the exact term, avoiding already-wrapped terms (adjacent ==)
        pattern = re.compile(r'(?<!=)(' + re.escape(term) + r')(?!=)', re.IGNORECASE)
        # Replace only the first occurrence to keep text readable
        text = pattern.sub(r'==\1==', text, count=1)
    return text


def get_topic_path(topic_id):
    """Build the path from root to the given topic."""
    path = []
    current = db.session.get(Topic, topic_id) if topic_id else None
    while current:
        path.insert(0, {"id": current.id, "title": current.title})
        current = db.session.get(Topic, current.parent_id) if current.parent_id else None
    return path


def get_existing_topic_titles(course_id):
    """Get all existing topic titles for a course."""
    topics = Topic.query.filter_by(course_id=course_id).all()
    return [t.title for t in topics]


def get_topic_depth(topic_id):
    """Count depth of a topic (0 = root)."""
    depth = 0
    current = db.session.get(Topic, topic_id) if topic_id else None
    while current and current.parent_id:
        depth += 1
        current = db.session.get(Topic, current.parent_id)
    return depth


@app.route("/api/chat", methods=["POST"])
@login_required
def api_chat():
    data = request.get_json()
    conv_id = data.get("conversation_id")
    user_message = data.get("message", "").strip()
    topic_id = data.get("topic_id")  # current topic context (nullable)
    model = data.get("model", "gpt-4o-mini")

    ALLOWED_MODELS = {"gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"}
    if model not in ALLOWED_MODELS:
        model = "gpt-4o-mini"

    force_topic = data.get("force_topic")

    if not conv_id or not user_message:
        return jsonify({"error": "conversation_id and message required"}), 400

    conv = Conversation.query.filter_by(id=conv_id, user_id=current_user.id).first_or_404()
    course = db.session.get(Course, conv.course_id)

    # If user clicked a concept link, create the topic node immediately
    forced_new_topic = None
    if force_topic:
        force_topic = force_topic.strip()
        # Check it doesn't already exist
        existing = Topic.query.filter_by(course_id=course.id).filter(
            db.func.lower(Topic.title) == force_topic.lower()
        ).first()

        if existing:
            # Topic exists already -- navigate into it
            topic_id = existing.id
        else:
            # Determine parent: current topic, or root if at top level
            parent_for_forced = topic_id
            if parent_for_forced is None:
                root_topic = Topic.query.filter_by(course_id=course.id, parent_id=None).first()
                if root_topic:
                    parent_for_forced = root_topic.id

            new_t = Topic(
                course_id=course.id,
                title=force_topic,
                parent_id=parent_for_forced,
                status="in_progress",
            )
            db.session.add(new_t)
            db.session.commit()
            topic_id = new_t.id
            forced_new_topic = {"id": new_t.id, "title": new_t.title, "parent_id": new_t.parent_id}
            print(f"[topic] force-created: {force_topic} (id={new_t.id}, parent={parent_for_forced})")

    # Build topic context for system prompt
    topic_path = get_topic_path(topic_id)
    current_depth = get_topic_depth(topic_id) if topic_id else -1
    if topic_path:
        path_str = " > ".join([course.name] + [t["title"] for t in topic_path])
        topic_context = f"Current focus path: {path_str}"
    else:
        topic_context = f"The user is at the top level of {course.name}."

    # Tell AI about current depth level
    if current_depth < 0:
        depth_context = "The user is at the topic root. New topics from their questions become top-level subtopics."
    else:
        depth_context = f"The user is at depth level {current_depth}. New topics from their questions become children of the current topic."

    existing_titles = get_existing_topic_titles(course.id)
    existing_str = ", ".join(existing_titles) if existing_titles else "(none yet)"

    # Check if this is a fresh start (no messages or first message)
    msg_count = Message.query.filter_by(conversation_id=conv.id).count()
    is_fresh = msg_count == 0
    if is_fresh:
        suggestion_instruction = "Since this is the start of the conversation, provide 3-5 suggested subtopics the user could explore within this subject."
        suggestion_format = '"suggestion1", "suggestion2", "suggestion3"'
    else:
        suggestion_instruction = "Only provide suggestions if the user explicitly asks what to study or seems lost."
        suggestion_format = ""

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        course_name=course.name,
        topic_context=topic_context,
        depth_context=depth_context,
        existing_topics=existing_str,
        suggestion_instruction=suggestion_instruction,
        suggestion_format=suggestion_format,
    )

    # Build message history for OpenAI
    openai_messages = [{"role": "system", "content": system_prompt}]
    for m in conv.messages:
        if m.role != "system":
            openai_messages.append({"role": m.role, "content": m.content})
    openai_messages.append({"role": "user", "content": user_message})

    # Save user message
    user_msg = Message(conversation_id=conv.id, role="user", content=user_message, topic_id=topic_id)
    db.session.add(user_msg)

    # Update conversation title from first user message
    if conv.title == "New conversation" or conv.title == course.name:
        conv.title = user_message[:80]

    conv.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    # Call OpenAI
    try:
        response = client.chat.completions.create(
            model=model,
            messages=openai_messages,
        )
        raw_reply = response.choices[0].message.content
        print(f"[meta] raw tail: ...{raw_reply[-300:]}")
        reply, meta = extract_meta(raw_reply)
        print(f"[meta] extracted: {meta}")

        # Second agent: identify and highlight concepts
        reply = highlight_concepts(reply, course.name)

        # Save assistant message (with highlights baked in)
        asst_msg = Message(conversation_id=conv.id, role="assistant", content=reply, topic_id=topic_id)
        db.session.add(asst_msg)
        db.session.commit()

        # Create subtopic from user's question if AI detected one
        # Skip if we already force-created a topic from a concept click
        new_topic = forced_new_topic
        user_topic_name = meta.get("user_topic")
        print(f"[topic] user_topic from meta: {user_topic_name!r}, current topic_id: {topic_id}, forced: {forced_new_topic is not None}")
        if not forced_new_topic and user_topic_name and user_topic_name != "null":
            user_topic_name = user_topic_name.strip()
            
            # Skip if this matches the course name (case-insensitive)
            if user_topic_name.lower() == course.name.lower():
                user_topic_name = None
            
            # Check it doesn't already exist (case-insensitive check)
            if user_topic_name:
                existing = Topic.query.filter_by(course_id=course.id).filter(
                    db.func.lower(Topic.title) == user_topic_name.lower()
                ).first()
                
                if not existing:
                    # Determine parent for new topic
                    parent_for_new = topic_id
                    
                    if topic_id is None:
                        # User is at root - attach to course's root topic
                        root_topic = Topic.query.filter_by(course_id=course.id, parent_id=None).first()
                        if root_topic:
                            parent_for_new = root_topic.id

                    topic = Topic(
                        course_id=course.id,
                        title=user_topic_name,
                        parent_id=parent_for_new,
                        status="in_progress",
                    )
                    db.session.add(topic)
                    db.session.commit()

                    # Re-tag the triggering messages with the new topic
                    user_msg.topic_id = topic.id
                    asst_msg.topic_id = topic.id
                    db.session.commit()

                    new_topic = {"id": topic.id, "title": topic.title, "parent_id": topic.parent_id}

        suggestions = meta.get("suggestions", [])

    except Exception as e:
        reply = f"Something went wrong: {e}"
        new_topic = None
        suggestions = []

    return jsonify({
        "reply": reply,
        "new_topic": new_topic,
        "suggestions": suggestions,
        "conversation_title": conv.title,
    })


# ── API: Branch (topic switch) ──

@app.route("/api/conversations/<int:conv_id>/branch", methods=["POST"])
@login_required
def api_branch(conv_id):
    """Insert a branch context message when the user switches topic via sidebar."""
    data = request.get_json()
    topic_id = data.get("topic_id")
    topic_title = data.get("topic_title", "")

    conv = Conversation.query.filter_by(id=conv_id, user_id=current_user.id).first_or_404()

    # Insert a system-level branch marker message
    branch_msg = Message(
        conversation_id=conv.id,
        role="system",
        content=f"[BRANCH: User switched focus to \"{topic_title}\"]",
        topic_id=topic_id,
    )
    db.session.add(branch_msg)
    conv.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify({"ok": True})


# ── API: Health ──

@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
