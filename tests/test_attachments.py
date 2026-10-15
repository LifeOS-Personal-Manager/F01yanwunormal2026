"""Attachment ownership, validation, linkage, retention and byte round-trip."""
import base64
from io import BytesIO
import os
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
temp = tempfile.TemporaryDirectory(prefix='yanwu-files-')
os.environ.update(DATABASE_URL=f"sqlite:///{Path(temp.name, 'files.db').as_posix()}", SEED_DEMO_DATA='false')
from fastapi.testclient import TestClient
from apps.api import main


class Attachments(unittest.TestCase):
    def test_files(self):
        pdf = b'%PDF-1.4\n%%EOF'
        image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==')
        docx = BytesIO()
        with ZipFile(docx, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        with TestClient(main.app) as c:
            def upload(name, data):
                return c.post('/api/v1/attachments', files={'file': (name, data)})
            self.assertEqual(upload('test.pdf', pdf).status_code, 401)
            token = c.post('/api/v1/auth/setup', json=dict(username='file-parent', password='testing-only-2026', display_name='Parent', role='监护人')).json()['token']
            c.headers['Authorization'] = 'Bearer '+token
            c.post('/api/v1/auth/accounts', json=dict(username='file-member', password='testing-only-2026', display_name='Member', role='家庭成员'))
            ids = []
            for name, data in [('试卷.pdf', pdf), ('题目.png', image), ('要求.docx', docx.getvalue())]:
                response = upload(name, data)
                self.assertEqual(response.status_code, 201, response.text)
                file = response.json(); ids.append(file['id'])
                response = c.get('/api/v1/attachments/'+file['id']+'/download')
                self.assertEqual(response.content, data)
                self.assertIn('attachment;', response.headers['content-disposition'])
                self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(upload('bad.svg', b'<svg/>').status_code, 422)
            self.assertEqual(upload('bad.pdf', b'<html>not pdf</html>').status_code, 422)
            self.assertEqual(upload('empty.pdf', b'').status_code, 422)
            self.assertEqual(upload('large.pdf', b'%PDF-'+b'x'*(10*1024*1024)).status_code, 413)
            member_token = c.post('/api/v1/auth/login', json=dict(username='file-member', password='testing-only-2026')).json()['token']
            c.headers['Authorization'] = 'Bearer '+member_token
            self.assertEqual(c.get('/api/v1/attachments/'+ids[0]+'/download').status_code, 404)
            payload = dict(subject='语文', content='朗读课文', due_label='今晚', attachment_ids=ids)
            self.assertEqual(c.post('/api/v1/homework', json=payload).status_code, 409)
            c.headers['Authorization'] = 'Bearer '+token
            self.assertEqual(c.get('/api/v1/bootstrap').json()['homework'], [])
            response = c.post('/api/v1/homework', json=payload)
            self.assertEqual(response.status_code, 201, response.text)
            hw = response.json()
            self.assertEqual(len(hw['attachments']), 3)
            self.assertNotIn('data', hw['attachments'][0])
            # Cannot attach a previously claimed file to a second task.
            self.assertEqual(c.post('/api/v1/homework', json=payload).status_code, 409)
            self.assertEqual(c.delete('/api/v1/attachments/'+ids[0]).status_code, 404)
            old_client = {k: v for k, v in payload.items() if k != 'attachment_ids'}
            self.assertEqual(len(c.put('/api/v1/homework/'+hw['id'], json=old_client).json()['attachments']), 3)
            c.headers['Authorization'] = 'Bearer '+member_token
            self.assertEqual(c.get('/api/v1/attachments/'+ids[0]+'/download').status_code, 200)
            # Existing family members can remove attachments through editing the shared task.
            response = c.put('/api/v1/homework/'+hw['id'], json={**payload, 'attachment_ids': ids[1:]})
            self.assertEqual(len(response.json()['attachments']), 2)
            self.assertEqual(c.get('/api/v1/attachments/'+ids[0]+'/download').status_code, 404)
            c.delete('/api/v1/homework/'+hw['id'])
            self.assertEqual(c.get('/api/v1/attachments/'+ids[1]+'/download').status_code, 404)
            # User can discard only their own temporary upload.
            tmp = upload('temp.pdf', pdf).json()['id']
            self.assertEqual(c.delete('/api/v1/attachments/'+tmp).status_code, 200)
            self.assertEqual(c.get('/api/v1/attachments/'+tmp+'/download').status_code, 404)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        main.engine.dispose(); temp.cleanup()
