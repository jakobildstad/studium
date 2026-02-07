from flask import Blueprint, redirect, url_for, session
from flask_login import login_user, logout_user, current_user
from authlib.integrations.flask_client import OAuth
from models import db, User

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")
oauth = OAuth()


def init_oauth(app):
    oauth.init_app(app)
    oauth.register(
        name="google",
        client_id=app.config["GOOGLE_CLIENT_ID"],
        client_secret=app.config["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


@auth_bp.route("/login")
def login():
    redirect_uri = url_for("auth.callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@auth_bp.route("/callback")
def callback():
    token = oauth.google.authorize_access_token()
    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = oauth.google.userinfo()

    google_id = userinfo["sub"]
    user = User.query.filter_by(google_id=google_id).first()

    if not user:
        user = User(
            google_id=google_id,
            email=userinfo.get("email", ""),
            name=userinfo.get("name", ""),
            avatar_url=userinfo.get("picture", ""),
        )
        db.session.add(user)
        db.session.commit()
    else:
        user.name = userinfo.get("name", user.name)
        user.avatar_url = userinfo.get("picture", user.avatar_url)
        db.session.commit()

    login_user(user, remember=True)
    return redirect(url_for("index"))


@auth_bp.route("/guest")
def guest():
    user = User.query.filter_by(google_id="guest").first()
    if not user:
        user = User(
            google_id="guest",
            email="guest@studium.local",
            name="Guest",
            avatar_url="",
        )
        db.session.add(user)
        db.session.commit()
    login_user(user, remember=False)
    return redirect(url_for("index"))


@auth_bp.route("/logout")
def logout():
    logout_user()
    return redirect(url_for("index"))
