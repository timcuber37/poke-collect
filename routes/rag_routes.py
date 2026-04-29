from flask import Blueprint, request, render_template, jsonify
from rag.rag_module import answer_question

rag_bp = Blueprint("rag", __name__)


@rag_bp.route("/chat")
def chat_page():
    return render_template("chat.html")


@rag_bp.route("/chat/ask", methods=["POST"])
def chat_ask():
    data     = request.get_json()
    question = data.get("question", "").strip()
    if not question:
        return jsonify({"error": "No question provided"}), 400
    answer = answer_question(question)
    return jsonify({"answer": answer})
