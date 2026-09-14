from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from hashlib import pbkdf2_hmac, sha256
from hmac import compare_digest
import os
from pathlib import Path
from secrets import token_bytes, token_urlsafe
from typing import Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Date, DateTime, Integer, String, Text, create_engine, inspect, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool

DB_PATH = Path(__file__).with_name("yanwu.db")
database_url = os.getenv("DATABASE_URL", "").strip()
if os.getenv("RENDER") and not database_url:
    raise RuntimeError("Render deployment requires DATABASE_URL; SQLite storage is not persistent")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
if not database_url:
    database_url = f"sqlite:///{DB_PATH.as_posix()}"
is_sqlite = database_url.startswith("sqlite:")
engine_options = {
    "connect_args": {"check_same_thread": False} if is_sqlite else {"prepare_threshold": None},
    "pool_pre_ping": True,
}
if not is_sqlite:
    engine_options["poolclass"] = NullPool
engine = create_engine(database_url, **engine_options)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
seed_examples = os.getenv("SEED_DEMO_DATA", "true" if is_sqlite else "false").lower() in {"1", "true", "yes"}


class Base(DeclarativeBase):
    pass


class GrowthRecord(Base):
    __tablename__ = "growth_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(40), index=True)
    child_quote: Mapped[str] = mapped_column(Text, default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_by: Mapped[str] = mapped_column(String(80), default="妈妈 · 林晓")
    version: Mapped[int] = mapped_column(Integer, default=1)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)


class ChildProfile(Base):
    __tablename__ = "child_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    nickname: Mapped[str] = mapped_column(String(80), default="林一")
    age: Mapped[int] = mapped_column(Integer, default=7)
    grade: Mapped[str] = mapped_column(String(80), default="一年级")
    height: Mapped[str] = mapped_column(String(40), default="")
    weight: Mapped[str] = mapped_column(String(40), default="")
    traits: Mapped[str] = mapped_column(Text, default="")
    focus_direction: Mapped[str] = mapped_column(Text, default="")
    interests: Mapped[str] = mapped_column(Text, default="喜欢画画,乐高搭建,观察昆虫,喜欢讲故事")
    support_note: Mapped[str] = mapped_column(Text, default="在需要时给出一个提示，先让孩子自己尝试；完成后一起回顾哪一步最有帮助。")


class Homework(Base):
    __tablename__ = "homework"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    subject: Mapped[str] = mapped_column(String(40))
    content: Mapped[str] = mapped_column(Text)
    due_label: Mapped[str] = mapped_column(String(80))
    support_mode: Mapped[str] = mapped_column(String(40), default="自己完成")
    status: Mapped[str] = mapped_column(String(20), default="未开始")
    check_required: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SchedulePlan(Base):
    __tablename__ = "schedule_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(120), default="本学期日程计划")
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)


class ScheduleEntry(Base):
    __tablename__ = "schedule_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    category: Mapped[str] = mapped_column(String(40))
    module: Mapped[str] = mapped_column(String(80))
    weekday: Mapped[int] = mapped_column(Integer)
    time_label: Mapped[str] = mapped_column(String(80), default="")
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FollowUp(Base):
    __tablename__ = "follow_ups"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_record_id: Mapped[str | None] = mapped_column(String(36), nullable=True, unique=True)
    title: Mapped[str] = mapped_column(Text)
    fact: Mapped[str] = mapped_column(Text)
    owner: Mapped[str] = mapped_column(String(80), default="妈妈")
    review_label: Mapped[str] = mapped_column(String(80), default="本周回顾")
    priority: Mapped[str] = mapped_column(String(10), default="中")
    status: Mapped[str] = mapped_column(String(20), default="待了解")
    conclusion: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(40), default="成长探索")
    child_agreement: Mapped[str] = mapped_column(String(20), default="待讨论")
    parent_support: Mapped[str] = mapped_column(Text, default="")
    review_label: Mapped[str] = mapped_column(String(80), default="本月回顾")
    status: Mapped[str] = mapped_column(String(20), default="进行中")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FamilyProfile(Base):
    __tablename__ = "family_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(100), default="言午的成长空间")
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Shanghai")
    members: Mapped[str] = mapped_column(Text, default="妈妈 · 林晓,爸爸 · 林川,外婆 · 陈芳")


class FamilyAccount(Base):
    __tablename__ = "family_accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(String(36), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RecordCreate(BaseModel):
    title: str = Field(min_length=1, max_length=1000)
    category: str = Field(min_length=1, max_length=40)
    child_quote: str = Field(default="", max_length=1000)


class ChildUpdate(BaseModel):
    nickname: str = Field(min_length=1, max_length=80)
    age: int = Field(ge=0, le=25)
    grade: str = Field(min_length=1, max_length=80)
    height: str = Field(default="", max_length=40)
    weight: str = Field(default="", max_length=40)
    traits: str = Field(default="", max_length=2000)
    focus_direction: str = Field(default="", max_length=2000)
    interests: list[str]
    support_note: str = Field(max_length=2000)


class HomeworkCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=1000)
    due_label: str = Field(min_length=1, max_length=80)
    support_mode: str = Field(default="自己完成", max_length=40)
    check_required: bool = False


class SchedulePlanUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    period_start: date
    period_end: date


class ScheduleEntryCreate(BaseModel):
    category: str = Field(min_length=1, max_length=40)
    module: str = Field(min_length=1, max_length=80)
    weekday: int = Field(ge=1, le=7)
    time_label: str = Field(default="", max_length=80)
    content: str = Field(min_length=1, max_length=1000)


class StatusUpdate(BaseModel):
    status: str
    conclusion: str = ""


class FollowUpCreate(BaseModel):
    title: str = Field(min_length=1, max_length=1000)
    fact: str = Field(min_length=1, max_length=2000)
    owner: str = Field(default="妈妈", max_length=80)
    review_label: str = Field(default="本周回顾", max_length=80)
    priority: str = Field(default="中", max_length=10)


class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=1000)
    category: str = Field(default="成长探索", max_length=40)
    child_agreement: str = Field(default="待讨论", max_length=20)
    parent_support: str = Field(default="", max_length=2000)
    review_label: str = Field(default="本月回顾", max_length=80)


class FamilyUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    timezone: str = Field(min_length=1, max_length=80)
    members: list[str]


Role = Literal["监护人", "家庭成员", "照护者"]


class AccountCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^\S+$")
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)
    role: Role


class AccountUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^\S+$")
    password: str = Field(default="", max_length=128)
    display_name: str = Field(min_length=1, max_length=80)
    role: Role


class LoginRequest(BaseModel):
    username: str
    password: str


def get_db():
    with SessionLocal() as db:
        yield db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = token_bytes(16)
    digest = pbkdf2_hmac("sha256", password.encode(), salt, 210_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, expected = stored.split("$", 1)
        digest = pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 210_000)
        return compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def account_out(account: FamilyAccount) -> dict:
    return {
        "id": account.id,
        "username": account.username,
        "display_name": account.display_name,
        "role": account.role,
    }


def issue_session(db: Session, account: FamilyAccount) -> dict:
    token = token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=sha256(token.encode()).hexdigest(),
            account_id=account.id,
            expires_at=utcnow() + timedelta(days=30),
        )
    )
    db.commit()
    return {"token": token, "account": account_out(account)}


def record_out(record: GrowthRecord) -> dict:
    occurred = record.occurred_at.replace(tzinfo=None)
    age_seconds = (utcnow().replace(tzinfo=None) - occurred).total_seconds()
    time_label = "刚刚" if age_seconds < 3600 else occurred.strftime("%m月%d日 %H:%M")
    tones = {"学习": "amber", "生活习惯": "blue", "兴趣活动": "green"}
    return {"id": record.id, "title": record.title, "cat": record.category, "quote": record.child_quote or "尚未询问", "time": time_label, "tone": tones.get(record.category, "green"), "version": record.version}


def child_out(child: ChildProfile) -> dict:
    return {"nickname": child.nickname, "age": child.age, "grade": child.grade, "height": child.height or "", "weight": child.weight or "", "traits": child.traits or "", "focus_direction": child.focus_direction or "", "interests": [item for item in child.interests.split(",") if item], "support_note": child.support_note}


def homework_out(item: Homework) -> dict:
    return {"id": item.id, "subject": item.subject, "content": item.content, "due_label": item.due_label, "support_mode": item.support_mode, "status": item.status, "check_required": item.check_required}


def schedule_plan_out(item: SchedulePlan) -> dict:
    return {"name": item.name, "period_start": item.period_start.isoformat(), "period_end": item.period_end.isoformat()}


def schedule_entry_out(item: ScheduleEntry) -> dict:
    return {"id": item.id, "category": item.category, "module": item.module, "weekday": item.weekday, "time_label": item.time_label, "content": item.content}


def followup_out(item: FollowUp) -> dict:
    return {"id": item.id, "title": item.title, "fact": item.fact, "owner": item.owner, "review_label": item.review_label, "priority": item.priority, "status": item.status, "conclusion": item.conclusion, "source_record_id": item.source_record_id}


def goal_out(item: Goal) -> dict:
    return {"id": item.id, "title": item.title, "category": item.category, "child_agreement": item.child_agreement, "parent_support": item.parent_support, "review_label": item.review_label, "status": item.status}


def seed_demo(db: Session) -> None:
    now = utcnow()
    if not db.get(ChildProfile, 1):
        db.add(ChildProfile(id=1))
    if not db.get(FamilyProfile, 1):
        db.add(FamilyProfile(id=1))
    if not db.get(SchedulePlan, 1):
        db.add(SchedulePlan(id=1, name="秋季日常安排", period_start=date(2026, 9, 1), period_end=date(2027, 1, 15)))
    if seed_examples and not db.scalar(select(GrowthRecord.id).limit(1)):
        for title, category, quote in [("完成了第一幅水彩画", "兴趣活动", "我想把天空涂成橙色。"), ("自己整理了书包", "生活习惯", "明天的书我都放好了。"), ("数学应用题需要提示", "学习", "我不知道先算哪一步。")]:
            db.add(GrowthRecord(id=str(uuid4()), title=title, category=category, child_quote=quote, occurred_at=now))
    if seed_examples and not db.scalar(select(Homework.id).limit(1)):
        db.add_all([Homework(id=str(uuid4()), subject="数学", content="练习册第3页", due_label="今天 20:00", support_mode="需要提示", status="未开始", check_required=False, created_at=now), Homework(id=str(uuid4()), subject="语文", content="生字抄写", due_label="今天 19:00", support_mode="需要陪伴", status="已完成", check_required=True, created_at=now)])
    if seed_examples and not db.scalar(select(ScheduleEntry.id).limit(1)):
        db.add_all([
            ScheduleEntry(id=str(uuid4()), category="课程表", module="第1节", weekday=2, time_label="白天", content="体育《奔跑进管》· 新年愿望", created_at=now),
            ScheduleEntry(id=str(uuid4()), category="课程表", module="第1节", weekday=3, time_label="白天", content="数学《美丽的小花园》· 我的假期安排", created_at=now),
            ScheduleEntry(id=str(uuid4()), category="课程表", module="第1节", weekday=5, time_label="白天", content="科学《弹起来的球》· 愉快的假期", created_at=now),
            ScheduleEntry(id=str(uuid4()), category="饮食", module="午餐", weekday=1, time_label="12:00", content="红烧肉密码", created_at=now),
            ScheduleEntry(id=str(uuid4()), category="睡前时光", module="故事 / 反思", weekday=1, time_label="20:30", content="长期坚持：《国学神话》", created_at=now),
            ScheduleEntry(id=str(uuid4()), category="睡前时光", module="故事 / 反思", weekday=2, time_label="20:30", content="多元趣味：《屁屁侦探》", created_at=now),
        ])
    if seed_examples and not db.scalar(select(FollowUp.id).limit(1)):
        db.add_all([FollowUp(id=str(uuid4()), title="数学应用题的解题步骤", fact="遇到多步骤题目时容易停住。", owner="妈妈", review_label="明天回顾", priority="高", status="行动中", created_at=now), FollowUp(id=str(uuid4()), title="自己整理书包", fact="连续三天在睡前完成。", owner="爸爸", review_label="今天回顾", priority="中", status="待回顾", created_at=now)])
    if seed_examples and not db.scalar(select(Goal.id).limit(1)):
        db.add_all([Goal(id=str(uuid4()), title="遇到困难时，先说出自己卡在哪里", category="学习表达", child_agreement="认可", parent_support="用提问代替直接讲答案", review_label="9月21日", created_at=now), Goal(id=str(uuid4()), title="睡前自己完成第二天的准备", category="生活自主", child_agreement="待讨论", parent_support="提供清单，逐步减少提醒", review_label="9月28日", created_at=now)])
    db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        # Keep databases created by earlier local versions compatible in place.
        columns = {column["name"] for column in inspect(engine).get_columns("child_profiles")}
        for name, definition in {"height": "VARCHAR(40) DEFAULT ''", "weight": "VARCHAR(40) DEFAULT ''", "traits": "TEXT DEFAULT ''", "focus_direction": "TEXT DEFAULT ''"}.items():
            if name not in columns:
                db.execute(text(f"ALTER TABLE child_profiles ADD COLUMN {name} {definition}"))
        db.execute(text("UPDATE schedule_entries SET module = '第1节' WHERE category = '课程表' AND module = '学校课程'"))
        db.execute(text("UPDATE schedule_entries SET category = '饮食', module = '午餐' WHERE category = '午餐'"))
        db.execute(text("UPDATE family_profiles SET name = '言午的成长空间' WHERE name = '林一家的成长空间'"))
        db.execute(text("UPDATE homework SET status = '进行中' WHERE status = '待检查'"))
        db.commit()
        seed_demo(db)
    yield


app = FastAPI(title="Yanwu GrowTogether API", version="0.3.0", lifespan=lifespan)
web_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("WEB_ORIGIN", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *web_origins],
    allow_origin_regex=r"^http://(?:(?:localhost|127\.0\.0\.1):\d{2,5}|(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}):5173)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PUBLIC_API_PATHS = {
    "/api/v1/health",
    "/api/v1/auth/status",
    "/api/v1/auth/setup",
    "/api/v1/auth/login",
}


@app.middleware("http")
async def require_family_account(request: Request, call_next):
    if (
        request.method == "OPTIONS"
        or not request.url.path.startswith("/api/v1")
        or request.url.path in PUBLIC_API_PATHS
    ):
        return await call_next(request)
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return JSONResponse({"detail": "请先登录家庭账户"}, status_code=401)
    token_hash = sha256(authorization.removeprefix("Bearer ").encode()).hexdigest()
    with SessionLocal() as db:
        auth_session = db.get(AuthSession, token_hash)
        if not auth_session:
            return JSONResponse({"detail": "登录已失效，请重新登录"}, status_code=401)
        expires_at = auth_session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        account = db.get(FamilyAccount, auth_session.account_id)
        if expires_at <= utcnow() or not account:
            db.delete(auth_session)
            db.commit()
            return JSONResponse({"detail": "登录已失效，请重新登录"}, status_code=401)
        request.state.account_id = account.id
        request.state.account_role = account.role
    return await call_next(request)


@app.get("/api/v1/auth/status")
def auth_status(db: Session = Depends(get_db)) -> dict:
    return {"has_accounts": db.scalar(select(FamilyAccount.id).limit(1)) is not None}


@app.post("/api/v1/auth/setup", status_code=201)
def setup_account(payload: AccountCreate, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(FamilyAccount.id).limit(1)):
        raise HTTPException(409, "家庭账户已经完成初始化")
    if payload.role != "监护人":
        raise HTTPException(422, "首个家庭账户必须是监护人")
    account = FamilyAccount(
        id=str(uuid4()),
        username=payload.username.strip(),
        display_name=payload.display_name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.password),
        created_at=utcnow(),
    )
    db.add(account)
    db.commit()
    return issue_session(db, account)


@app.post("/api/v1/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict:
    account = db.scalar(select(FamilyAccount).where(FamilyAccount.username == payload.username.strip()))
    if not account or not verify_password(payload.password, account.password_hash):
        raise HTTPException(401, "账号或密码错误")
    return issue_session(db, account)


@app.post("/api/v1/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)) -> dict:
    authorization = request.headers.get("Authorization", "")
    token_hash = sha256(authorization.removeprefix("Bearer ").encode()).hexdigest()
    auth_session = db.get(AuthSession, token_hash)
    if auth_session:
        db.delete(auth_session)
        db.commit()
    return {"ok": True}


def require_guardian(request: Request) -> None:
    if request.state.account_role != "监护人":
        raise HTTPException(403, "仅监护人可以管理家庭设置和账户")


@app.post("/api/v1/auth/accounts", status_code=201)
def create_account(payload: AccountCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    require_guardian(request)
    username = payload.username.strip()
    if db.scalar(select(FamilyAccount.id).where(FamilyAccount.username == username)):
        raise HTTPException(409, "该登录账号已存在")
    account = FamilyAccount(
        id=str(uuid4()),
        username=username,
        display_name=payload.display_name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.password),
        created_at=utcnow(),
    )
    db.add(account)
    db.commit()
    return account_out(account)


@app.put("/api/v1/auth/accounts/{account_id}")
def update_account(account_id: str, payload: AccountUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    require_guardian(request)
    account = db.get(FamilyAccount, account_id)
    if not account:
        raise HTTPException(404, "家庭账户不存在")
    username = payload.username.strip()
    duplicate = db.scalar(
        select(FamilyAccount.id).where(
            FamilyAccount.username == username,
            FamilyAccount.id != account_id,
        )
    )
    if duplicate:
        raise HTTPException(409, "该登录账号已存在")
    account.username = username
    account.display_name = payload.display_name.strip()
    account.role = payload.role
    if payload.password:
        if len(payload.password) < 8:
            raise HTTPException(422, "新密码至少需要 8 位")
        account.password_hash = hash_password(payload.password)
    db.commit()
    return account_out(account)


@app.delete("/api/v1/auth/accounts/{account_id}")
def delete_account(account_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    require_guardian(request)
    if account_id == request.state.account_id:
        raise HTTPException(409, "不能删除当前登录账户")
    account = db.get(FamilyAccount, account_id)
    if not account:
        raise HTTPException(404, "家庭账户不存在")
    if len(db.scalars(select(FamilyAccount.id)).all()) <= 1:
        raise HTTPException(409, "至少保留一个家庭账户")
    for auth_session in db.scalars(select(AuthSession).where(AuthSession.account_id == account_id)).all():
        db.delete(auth_session)
    db.delete(account)
    db.commit()
    return {"deleted": account_id}


@app.get("/api/v1/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("select 1"))
    return {"status": "ok", "service": "yanwu-api", "database": "sqlite" if is_sqlite else "postgresql"}


@app.get("/api/v1/bootstrap")
def bootstrap(request: Request, db: Session = Depends(get_db)) -> dict:
    child = db.get(ChildProfile, 1)
    family = db.get(FamilyProfile, 1)
    return {
        "child": child_out(child),
        "family": {"name": family.name, "timezone": family.timezone, "members": family.members.split(",")},
        "accounts": [account_out(x) for x in db.scalars(select(FamilyAccount).order_by(FamilyAccount.created_at)).all()],
        "current_account_id": request.state.account_id,
        "data_location": "本地 SQLite" if is_sqlite else "云端 PostgreSQL",
        "records": [record_out(x) for x in db.scalars(select(GrowthRecord).order_by(GrowthRecord.occurred_at.desc())).all()],
        "homework": [homework_out(x) for x in db.scalars(select(Homework).order_by(Homework.created_at.desc())).all()],
        "schedule_plan": schedule_plan_out(db.get(SchedulePlan, 1)),
        "schedule_entries": [schedule_entry_out(x) for x in db.scalars(select(ScheduleEntry).order_by(ScheduleEntry.category, ScheduleEntry.module, ScheduleEntry.weekday)).all()],
        "followups": [followup_out(x) for x in db.scalars(select(FollowUp).order_by(FollowUp.created_at.desc())).all()],
        "goals": [goal_out(x) for x in db.scalars(select(Goal).order_by(Goal.created_at.desc())).all()],
    }


@app.get("/api/v1/records")
def list_records(db: Session = Depends(get_db)) -> list[dict]:
    return [record_out(x) for x in db.scalars(select(GrowthRecord).order_by(GrowthRecord.occurred_at.desc())).all()]


@app.post("/api/v1/records", status_code=201)
def create_record(payload: RecordCreate, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), db: Session = Depends(get_db)) -> dict:
    if idempotency_key:
        existing = db.scalar(select(GrowthRecord).where(GrowthRecord.idempotency_key == idempotency_key))
        if existing:
            return record_out(existing)
    title = payload.title.strip()
    if not title:
        raise HTTPException(422, "事实内容不能为空")
    item = GrowthRecord(id=str(uuid4()), title=title, category=payload.category, child_quote=payload.child_quote.strip(), occurred_at=utcnow(), idempotency_key=idempotency_key)
    db.add(item); db.commit()
    return record_out(item)


@app.put("/api/v1/records/{record_id}")
def update_record(record_id: str, payload: RecordCreate, db: Session = Depends(get_db)) -> dict:
    item = db.get(GrowthRecord, record_id)
    if not item: raise HTTPException(404, "记录不存在")
    item.title, item.category, item.child_quote = payload.title.strip(), payload.category, payload.child_quote.strip()
    item.version += 1
    db.commit(); return record_out(item)


@app.delete("/api/v1/records/{record_id}")
def delete_record(record_id: str, db: Session = Depends(get_db)) -> dict:
    item = db.get(GrowthRecord, record_id)
    if not item: raise HTTPException(404, "记录不存在")
    db.delete(item); db.commit(); return {"deleted": record_id}


@app.post("/api/v1/records/{record_id}/follow-up", status_code=201)
def record_to_followup(record_id: str, db: Session = Depends(get_db)) -> dict:
    existing = db.scalar(select(FollowUp).where(FollowUp.source_record_id == record_id))
    if existing:
        return followup_out(existing)
    record = db.get(GrowthRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")
    item = FollowUp(id=str(uuid4()), source_record_id=record.id, title=record.title, fact=record.title, owner="妈妈", review_label="一周后回顾", priority="中", status="待了解", created_at=utcnow())
    db.add(item); db.commit()
    return followup_out(item)


@app.get("/api/v1/child")
def get_child(db: Session = Depends(get_db)) -> dict:
    return child_out(db.get(ChildProfile, 1))


@app.put("/api/v1/child")
def update_child(payload: ChildUpdate, db: Session = Depends(get_db)) -> dict:
    child = db.get(ChildProfile, 1)
    child.nickname, child.age, child.grade = payload.nickname.strip(), payload.age, payload.grade.strip()
    child.height, child.weight = payload.height.strip(), payload.weight.strip()
    child.traits, child.focus_direction = payload.traits.strip(), payload.focus_direction.strip()
    child.interests, child.support_note = ",".join(x.strip() for x in payload.interests if x.strip()), payload.support_note.strip()
    db.commit(); return child_out(child)


@app.post("/api/v1/homework", status_code=201)
def create_homework(payload: HomeworkCreate, db: Session = Depends(get_db)) -> dict:
    item = Homework(id=str(uuid4()), **payload.model_dump(), status="未开始", created_at=utcnow())
    db.add(item); db.commit(); return homework_out(item)


@app.put("/api/v1/homework/{item_id}")
def edit_homework(item_id: str, payload: HomeworkCreate, db: Session = Depends(get_db)) -> dict:
    item = db.get(Homework, item_id)
    if not item: raise HTTPException(404, "安排不存在")
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); return homework_out(item)


@app.delete("/api/v1/homework/{item_id}")
def delete_homework(item_id: str, db: Session = Depends(get_db)) -> dict:
    item = db.get(Homework, item_id)
    if not item: raise HTTPException(404, "安排不存在")
    db.delete(item); db.commit(); return {"deleted": item_id}


@app.put("/api/v1/schedule/plan")
def update_schedule_plan(payload: SchedulePlanUpdate, db: Session = Depends(get_db)) -> dict:
    if payload.period_end < payload.period_start:
        raise HTTPException(422, "结束日期不能早于开始日期")
    item = db.get(SchedulePlan, 1)
    item.name, item.period_start, item.period_end = payload.name.strip(), payload.period_start, payload.period_end
    db.commit(); return schedule_plan_out(item)


@app.post("/api/v1/schedule/entries", status_code=201)
def create_schedule_entry(payload: ScheduleEntryCreate, db: Session = Depends(get_db)) -> dict:
    item = ScheduleEntry(id=str(uuid4()), **payload.model_dump(), created_at=utcnow())
    db.add(item); db.commit(); return schedule_entry_out(item)


@app.put("/api/v1/schedule/entries/{item_id}")
def edit_schedule_entry(item_id: str, payload: ScheduleEntryCreate, db: Session = Depends(get_db)) -> dict:
    item = db.get(ScheduleEntry, item_id)
    if not item: raise HTTPException(404, "周安排不存在")
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); return schedule_entry_out(item)


@app.delete("/api/v1/schedule/entries/{item_id}")
def delete_schedule_entry(item_id: str, db: Session = Depends(get_db)) -> dict:
    item = db.get(ScheduleEntry, item_id)
    if not item: raise HTTPException(404, "周安排不存在")
    db.delete(item); db.commit(); return {"deleted": item_id}


@app.patch("/api/v1/homework/{item_id}/status")
def update_homework_status(item_id: str, payload: StatusUpdate, db: Session = Depends(get_db)) -> dict:
    item = db.get(Homework, item_id)
    if not item: raise HTTPException(404, "作业不存在")
    if payload.status not in {"未开始", "进行中", "已完成"}:
        raise HTTPException(422, "安排状态无效")
    item.status = payload.status; db.commit(); return homework_out(item)


@app.post("/api/v1/follow-ups", status_code=201)
def create_followup(payload: FollowUpCreate, db: Session = Depends(get_db)) -> dict:
    item = FollowUp(id=str(uuid4()), **payload.model_dump(), status="待了解", conclusion="", created_at=utcnow())
    db.add(item); db.commit(); return followup_out(item)


@app.put("/api/v1/follow-ups/{item_id}")
def edit_followup(item_id: str, payload: FollowUpCreate, db: Session = Depends(get_db)) -> dict:
    item = db.get(FollowUp, item_id)
    if not item: raise HTTPException(404, "跟进不存在")
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); return followup_out(item)


@app.delete("/api/v1/follow-ups/{item_id}")
def delete_followup(item_id: str, db: Session = Depends(get_db)) -> dict:
    item = db.get(FollowUp, item_id)
    if not item: raise HTTPException(404, "跟进不存在")
    db.delete(item); db.commit(); return {"deleted": item_id}


@app.patch("/api/v1/follow-ups/{item_id}/status")
def update_followup_status(item_id: str, payload: StatusUpdate, db: Session = Depends(get_db)) -> dict:
    item = db.get(FollowUp, item_id)
    if not item: raise HTTPException(404, "跟进不存在")
    allowed = {
        "待了解": {"行动中", "已结束"},
        "行动中": {"待回顾", "已结束"},
        "待回顾": {"行动中", "已结束"},
        "已结束": {"待了解"},
    }
    if payload.status not in allowed.get(item.status, set()): raise HTTPException(409, "不允许的状态转换")
    if payload.status == "已结束" and not payload.conclusion.strip(): raise HTTPException(422, "结束跟进必须填写回顾结论")
    previous_status = item.status
    item.status = payload.status
    if payload.status == "已结束":
        item.conclusion = payload.conclusion.strip()
    elif previous_status == "已结束":
        item.conclusion = ""
    db.commit(); return followup_out(item)


@app.post("/api/v1/goals", status_code=201)
def create_goal(payload: GoalCreate, db: Session = Depends(get_db)) -> dict:
    item = Goal(id=str(uuid4()), **payload.model_dump(), status="进行中", created_at=utcnow())
    db.add(item); db.commit(); return goal_out(item)


@app.put("/api/v1/goals/{item_id}")
def edit_goal(item_id: str, payload: GoalCreate, db: Session = Depends(get_db)) -> dict:
    item = db.get(Goal, item_id)
    if not item: raise HTTPException(404, "目标不存在")
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); return goal_out(item)


@app.delete("/api/v1/goals/{item_id}")
def delete_goal(item_id: str, db: Session = Depends(get_db)) -> dict:
    item = db.get(Goal, item_id)
    if not item: raise HTTPException(404, "目标不存在")
    db.delete(item); db.commit(); return {"deleted": item_id}


@app.patch("/api/v1/goals/{item_id}/status")
def update_goal_status(item_id: str, payload: StatusUpdate, db: Session = Depends(get_db)) -> dict:
    item = db.get(Goal, item_id)
    if not item: raise HTTPException(404, "目标不存在")
    if payload.status not in {"进行中", "已完成", "已暂停"}: raise HTTPException(422, "目标状态无效")
    item.status = payload.status; db.commit(); return goal_out(item)


@app.get("/api/v1/family")
def get_family(db: Session = Depends(get_db)) -> dict:
    family = db.get(FamilyProfile, 1)
    return {"name": family.name, "timezone": family.timezone, "members": family.members.split(",")}


@app.put("/api/v1/family")
def update_family(payload: FamilyUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    require_guardian(request)
    family = db.get(FamilyProfile, 1)
    family.name, family.timezone = payload.name.strip(), payload.timezone.strip()
    family.members = ",".join(x.strip() for x in payload.members if x.strip())
    db.commit(); return {"name": family.name, "timezone": family.timezone, "members": family.members.split(",")}
