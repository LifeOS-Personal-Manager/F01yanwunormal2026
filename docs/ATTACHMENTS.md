# 单次安排附件

“安排内容”下支持 Word（.doc/.docx）、PDF 和 JPG/JPEG/PNG/GIF/WebP 图片，单文件10MB、单安排5个。选择后上传为当前账号私有临时文件，保存安排时同事务绑定；图片可预览，全部类型可下载。编辑中移除已有文件需保存安排才真正删除，取消编辑不影响已有文件。附件内容暂不传给 DeepSeek，不提取文字、不做OCR。

## 存储与权限

新增 `homework_attachments` 数据表，文件二进制使用 PostgreSQL BYTEA / SQLite BLOB，与业务数据库一起备份，不依赖服务器临时文件系统。此方案适合个人少量作业附件，会占用 Supabase 数据库存储；大量附件应后续迁移到私有对象存储。

上传和下载均需要登录。未绑定文件仅上传人可访问和绑定；已绑定文件沿用当前单家庭安排权限。数据接口仅返回附件名称、类型、大小等元数据，不加载二进制。下载强制 attachment、no-store、nosniff；文件名不作为磁盘路径，服务端检查扩展名与基本文件签名，DOCX检查包结构并拒绝嵌入VBA。不是病毒扫描服务。

未保存临时文件在24小时后的下一次合法上传时清理，每账号最多20个待绑定文件；删除安排时删除关联文件。旧客户端未传 attachment_ids 时保留附件，显式空列表才删除全部。

## 部署

1. 安装更新的 `apps/api/requirements.txt`（增加 python-multipart）。
2. 备份数据库，重启 API，沿用启动增量建表方式创建新表，无须移动现有业务数据。
3. 在 Yanwu 的 Nginx server 或 `/api/v1/` location 内设置 `client_max_body_size 12m;`，然后 `nginx -t`，通过后 reload。仅修改 Yanwu 站点。
4. 发布前端。测试上传一个小文件，保存、重新打开、下载及移除。其他备用托管平台可能有较低的请求体限制，首版以阿里云主站为准。

接口：POST `/api/v1/attachments`（multipart file）；GET `/{id}/download`；DELETE `/{id}`（仅当前账号的临时附件）。安排新增/编辑支持 attachment_ids；响应增加 attachments。先发布后端再发布前端，否则上传会返回404。

验证命令：`python tests/test_attachments.py`。使用临时数据库，不操作真实家庭资料。
