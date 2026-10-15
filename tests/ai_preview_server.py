"""Local browser QA only: isolated temporary DB and in-process fake model.

Run from repo root with the project's Python. Stops/cleans up on Ctrl+C.
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
temp = tempfile.TemporaryDirectory(prefix='yanwu-ai-preview-')
os.environ.update(DATABASE_URL=f"sqlite:///{Path(temp.name, 'preview.db').as_posix()}", SEED_DEMO_DATA='true',
                  AI_ENABLED='true', DEEPSEEK_API_KEY='local-fake-only')
from apps.api import main, ai_support
import uvicorn


async def fake(snapshot):
    ids = [s['id'] for s in snapshot['sources']]
    if len(ids) == 1 and ids[0].startswith('homework:'):
        return ai_support.Result(facts=[], strengths=[], hypotheses=[], questions=[], suggestions=[dict(
            goal='本次辅导建议', steps=['准备：一起读清要求，备好材料。\n思路：让孩子先独立尝试，卡住时用问题提示下一步。\n检查：请孩子复述思路，核对是否满足任务要求。'],
            frequency='本次安排', review='完成后核对任务要求', source_ids=ids,
        )])
    return ai_support.Result(
        facts=[{'text': '本地模拟：根据选中的记录整理事实。', 'source_ids': ids}],
        strengths=[], hypotheses=[], questions=['孩子希望获得什么帮助？'],
        suggestions=[dict(goal=f'本地模拟建议 {i+1}', steps=['和孩子一起选择一个小目标'], frequency='每天10分钟', review='一周后讨论感受', source_ids=ids) for i in range(3)],
    )


if __name__ == '__main__':
    ai_support.call_model = fake
    try:
        uvicorn.run(main.app, host='127.0.0.1', port=8002, access_log=False)
    finally:
        main.engine.dispose()
        temp.cleanup()
