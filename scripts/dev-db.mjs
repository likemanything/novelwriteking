// 本机开发数据库：使用系统已安装的 Postgres（brew install postgresql@16），
// 数据放在项目内的 .dev/pg，端口 54329，只监听本机，不影响你电脑上其它 Postgres。
// 用法：node scripts/dev-db.mjs start | stop | reset | status
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = resolve(ROOT, '.dev/pg');
const LOG = resolve(ROOT, '.dev/pg.log');
const PORT = '54329';
const SOCKET_DIR = '/tmp';
const APP_USER = 'inkloom';
const APP_PASS = 'inkloom';
const APP_DB = 'inkloom';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

function running() {
  return spawnSync('pg_ctl', ['-D', DATA, 'status'], { stdio: 'pipe' }).status === 0;
}

function psql(sql, db = 'postgres') {
  return run('psql', ['-h', SOCKET_DIR, '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql]).trim();
}

function init() {
  if (existsSync(DATA)) return;
  mkdirSync(resolve(ROOT, '.dev'), { recursive: true });
  run('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  console.log('已初始化开发数据库目录 .dev/pg');
}

function start() {
  init();
  if (!running()) {
    run('pg_ctl', ['-D', DATA, '-l', LOG, '-w', '-o', `-p ${PORT} -k ${SOCKET_DIR} -c listen_addresses=localhost`, 'start']);
  }
  // 应用账号：非超级用户，行级安全对它生效
  if (psql(`select 1 from pg_roles where rolname='${APP_USER}'`) !== '1') {
    psql(`create role ${APP_USER} login password '${APP_PASS}' nosuperuser nocreatedb nocreaterole`);
  }
  if (psql(`select 1 from pg_database where datname='${APP_DB}'`) !== '1') {
    psql(`create database ${APP_DB} owner ${APP_USER}`);
  }
  // 测试库（tests/api.test.ts 使用）
  if (psql(`select 1 from pg_database where datname='${APP_DB}_test'`) !== '1') {
    psql(`create database ${APP_DB}_test owner ${APP_USER}`);
  }
  console.log(`开发数据库已启动：postgres://${APP_USER}:${APP_PASS}@127.0.0.1:${PORT}/${APP_DB}`);
}

function stop() {
  if (running()) run('pg_ctl', ['-D', DATA, '-w', 'stop', '-m', 'fast']);
  console.log('开发数据库已停止');
}

const cmd = process.argv[2] ?? 'status';
try {
  if (cmd === 'start') start();
  else if (cmd === 'stop') stop();
  else if (cmd === 'reset') {
    stop();
    rmSync(DATA, { recursive: true, force: true });
    start();
    console.log('开发数据库已清空重建');
  } else console.log(running() ? '开发数据库正在运行' : '开发数据库未运行');
} catch (error) {
  console.error(String(error.stderr || error.message || error));
  if (String(error.message).includes('ENOENT')) console.error('没有找到 Postgres 命令。请先安装：brew install postgresql@16');
  process.exit(1);
}
