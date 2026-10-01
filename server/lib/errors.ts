/** 带状态码与机器可读代码的错误，统一转成 { error: { code, message } } 返回给前端。 */
export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message: string, code = 'bad_request', extra?: Record<string, unknown>) => new HttpError(400, code, message, extra);
export const unauthorized = (message = '请先登录') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = '没有权限执行这个操作', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = '找不到要访问的内容') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict', extra?: Record<string, unknown>) => new HttpError(409, code, message, extra);
export const tooMany = (message = '操作太频繁，请稍后再试', retryAfter?: number) => new HttpError(429, 'rate_limited', message, retryAfter ? { retryAfter } : undefined);
