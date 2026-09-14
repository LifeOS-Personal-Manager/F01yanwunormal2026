"""Run the API's primary user flow against an isolated temporary database."""

from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def main() -> None:
    port = free_port()
    base_url = f"http://127.0.0.1:{port}/api/v1"
    with tempfile.TemporaryDirectory(prefix="yanwu-e2e-") as temp_dir:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": f"sqlite:///{Path(temp_dir, 'test.db').as_posix()}",
                "SEED_DEMO_DATA": "false",
            }
        )
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "apps.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            wait_until_ready(base_url, process)
            run_flow(base_url)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
            # Windows can retain SQLite's file handle briefly after uvicorn exits.
            time.sleep(0.3)


def request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    body: dict | None = None,
    token: str | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict | list]:
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    payload = json.dumps(body).encode() if body is not None else None
    web_request = Request(
        f"{base_url}{path}",
        data=payload,
        headers=request_headers,
        method=method,
    )
    try:
        with urlopen(web_request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


def expect(status: int, expected: int, label: str) -> None:
    if status != expected:
        raise AssertionError(f"{label}: expected HTTP {expected}, received {status}")


def wait_until_ready(base_url: str, process: subprocess.Popen) -> None:
    for _ in range(50):
        if process.poll() is not None:
            raise RuntimeError("temporary API exited before becoming ready")
        try:
            status, _ = request(base_url, "/health")
            if status == 200:
                return
        except URLError:
            pass
        time.sleep(0.1)
    raise RuntimeError("temporary API did not become ready")


def run_flow(base_url: str) -> None:
    guardian_name = f"qa-{secrets.token_hex(5)}"
    member_name = f"qa-{secrets.token_hex(5)}"
    guardian_password = secrets.token_urlsafe(16)
    member_password = secrets.token_urlsafe(16)

    status, _ = request(base_url, "/bootstrap")
    expect(status, 401, "anonymous data access")
    status, body = request(base_url, "/auth/status")
    expect(status, 200, "account status")
    assert body == {"has_accounts": False}

    status, _ = request(
        base_url,
        "/auth/setup",
        method="POST",
        body={
            "username": guardian_name,
            "password": guardian_password,
            "display_name": "验收监护人",
            "role": "家庭成员",
        },
    )
    expect(status, 422, "first account role guard")

    status, body = request(
        base_url,
        "/auth/setup",
        method="POST",
        body={
            "username": guardian_name,
            "password": guardian_password,
            "display_name": "验收监护人",
            "role": "监护人",
        },
    )
    expect(status, 201, "guardian setup")
    guardian_token = str(body["token"])

    status, bootstrap = request(base_url, "/bootstrap", token=guardian_token)
    expect(status, 200, "bootstrap")
    assert bootstrap["records"] == [] and bootstrap["homework"] == []

    status, member = request(
        base_url,
        "/auth/accounts",
        method="POST",
        token=guardian_token,
        body={
            "username": member_name,
            "password": member_password,
            "display_name": "验收成员",
            "role": "家庭成员",
        },
    )
    expect(status, 201, "member creation")
    member_id = str(member["id"])
    status, body = request(
        base_url,
        "/auth/login",
        method="POST",
        body={"username": member_name, "password": member_password},
    )
    expect(status, 200, "member login")
    member_token = str(body["token"])
    status, _ = request(
        base_url,
        "/family",
        method="PUT",
        token=member_token,
        body={"name": "无权修改", "timezone": "Asia/Shanghai", "members": []},
    )
    expect(status, 403, "member family permission")

    record_payload = {
        "title": "验收：独立完成阅读记录",
        "category": "学习",
        "child_quote": "我先自己读完了。",
    }
    idempotency_key = secrets.token_hex(12)
    status, record = request(
        base_url,
        "/records",
        method="POST",
        token=guardian_token,
        body=record_payload,
        headers={"Idempotency-Key": idempotency_key},
    )
    expect(status, 201, "record creation")
    record_id = str(record["id"])
    status, repeated_record = request(
        base_url,
        "/records",
        method="POST",
        token=guardian_token,
        body=record_payload,
        headers={"Idempotency-Key": idempotency_key},
    )
    expect(status, 201, "record idempotency")
    assert repeated_record["id"] == record_id
    status, record = request(
        base_url,
        f"/records/{record_id}",
        method="PUT",
        token=guardian_token,
        body={**record_payload, "title": "验收：阅读记录已更新"},
    )
    expect(status, 200, "record update")
    assert record["version"] == 2

    status, converted = request(
        base_url,
        f"/records/{record_id}/follow-up",
        method="POST",
        token=guardian_token,
    )
    expect(status, 201, "record conversion")
    converted_id = str(converted["id"])
    status, converted_again = request(
        base_url,
        f"/records/{record_id}/follow-up",
        method="POST",
        token=guardian_token,
    )
    expect(status, 201, "record conversion idempotency")
    assert converted_again["id"] == converted_id

    homework_payload = {
        "subject": "阅读",
        "content": "验收安排",
        "due_label": "今天 20:00",
        "support_mode": "自己完成",
        "check_required": True,
    }
    status, homework = request(base_url, "/homework", method="POST", token=guardian_token, body=homework_payload)
    expect(status, 201, "daily item creation")
    homework_id = str(homework["id"])
    status, _ = request(base_url, f"/homework/{homework_id}", method="PUT", token=guardian_token, body={**homework_payload, "content": "验收安排已编辑"})
    expect(status, 200, "daily item update")
    for item_status in ("进行中", "已完成", "未开始"):
        status, _ = request(base_url, f"/homework/{homework_id}/status", method="PATCH", token=guardian_token, body={"status": item_status})
        expect(status, 200, f"daily item status {item_status}")
    status, _ = request(base_url, f"/homework/{homework_id}/status", method="PATCH", token=guardian_token, body={"status": "未知"})
    expect(status, 422, "daily item invalid status")

    status, _ = request(base_url, "/schedule/plan", method="PUT", token=guardian_token, body={"name": "验收周期", "period_start": "2026-09-14", "period_end": "2026-09-13"})
    expect(status, 422, "schedule period guard")
    status, _ = request(base_url, "/schedule/plan", method="PUT", token=guardian_token, body={"name": "验收周期", "period_start": "2026-09-14", "period_end": "2026-09-20"})
    expect(status, 200, "schedule plan update")
    entry_payload = {"category": "饮食", "module": "早餐", "weekday": 1, "time_label": "07:30", "content": "验收早餐"}
    status, entry = request(base_url, "/schedule/entries", method="POST", token=guardian_token, body=entry_payload)
    expect(status, 201, "schedule entry creation")
    entry_id = str(entry["id"])
    status, _ = request(base_url, f"/schedule/entries/{entry_id}", method="PUT", token=guardian_token, body={**entry_payload, "content": "验收早餐已编辑"})
    expect(status, 200, "schedule entry update")

    follow_payload = {"title": "验收跟进", "fact": "验收事实", "owner": "妈妈", "review_label": "本周回顾", "priority": "中"}
    status, follow = request(base_url, "/follow-ups", method="POST", token=guardian_token, body=follow_payload)
    expect(status, 201, "follow-up creation")
    follow_id = str(follow["id"])
    status, _ = request(base_url, f"/follow-ups/{follow_id}", method="PUT", token=guardian_token, body={**follow_payload, "fact": "验收事实已编辑"})
    expect(status, 200, "follow-up update")
    status, _ = request(base_url, f"/follow-ups/{follow_id}/status", method="PATCH", token=guardian_token, body={"status": "行动中"})
    expect(status, 200, "follow-up action transition")
    status, _ = request(base_url, f"/follow-ups/{follow_id}/status", method="PATCH", token=guardian_token, body={"status": "已结束", "conclusion": ""})
    expect(status, 422, "follow-up conclusion guard")
    status, follow = request(base_url, f"/follow-ups/{follow_id}/status", method="PATCH", token=guardian_token, body={"status": "已结束", "conclusion": "验收结论"})
    expect(status, 200, "follow-up completion")
    assert follow["conclusion"] == "验收结论"

    goal_payload = {"title": "验收目标", "category": "生活自主", "child_agreement": "认可", "parent_support": "提供清单", "review_label": "本月回顾"}
    status, goal = request(base_url, "/goals", method="POST", token=guardian_token, body=goal_payload)
    expect(status, 201, "goal creation")
    goal_id = str(goal["id"])
    status, _ = request(base_url, f"/goals/{goal_id}", method="PUT", token=guardian_token, body={**goal_payload, "parent_support": "逐步减少提醒"})
    expect(status, 200, "goal update")
    status, goal = request(base_url, f"/goals/{goal_id}/status", method="PATCH", token=guardian_token, body={"status": "已完成"})
    expect(status, 200, "goal completion")
    assert goal["status"] == "已完成"

    child_payload = {
        "nickname": "验收孩子",
        "age": 10,
        "grade": "四年级",
        "height": "140 cm",
        "weight": "35 kg",
        "traits": "表达清楚，换环境时需要适应时间。",
        "focus_direction": "自主规划",
        "interests": ["阅读", "运动"],
        "support_note": "先听孩子完整表达。",
    }
    status, child = request(base_url, "/child", method="PUT", token=guardian_token, body=child_payload)
    expect(status, 200, "child profile update")
    assert child["traits"] == child_payload["traits"]
    status, family = request(base_url, "/family", method="PUT", token=guardian_token, body={"name": "言午的成长空间", "timezone": "Asia/Shanghai", "members": ["妈妈", "爸爸"]})
    expect(status, 200, "family update")
    assert family["name"] == "言午的成长空间"

    for path in (
        f"/schedule/entries/{entry_id}",
        f"/homework/{homework_id}",
        f"/follow-ups/{follow_id}",
        f"/follow-ups/{converted_id}",
        f"/goals/{goal_id}",
        f"/records/{record_id}",
        f"/auth/accounts/{member_id}",
    ):
        status, _ = request(base_url, path, method="DELETE", token=guardian_token)
        expect(status, 200, f"delete {path}")

    status, _ = request(base_url, "/auth/logout", method="POST", token=guardian_token)
    expect(status, 200, "logout")
    status, _ = request(base_url, "/bootstrap", token=guardian_token)
    expect(status, 401, "revoked session")
    print("PASS: authentication, permissions, CRUD, status, archive, and idempotency flow")


if __name__ == "__main__":
    main()
