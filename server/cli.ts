/**
 * 运维命令：
 *   npm run migrate                              执行数据库迁移
 *   npm run admin -- code [数量] [使用次数] [备注]  生成内测邀请码
 *   npm run admin -- codes                       查看邀请码
 *   npm run admin -- make-admin 13800000000      把已注册的用户设为平台管理员
 *   npm run admin -- disable 13800000000         停用账号（并让其所有设备退出登录）
 */
import { createSignupCode } from './admin.ts';
import { sql, migrate } from './db/pool.ts';
import { normalizePhone } from './lib/phone.ts';

const [cmd, ...args] = process.argv.slice(2);

async function run() {
  switch (cmd) {
    case 'migrate':
      await migrate();
      console.log('数据库迁移完成');
      break;
    case 'code': {
      const count = Math.min(100, Math.max(1, Number(args[0] ?? 1) || 1));
      const uses = Math.max(1, Number(args[1] ?? 1) || 1);
      const note = args.slice(2).join(' ');
      for (let i = 0; i < count; i++) console.log(await createSignupCode({ maxUses: uses, note }));
      break;
    }
    case 'codes': {
      const rows = await sql<{ code: string; note: string; max_uses: number; used_count: number }[]>`select code, note, max_uses, used_count from signup_codes order by created_at desc limit 100`;
      for (const r of rows) console.log(`${r.code}  已用 ${r.used_count}/${r.max_uses}  ${r.note}`);
      if (!rows.length) console.log('还没有邀请码');
      break;
    }
    case 'make-admin': {
      const phone = normalizePhone(args[0]);
      const r = await sql`update users set platform_admin = true where phone = ${phone}`;
      console.log(r.count ? '已设为平台管理员' : '没有找到这个手机号的用户（需要先注册）');
      break;
    }
    case 'disable': {
      const phone = normalizePhone(args[0]);
      const [u] = await sql<{ id: string }[]>`update users set disabled = true where phone = ${phone} returning id`;
      if (u) await sql`delete from sessions where user_id = ${u.id}`;
      console.log(u ? '账号已停用' : '没有找到这个手机号的用户');
      break;
    }
    default:
      console.log('可用命令：migrate | code [数量] [使用次数] [备注] | codes | make-admin 手机号 | disable 手机号');
  }
}

run()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
