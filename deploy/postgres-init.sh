#!/bin/sh
# 首次初始化数据库时执行：创建非超级用户的应用账号（行级安全隔离要求）
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<SQL
create role inkloom login password '${INKLOOM_DB_PASSWORD}' nosuperuser nocreatedb nocreaterole;
create database inkloom owner inkloom;
SQL
