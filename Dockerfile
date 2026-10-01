# 墨织生产镜像：构建前端 + 运行 Node 服务（接口与静态文件同一进程）
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=4318
EXPOSE 4318
CMD ["npm", "start"]
