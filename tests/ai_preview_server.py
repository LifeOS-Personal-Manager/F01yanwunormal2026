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
    tutoring = None
    if len(ids) == 1 and ids[0].startswith('homework:'):
        tutoring = dict(source_id=ids[0], task_summary='本地模拟：根据本次安排提供辅导路线', objectives=['理解要求，独立尝试'],
                        plan=['准备材料2分钟', '孩子尝试10分钟', '提示与回顾5分钟'],
                        solution_approach=['先明确要求，再分解步骤，最后检查'],
                        parent_prompts=['你准备先做哪一步？'], self_check=['是否完成题目要求？'])
    return ai_support.Result(
        facts=[{'text': '本地模拟：根据选中的记录整理事实。', 'source_ids': ids}],
        strengths=[], hypotheses=[], questions=['孩子希望获得什么帮助？'],
        suggestions=[dict(goal=f'本地模拟建议 {i+1}', steps=['和孩子一起选择一个小目标'], frequency='每天10分钟', review='一周后讨论感受', source_ids=ids) for i in range(3)],
        tutoring=tutoring,
    )


if __name__ == '__main__':
    ai_support.call_model = fake
    try:
        uvicorn.run(main.app, host='127.0.0.1', port=8002, access_log=False)
    finally:
        main.engine.dispose()
        temp.cleanup()
