-- Yanwu GrowTogether initial PostgreSQL schema.
-- The API also calls SQLAlchemy create_all, so this migration is idempotent.

create table if not exists child_profiles (
  id integer primary key,
  nickname varchar(80) not null default '林一',
  age integer not null default 7,
  grade varchar(80) not null default '一年级',
  height varchar(40) not null default '',
  weight varchar(40) not null default '',
  traits text not null default '',
  focus_direction text not null default '',
  interests text not null default '喜欢画画,乐高搭建,观察昆虫,喜欢讲故事',
  support_note text not null default '在需要时给出一个提示，先让孩子自己尝试；完成后一起回顾哪一步最有帮助。'
);

create table if not exists family_profiles (
  id integer primary key,
  name varchar(100) not null default '言午的成长空间',
  timezone varchar(80) not null default 'Asia/Shanghai',
  members text not null default '妈妈 · 林晓,爸爸 · 林川,外婆 · 陈芳'
);

create table if not exists growth_records (
  id varchar(36) primary key,
  title text not null,
  category varchar(40) not null,
  child_quote text not null default '',
  occurred_at timestamptz not null,
  created_by varchar(80) not null default '妈妈 · 林晓',
  version integer not null default 1,
  idempotency_key varchar(80) unique
);
create index if not exists ix_growth_records_category on growth_records(category);
create index if not exists ix_growth_records_occurred_at on growth_records(occurred_at);

create table if not exists homework (
  id varchar(36) primary key,
  subject varchar(40) not null,
  content text not null,
  due_label varchar(80) not null,
  support_mode varchar(40) not null default '自己完成',
  status varchar(20) not null default '未开始',
  check_required boolean not null default false,
  created_at timestamptz not null
);

create table if not exists schedule_plans (
  id integer primary key,
  name varchar(120) not null default '本学期日程计划',
  period_start date not null,
  period_end date not null
);

create table if not exists schedule_entries (
  id varchar(36) primary key,
  category varchar(40) not null,
  module varchar(80) not null,
  weekday integer not null check (weekday between 1 and 7),
  time_label varchar(80) not null default '',
  content text not null,
  created_at timestamptz not null
);

create table if not exists follow_ups (
  id varchar(36) primary key,
  source_record_id varchar(36) unique,
  title text not null,
  fact text not null,
  owner varchar(80) not null default '妈妈',
  review_label varchar(80) not null default '本周回顾',
  priority varchar(10) not null default '中',
  status varchar(20) not null default '待了解',
  conclusion text not null default '',
  created_at timestamptz not null
);

create table if not exists goals (
  id varchar(36) primary key,
  title text not null,
  category varchar(40) not null default '成长探索',
  child_agreement varchar(20) not null default '待讨论',
  parent_support text not null default '',
  review_label varchar(80) not null default '本月回顾',
  status varchar(20) not null default '进行中',
  created_at timestamptz not null
);

create table if not exists family_accounts (
  id varchar(36) primary key,
  username varchar(80) not null unique,
  display_name varchar(80) not null,
  role varchar(20) not null,
  password_hash text not null,
  created_at timestamptz not null
);
create index if not exists ix_family_accounts_username on family_accounts(username);

create table if not exists auth_sessions (
  token_hash varchar(64) primary key,
  account_id varchar(36) not null references family_accounts(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists ix_auth_sessions_account_id on auth_sessions(account_id);
