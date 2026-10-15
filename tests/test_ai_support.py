"""Offline integration tests; never sends family data to a provider."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
temp = tempfile.TemporaryDirectory()
os.environ.update(DATABASE_URL=f"sqlite:///{Path(temp.name, 'ai.db').as_posix()}", SEED_DEMO_DATA="false",
                  AI_ENABLED="true", DEEPSEEK_API_KEY="test-only-not-a-real-key")
from fastapi.testclient import TestClient
from apps.api import main, ai_support


class AIFlow(unittest.TestCase):
    def test_review_flow(self):
        with TestClient(main.app) as c:
            def post(path, body):
                return c.post('/api/v1'+path, json=body)
            token = post('/auth/setup', dict(username='guardian', password='test-password', display_name='Parent', role='监护人')).json()['token']
            c.headers['Authorization'] = 'Bearer '+token
            member = post('/auth/accounts', dict(username='member', password='test-password', display_name='Member', role='家庭成员'))
            self.assertEqual(member.status_code, 201)
            rec = post('/records', dict(title='完成阅读', category='学习', child_quote='我想继续')).json()
            key = 'record:'+rec['id']
            selection = dict(sources=[key], context=[])
            p = post('/ai/preview', selection).json()
            self.assertEqual(set(p['snapshot']['context']), {'age', 'grade'})
            self.assertEqual(post('/ai/preview', {**selection, 'injected_body': 'do not trust'}).status_code, 422)
            self.assertEqual(post('/ai/preview', {'sources': [key]*51}).status_code, 422)
            self.assertEqual(post('/ai/preview', {'sources': ['record:missing']}).status_code, 409)
            full = post('/ai/preview', {**selection, 'context': ['traits', 'interests', 'support_note']}).json()
            self.assertIn('traits_note', full['snapshot']['context'])
            hw = post('/homework', dict(subject='数学', content='练习', due_label='明天', support_mode='需要提示')).json()
            candidates = c.get('/api/v1/ai/candidates?days=7').json()['sources']
            self.assertTrue({key, 'homework:'+hw['id']} <= {x['id'] for x in candidates})
            hw_key = 'homework:'+hw['id']
            hw_preview = post('/ai/preview', {'sources': [hw_key]}).json()
            brief_advice = dict(goal='本次辅导建议', steps=['准备：读清要求。\n思路：先让孩子尝试。\n检查：核对完成内容。'],
                                frequency='本次安排', review='完成后核对任务要求', source_ids=[hw_key])
            brief_result = ai_support.Result(facts=[], strengths=[], hypotheses=[], questions=[], suggestions=[brief_advice])
            with patch.object(ai_support, 'call_model', AsyncMock(return_value=brief_result)):
                generated = post('/ai/analyses', dict(sources=[hw_key], preview_hash=hw_preview['hash'], request_id='brief-homework'))
            self.assertEqual(generated.status_code, 200, generated.text)
            brief = generated.json()
            self.assertEqual(len(brief['items']), 1)
            brief_item = brief['items'][0]
            self.assertEqual(brief_item['status'], 'pending')
            edited_brief = {**brief_advice, 'steps': ['家长修改：先独立尝试，再核对题目要求。']}
            saved = c.put('/api/v1/ai/suggestions/'+brief_item['id'], json=dict(version=1, status='accepted', advice=edited_brief))
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json()['items'][0]['status'], 'accepted')
            self.assertEqual(saved.json()['result']['suggestions'][0]['steps'], brief_advice['steps'])
            reopened = c.get('/api/v1/ai/analyses', params={'source_id': hw_key}).json()
            self.assertEqual([x['id'] for x in reopened], [brief['id']])
            self.assertEqual(reopened[0]['items'][0]['advice']['steps'], edited_brief['steps'])
            self.assertEqual(c.get('/api/v1/ai/analyses', params={'source_id': key}).json(), [])
            self.assertEqual(c.put('/api/v1/ai/suggestions/'+brief_item['id'], json=dict(version=1, status='accepted', advice=edited_brief)).status_code, 409)
            self.assertEqual(len(c.get('/api/v1/bootstrap').json()['homework']), 1)
            self.assertEqual(len(c.get('/api/v1/bootstrap').json()['followups']), 0)
            c.delete('/api/v1/homework/'+hw['id'])
            self.assertEqual(c.get('/api/v1/ai/analyses', params={'source_id': hw_key}).status_code, 409)
            advice = dict(goal='一起阅读', steps=['让孩子选择一本书'], frequency='每天10分钟', review='一周后询问感受', source_ids=[key])
            result = ai_support.Result(facts=[dict(text='完成阅读', source_ids=[key])], strengths=[], hypotheses=[], questions=['喜欢什么书？'], suggestions=[advice]*3)
            payload = dict(**selection, preview_hash=p['hash'], request_id='test-one')
            self.assertEqual(post('/ai/analyses', {**payload, 'preview_hash': 'stale'}).status_code, 409)
            with patch.dict(os.environ, AI_ENABLED='false'):
                self.assertEqual(post('/ai/analyses', payload).status_code, 503)
            with patch.object(ai_support, 'call_model', AsyncMock(return_value=result)) as provider:
                response = post('/ai/analyses', payload)
                self.assertEqual(response.status_code, 200, response.text)
                a = response.json()
                self.assertEqual(post('/ai/analyses', payload).json()['id'], a['id'])
                self.assertEqual(provider.await_count, 1)
            item = a['items'][0]
            self.assertEqual(len(c.get('/api/v1/bootstrap').json()['homework']), 0)
            action = dict(version=1, kind='homework', current_hash=a['current_hash'], title='一起阅读', content='一起阅读10分钟', due_label='2026-10-20 19:00', subject='语文')
            self.assertEqual(post(f"/ai/suggestions/{item['id']}/action", action).status_code, 409)
            edited_advice = {**advice, 'goal': '家长修改后的目标'}
            reviewed = c.put(f"/api/v1/ai/suggestions/{item['id']}", json=dict(version=1, status='accepted', advice=edited_advice))
            self.assertEqual(reviewed.status_code, 200, reviewed.text)
            self.assertEqual(reviewed.json()['result']['suggestions'][0]['goal'], advice['goal'])
            self.assertEqual(next(x for x in reviewed.json()['items'] if x['id']==item['id'])['advice']['goal'], edited_advice['goal'])
            self.assertEqual(c.put(f"/api/v1/ai/suggestions/{item['id']}", json=dict(version=1, status='accepted', advice=advice)).status_code, 409)
            action['version'] = 2
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=2) as pool:
                concurrent = list(pool.map(lambda _: post(f"/ai/suggestions/{item['id']}/action", action), range(2)))
            target = concurrent[0]
            self.assertEqual(target.status_code, 200, target.text)
            self.assertEqual(concurrent[1].json(), target.json())
            self.assertEqual(post(f"/ai/suggestions/{item['id']}/action", action).json(), target.json())
            self.assertEqual(len(c.get('/api/v1/bootstrap').json()['homework']), 1)
            item2 = a['items'][1]
            c.put(f"/api/v1/ai/suggestions/{item2['id']}", json=dict(version=1, status='accepted', advice=advice))
            c.put('/api/v1/records/'+rec['id'], json=dict(title='修改后的记录', category='学习', child_quote='新的原话'))
            fresh = c.get('/api/v1/ai/analyses/'+a['id']).json()
            self.assertTrue(fresh['changed'])
            self.assertEqual(post(f"/ai/suggestions/{item2['id']}/action", action).status_code, 409)
            third = a['items'][2]
            c.put(f"/api/v1/ai/suggestions/{third['id']}", json=dict(version=1, status='rejected', advice=advice))
            confirmed = {**action, 'current_hash': fresh['current_hash'], 'confirm_updated': True,
                         'kind': 'followup', 'owner': '妈妈', 'review_date': '2026-10-22'}
            self.assertEqual(post(f"/ai/suggestions/{third['id']}/action", confirmed).status_code, 409)
            c.put(f"/api/v1/ai/suggestions/{third['id']}", json=dict(version=2, status='accepted', advice=advice))
            self.assertEqual(post(f"/ai/suggestions/{third['id']}/action", {**confirmed, 'version': 3, 'confirm_updated': False}).status_code, 409)
            followup = post(f"/ai/suggestions/{third['id']}/action", {**confirmed, 'version': 3})
            self.assertEqual(followup.status_code, 200, followup.text)
            self.assertEqual(len(c.get('/api/v1/bootstrap').json()['followups']), 1)
            c.delete('/api/v1/records/'+rec['id'])
            self.assertTrue(c.get('/api/v1/ai/analyses/'+a['id']).json()['deleted'])
            self.assertEqual(post(f"/ai/suggestions/{item2['id']}/action", action).status_code, 409)
            mt = post('/auth/login', dict(username='member', password='test-password')).json()['token']
            c.headers['Authorization'] = 'Bearer '+mt
            self.assertEqual(post('/ai/preview', selection).status_code, 403)
            self.assertEqual(post('/ai/analyses', payload).status_code, 403)
            self.assertEqual(c.get('/api/v1/ai/analyses', params={'source_id': hw_key}).status_code, 403)
            visible = c.get('/api/v1/ai/analyses/'+a['id']).json()
            self.assertNotIn('snapshot', visible)
            self.assertNotIn('result', visible)
            self.assertTrue(all(x['status']=='accepted' for x in visible['items']))
            self.assertEqual(c.put(f"/api/v1/ai/suggestions/{item['id']}", json=dict(version=3, status='rejected', advice=advice)).status_code, 403)
            self.assertEqual(post(f"/ai/suggestions/{item['id']}/action", action).status_code, 403)
            c.headers['Authorization'] = 'Bearer '+token
            new_record = post('/records', dict(title='额度测试', category='学习', child_quote='')).json()
            sel = {'sources': ['record:'+new_record['id']]}
            pv = post('/ai/preview', sel).json()
            quota_payload = {**sel, 'preview_hash': pv['hash'], 'request_id': 'quota-test'}
            from sqlalchemy import update
            table = main.Base.metadata.tables['ai_account_limits']
            with main.engine.begin() as conn:
                conn.execute(update(table).values(count=20))
            self.assertEqual(post('/ai/analyses', quota_payload).status_code, 429)
            with main.engine.begin() as conn:
                conn.execute(update(table).values(count=0, busy_until='9999-01-01'))
            self.assertEqual(post('/ai/analyses', quota_payload).status_code, 429)
            with main.engine.begin() as conn:
                conn.execute(update(table).values(busy_until=''))
            from fastapi import HTTPException
            with patch.object(ai_support, 'call_model', AsyncMock(side_effect=HTTPException(504, 'timeout'))):
                self.assertEqual(post('/ai/analyses', quota_payload).status_code, 504)
            with main.engine.connect() as conn:
                limit = conn.execute(table.select()).mappings().first()
                self.assertEqual(limit['busy_until'], '')
                self.assertEqual(limit['count'], 1)

    def test_provider_validation(self):
        import asyncio
        from fastapi import HTTPException
        import httpx
        snapshot = {'sources': [{'id': 'record:1'}]}
        good = dict(goal='观察', steps=['记录'], frequency='每天', review='一周', source_ids=['record:wrong'])
        body = dict(facts=[], strengths=[], questions=[], hypotheses=[], suggestions=[good]*3)
        import json
        response = httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(body)}}]})
        with patch('httpx.AsyncClient.post', AsyncMock(return_value=response)):
            with self.assertRaises(HTTPException) as e:
                asyncio.run(ai_support.call_model(snapshot))
            self.assertEqual(e.exception.status_code, 502)
        with patch('httpx.AsyncClient.post', AsyncMock(side_effect=httpx.ReadTimeout('timeout'))):
            with self.assertRaises(HTTPException) as e:
                asyncio.run(ai_support.call_model(snapshot))
            self.assertEqual(e.exception.status_code, 504)
        for response in [httpx.Response(402), httpx.Response(200, json={'choices': [{'message': {'content': 'not JSON'}}]})]:
            with patch('httpx.AsyncClient.post', AsyncMock(return_value=response)):
                with self.assertRaises(HTTPException) as e:
                    asyncio.run(ai_support.call_model(snapshot))
                self.assertEqual(e.exception.status_code, 502)
        body['suggestions'] = [{**good, 'source_ids': ['record:1']}]
        response = httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(body)}}]})
        with patch('httpx.AsyncClient.post', AsyncMock(return_value=response)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(ai_support.call_model(snapshot))
            self.assertEqual(error.exception.status_code, 502)

    def test_time_window_and_size(self):
        from datetime import datetime, timezone
        from sqlalchemy import delete
        with TestClient(main.app) as c:
            token = c.post('/api/v1/auth/login', json=dict(username='guardian', password='test-password')).json()['token']
            c.headers['Authorization'] = 'Bearer '+token
            with main.SessionLocal() as db:
                db.execute(delete(main.GrowthRecord))
                # Oct 9 00:00 Beijing is included; one second before is excluded.
                for identifier, stamp in [('boundary', '2026-10-08T16:00:00+00:00'), ('outside', '2026-10-08T15:59:59+00:00')]:
                    db.add(main.GrowthRecord(id=identifier, title=identifier, category='学习', child_quote='', created_by='Parent',
                                            occurred_at=datetime.fromisoformat(stamp)))
                child = db.get(main.ChildProfile, 1)
                child.traits = '长' * 21000
                db.commit()
            class Frozen(datetime):
                @classmethod
                def now(cls, tz=None):
                    return datetime(2026, 10, 15, 2, tzinfo=timezone.utc)
            with patch.object(ai_support, 'datetime', Frozen):
                ids = {s['id'] for s in c.get('/api/v1/ai/candidates?days=7').json()['sources']}
                self.assertIn('record:boundary', ids)
                self.assertNotIn('record:outside', ids)
                ids30 = {s['id'] for s in c.get('/api/v1/ai/candidates?days=30').json()['sources']}
                self.assertIn('record:outside', ids30)
            response = c.post('/api/v1/ai/preview', json={'sources': ['record:boundary'], 'context': ['traits']})
            self.assertEqual(response.status_code, 422)

    def test_provider_failure_messages(self):
        import asyncio
        import httpx
        from fastapi import HTTPException
        snapshot = {'sources': [{'id': 'homework:example'}]}
        for status, message in [(400, '请求配置'), (401, '密钥无效'), (402, '余额不足'),
                                (403, '拒绝访问'), (404, '接口地址不存在'), (429, '过于频繁'), (500, '暂不可用')]:
            with self.subTest(status=status), patch('httpx.AsyncClient.post', AsyncMock(return_value=httpx.Response(status))):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(ai_support.call_model(snapshot))
                self.assertEqual(error.exception.status_code, 502)
                self.assertIn(message, error.exception.detail)
        for choice, message in [({'finish_reason': 'length', 'message': {'content': '{}'}}, '长度限制'),
                                ({'message': {'content': None}}, '未返回有效结果')]:
            response = httpx.Response(200, json={'choices': [choice]})
            with patch('httpx.AsyncClient.post', AsyncMock(return_value=response)):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(ai_support.call_model(snapshot))
                self.assertIn(message, error.exception.detail)
        with patch('httpx.AsyncClient.post', AsyncMock(side_effect=httpx.ConnectError('sensitive-provider-detail'))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(ai_support.call_model(snapshot))
            self.assertIn('无法连接', error.exception.detail)
            self.assertNotIn('sensitive-provider-detail', error.exception.detail)

    def test_homework_tutoring_contract(self):
        import asyncio
        import json
        import httpx
        from fastapi import HTTPException
        key = 'homework:example'
        snapshot = {'context': {'age': 7, 'grade': '一年级'}, 'sources': [
            {'id': key, 'type': '家庭作业', 'subject': '数学', 'content': '理解加法应用题，先读题再画图',
             'due_label': '2026-10-22 20:00', 'support_mode': '需要提示', 'check_required': True}
        ]}
        body = dict(source_id=key, content='准备：读清题目要求。\n思路：让孩子说出条件，再尝试画图。\n检查：核对条件和问题；尚缺具体题干，仅供通用参考。')
        def response():
            return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(body)}}]})
        with patch('httpx.AsyncClient.post', AsyncMock(return_value=response())) as provider:
            result = asyncio.run(ai_support.call_model(snapshot))
            self.assertEqual(len(result.suggestions), 1)
            self.assertEqual(result.suggestions[0].steps, [body['content']])
            self.assertEqual(result.suggestions[0].source_ids, [key])
            self.assertIsNone(result.tutoring)
            self.assertEqual(provider.call_args.kwargs['json']['thinking'], {'type': 'disabled'})
            sent = provider.call_args.kwargs['json']['messages']
            self.assertIn('不得虚构题干', sent[0]['content'])
            self.assertIn('最多500字', sent[0]['content'])
            self.assertEqual(json.loads(sent[1]['content']), snapshot)
        for invalid in [dict(source_id='homework:unrelated', content='不能引用其他安排'),
                        dict(source_id=key, content='冗长' * 251), dict(source_id=key, content='   '),
                        dict(source_id=key)]:
            body = invalid
            with self.subTest(body=invalid), patch('httpx.AsyncClient.post', AsyncMock(return_value=response())):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(ai_support.call_model(snapshot))
                self.assertEqual(error.exception.status_code, 502)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        main.engine.dispose()
        temp.cleanup()
