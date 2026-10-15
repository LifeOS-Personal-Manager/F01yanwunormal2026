"""Small private homework attachments stored with the database, not web assets."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import PurePosixPath
from urllib.parse import quote
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from fastapi import Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import ForeignKey, Integer, LargeBinary, String, Text, delete, func, select, update
from sqlalchemy.orm import Mapped, deferred, mapped_column, object_session

MAX_BYTES = 10 * 1024 * 1024
MAX_FILES = 5
MIMES = {'.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
         '.gif': 'image/gif', '.webp': 'image/webp'}


def validate_file(filename, data):
    suffix = PurePosixPath(filename).suffix.lower()
    valid = False
    if suffix == '.pdf':
        valid = data.startswith(b'%PDF-')
    elif suffix == '.doc':
        valid = data.startswith(bytes.fromhex('D0CF11E0A1B11AE1'))
    elif suffix == '.docx':
        try:
            with ZipFile(BytesIO(data)) as archive:
                names = archive.namelist()
                valid = len(names) <= 10000 and 'word/document.xml' in names and '[Content_Types].xml' in names
                valid = valid and not any('vbaproject' in n.lower() for n in names)
        except (BadZipFile, ValueError):
            pass
    elif suffix in ('.jpg', '.jpeg'):
        valid = data.startswith(b'\xff\xd8\xff')
    elif suffix == '.png':
        valid = data.startswith(b'\x89PNG\r\n\x1a\n')
    elif suffix == '.gif':
        valid = data.startswith((b'GIF87a', b'GIF89a'))
    elif suffix == '.webp':
        valid = data.startswith(b'RIFF') and data[8:12] == b'WEBP'
    if not valid:
        raise HTTPException(422, '文件格式不支持或内容与扩展名不符，请选择 Word、PDF 或常见图片')
    return MIMES[suffix]


def register_attachments(app, ns):
    Base, get_db, Homework = ns['Base'], ns['get_db'], ns['Homework']

    class Attachment(Base):
        __tablename__ = 'homework_attachments'
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        homework_id: Mapped[str | None] = mapped_column(ForeignKey('homework.id', ondelete='CASCADE'), nullable=True, index=True)
        owner_id: Mapped[str] = mapped_column(String(36), index=True)
        filename: Mapped[str] = mapped_column(Text)
        content_type: Mapped[str] = mapped_column(String(100))
        size: Mapped[int] = mapped_column(Integer)
        created_at: Mapped[str] = mapped_column(String(40), index=True)
        data: Mapped[bytes] = deferred(mapped_column(LargeBinary))

    def metadata(item):
        return {k: getattr(item, k) for k in ('id', 'filename', 'content_type', 'size', 'created_at')}

    def list_for(homework):
        db = object_session(homework)
        return [metadata(x) for x in db.scalars(select(Attachment).where(Attachment.homework_id == homework.id).order_by(Attachment.created_at))] if db else []

    def bind(db, homework_id, ids, account_id):
        if ids is None:
            return  # Older clients retain existing attachments.
        if len(ids) > MAX_FILES or len(set(ids)) != len(ids):
            raise HTTPException(422, '每次安排最多5个附件，不能重复选择')
        for identifier in ids:
            item = db.get(Attachment, identifier)
            if not item or (item.homework_id != homework_id and not (item.homework_id is None and item.owner_id == account_id)):
                raise HTTPException(409, '附件已失效或不属于此安排，请重新上传')
            if item.homework_id is None:
                result = db.execute(update(Attachment).where(Attachment.id == identifier, Attachment.homework_id.is_(None), Attachment.owner_id == account_id).values(homework_id=homework_id))
                if not result.rowcount:
                    raise HTTPException(409, '附件已关联其他安排，请重新上传')
        db.execute(delete(Attachment).where(Attachment.homework_id == homework_id, Attachment.id.not_in(ids)))

    def remove_for(db, homework_id):
        db.execute(delete(Attachment).where(Attachment.homework_id == homework_id))

    @app.post('/api/v1/attachments', status_code=201)
    async def upload(request: Request, file: UploadFile = File(...), db=Depends(get_db)):
        data = bytearray()
        try:
            while chunk := await file.read(64 * 1024):
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise HTTPException(413, '单个附件不能超过10MB')
        finally:
            await file.close()
        if not data:
            raise HTTPException(422, '不能上传空文件')
        filename = PurePosixPath((file.filename or 'attachment').replace('\\', '/')).name
        filename = ''.join(c for c in filename if ord(c) >= 32)[:200]
        content_type = validate_file(filename, bytes(data))
        cutoff = (datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
        db.execute(delete(Attachment).where(Attachment.homework_id.is_(None), Attachment.created_at < cutoff))
        count = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.owner_id == request.state.account_id, Attachment.homework_id.is_(None)))
        if count >= 20:
            raise HTTPException(429, '待关联附件过多，请删除未使用的附件或稍后再试')
        item = Attachment(id=str(uuid4()), owner_id=request.state.account_id, filename=filename,
                          content_type=content_type, size=len(data), data=bytes(data), created_at=datetime.now(timezone.utc).isoformat())
        db.add(item); db.commit()
        return metadata(item)

    @app.get('/api/v1/attachments/{attachment_id}/download')
    def download(attachment_id: str, request: Request, db=Depends(get_db)):
        item = db.get(Attachment, attachment_id)
        if not item or (item.homework_id is None and item.owner_id != request.state.account_id):
            raise HTTPException(404, '附件不存在或无权访问')
        if item.homework_id is not None and not db.get(Homework, item.homework_id):
            raise HTTPException(404, '关联安排已删除')
        return Response(item.data, media_type=item.content_type, headers={
            'Content-Disposition': "attachment; filename*=UTF-8''" + quote(item.filename, safe=''),
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        })

    @app.delete('/api/v1/attachments/{attachment_id}')
    def discard(attachment_id: str, request: Request, db=Depends(get_db)):
        deleted = db.execute(delete(Attachment).where(Attachment.id == attachment_id,
                             Attachment.owner_id == request.state.account_id, Attachment.homework_id.is_(None))).rowcount
        if not deleted:
            raise HTTPException(404, '临时附件不存在；已关联附件请编辑安排后移除')
        db.commit()
        return {'ok': True}

    return list_for, bind, remove_for
